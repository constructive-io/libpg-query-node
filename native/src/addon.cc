#include <napi.h>
#include <string>

extern "C" {
#include "pg_query.h"
#include "protobuf/pg_query.pb-c.h"
}

static std::string EscapeJsonString(const std::string &s) {
  std::string out;
  out.reserve(s.size() + 8);
  for (char c : s) {
    switch (c) {
      case '"':  out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default:   out += c;
    }
  }
  return out;
}

// Build a JSON object with error details from a PgQueryError.
static std::string BuildErrorJson(PgQueryError *error) {
  std::string msg = error->message ? error->message : "Unknown error";
  std::string json = "{\"message\":\"" + EscapeJsonString(msg) + "\"";
  json += ",\"cursorPosition\":" + std::to_string(error->cursorpos > 0 ? error->cursorpos - 1 : 0);
  if (error->funcname)
    json += ",\"functionName\":\"" + EscapeJsonString(error->funcname) + "\"";
  if (error->filename)
    json += ",\"fileName\":\"" + EscapeJsonString(error->filename) + "\"";
  if (error->lineno > 0)
    json += ",\"lineNumber\":" + std::to_string(error->lineno);
  if (error->context)
    json += ",\"context\":\"" + EscapeJsonString(error->context) + "\"";
  json += "}";
  return json;
}

// Return a {error: json, result: null} object to JS. JS throws from there.
static Napi::Value ReturnError(Napi::Env env, PgQueryError *error) {
  Napi::Object obj = Napi::Object::New(env);
  obj.Set("error", Napi::String::New(env, BuildErrorJson(error)));
  obj.Set("result", env.Null());
  return obj;
}

static Napi::Value ReturnResult(Napi::Env env, const std::string &result) {
  Napi::Object obj = Napi::Object::New(env);
  obj.Set("error", env.Null());
  obj.Set("result", Napi::String::New(env, result));
  return obj;
}

static std::string ValidateQuery(Napi::Env env, const Napi::CallbackInfo &info) {
  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "Expected a string argument").ThrowAsJavaScriptException();
    return "";
  }
  std::string query = info[0].As<Napi::String>().Utf8Value();
  if (query.empty()) {
    Napi::Error::New(env, "Query cannot be empty").ThrowAsJavaScriptException();
    return "";
  }
  return query;
}

static Napi::Value ParseSync(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  std::string query = ValidateQuery(env, info);
  if (env.IsExceptionPending()) return env.Undefined();

  PgQueryParseResult result = pg_query_parse(query.c_str());

  if (result.error) {
    Napi::Value ret = ReturnError(env, result.error);
    pg_query_free_parse_result(result);
    return ret;
  }

  std::string json(result.parse_tree);
  pg_query_free_parse_result(result);
  return ReturnResult(env, json);
}

static Napi::Value ParsePlPgSQLSync(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  std::string query = ValidateQuery(env, info);
  if (env.IsExceptionPending()) return env.Undefined();

  PgQueryPlpgsqlParseResult result = pg_query_parse_plpgsql(query.c_str());

  if (result.error) {
    Napi::Value ret = ReturnError(env, result.error);
    pg_query_free_plpgsql_parse_result(result);
    return ret;
  }

  std::string json = std::string("{\"plpgsql_funcs\":") +
                     (result.plpgsql_funcs ? result.plpgsql_funcs : "[]") + "}";
  pg_query_free_plpgsql_parse_result(result);
  return ReturnResult(env, json);
}

static Napi::Value FingerprintSync(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  std::string query = ValidateQuery(env, info);
  if (env.IsExceptionPending()) return env.Undefined();

  PgQueryFingerprintResult result = pg_query_fingerprint(query.c_str());

  if (result.error) {
    Napi::Value ret = ReturnError(env, result.error);
    pg_query_free_fingerprint_result(result);
    return ret;
  }

  std::string fp(result.fingerprint_str);
  pg_query_free_fingerprint_result(result);
  return ReturnResult(env, fp);
}

static Napi::Value NormalizeSync(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  std::string query = ValidateQuery(env, info);
  if (env.IsExceptionPending()) return env.Undefined();

  PgQueryNormalizeResult result = pg_query_normalize(query.c_str());

  if (result.error) {
    Napi::Value ret = ReturnError(env, result.error);
    pg_query_free_normalize_result(result);
    return ret;
  }

  std::string normalized(result.normalized_query);
  pg_query_free_normalize_result(result);
  return ReturnResult(env, normalized);
}

static std::string GetTokenName(int token_type) {
  switch (token_type) {
    case 258: return "IDENT";
    case 261: return "SCONST";
    case 266: return "ICONST";
    case 260: return "FCONST";
    case 267: return "PARAM";
    case 40:  return "ASCII_40";
    case 41:  return "ASCII_41";
    case 42:  return "ASCII_42";
    case 44:  return "ASCII_44";
    case 59:  return "ASCII_59";
    case 61:  return "ASCII_61";
    case 268: return "TYPECAST";
    case 272: return "LESS_EQUALS";
    case 273: return "GREATER_EQUALS";
    case 274: return "NOT_EQUALS";
    case 275: return "SQL_COMMENT";
    case 276: return "C_COMMENT";
    default:  return "UNKNOWN";
  }
}

static std::string GetKeywordName(int kind) {
  switch (kind) {
    case 0: return "NO_KEYWORD";
    case 1: return "UNRESERVED_KEYWORD";
    case 2: return "COL_NAME_KEYWORD";
    case 3: return "TYPE_FUNC_NAME_KEYWORD";
    case 4: return "RESERVED_KEYWORD";
    default: return "UNKNOWN_KEYWORD";
  }
}

static Napi::Value ScanSync(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  std::string query = ValidateQuery(env, info);
  if (env.IsExceptionPending()) return env.Undefined();

  PgQueryScanResult result = pg_query_scan(query.c_str());

  if (result.error) {
    Napi::Value ret = ReturnError(env, result.error);
    pg_query_free_scan_result(result);
    return ret;
  }

  PgQuery__ScanResult *scan_result = pg_query__scan_result__unpack(
      NULL, result.pbuf.len, (const uint8_t *)result.pbuf.data);

  if (!scan_result) {
    pg_query_free_scan_result(result);
    Napi::Error::New(env, "Failed to unpack scan result").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  Napi::Object scan_obj = Napi::Object::New(env);
  scan_obj.Set("version", Napi::Number::New(env, scan_result->version));

  Napi::Array tokens = Napi::Array::New(env, scan_result->n_tokens);
  for (size_t i = 0; i < scan_result->n_tokens; i++) {
    PgQuery__ScanToken *token = scan_result->tokens[i];
    Napi::Object tok = Napi::Object::New(env);
    tok.Set("start", Napi::Number::New(env, token->start));
    tok.Set("end", Napi::Number::New(env, token->end));
    tok.Set("text", Napi::String::New(env, query.substr(token->start, token->end - token->start)));
    tok.Set("tokenType", Napi::Number::New(env, token->token));
    tok.Set("tokenName", Napi::String::New(env, GetTokenName(token->token)));
    tok.Set("keywordKind", Napi::Number::New(env, token->keyword_kind));
    tok.Set("keywordName", Napi::String::New(env, GetKeywordName(token->keyword_kind)));
    tokens[i] = tok;
  }
  scan_obj.Set("tokens", tokens);

  pg_query__scan_result__free_unpacked(scan_result, NULL);
  pg_query_free_scan_result(result);

  Napi::Object obj = Napi::Object::New(env);
  obj.Set("error", env.Null());
  obj.Set("result", scan_obj);
  return obj;
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("parseSync", Napi::Function::New(env, ParseSync));
  exports.Set("parsePlPgSQLSync", Napi::Function::New(env, ParsePlPgSQLSync));
  exports.Set("fingerprintSync", Napi::Function::New(env, FingerprintSync));
  exports.Set("normalizeSync", Napi::Function::New(env, NormalizeSync));
  exports.Set("scanSync", Napi::Function::New(env, ScanSync));
  return exports;
}

NODE_API_MODULE(libpg_query_native, Init)
