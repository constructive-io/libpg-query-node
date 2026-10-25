/**
 * DO NOT MODIFY MANUALLY — this is generated from the templates dir
 * 
 * To make changes, edit the files in the templates/ directory and run:
 * npm run copy:templates
 */

import { ParseResult } from "@pgsql/types";
export * from "@pgsql/types";

export interface ScanToken {
  start: number;
  end: number;
  text: string;
  tokenType: number;
  tokenName: string;
  keywordKind: number;
  keywordName: string;
}

export interface ScanResult {
  version: number;
  tokens: ScanToken[];
}

export interface SqlErrorDetails {
  message: string;
  cursorPosition: number;
  fileName?: string;
  functionName?: string;
  lineNumber?: number;
  context?: string;
}

export class SqlError extends Error {
  sqlDetails?: SqlErrorDetails;
  
  constructor(message: string, details?: SqlErrorDetails) {
    super(message);
    this.name = 'SqlError';
    this.sqlDetails = details;
  }
}

export function hasSqlDetails(error: unknown): error is SqlError {
  return error instanceof SqlError && error.sqlDetails !== undefined;
}

export function formatSqlError(
  error: SqlError,
  query: string,
  options: {
    showPosition?: boolean;
    showQuery?: boolean;
    color?: boolean;
    maxQueryLength?: number;
  } = {}
): string {
  const {
    showPosition = true,
    showQuery = true,
    color = false,
    maxQueryLength
  } = options;

  const lines: string[] = [];

  // ANSI color codes
  const red = color ? '\x1b[31m' : '';
  const yellow = color ? '\x1b[33m' : '';
  const reset = color ? '\x1b[0m' : '';

  // Add error message
  lines.push(`${red}Error: ${error.message}${reset}`);

  // Add SQL details if available
  if (error.sqlDetails) {
    const { cursorPosition, fileName, functionName, lineNumber } = error.sqlDetails;

    if (cursorPosition !== undefined && cursorPosition >= 0) {
      lines.push(`Position: ${cursorPosition}`);
    }

    if (fileName || functionName || lineNumber) {
      const details = [];
      if (fileName) details.push(`file: ${fileName}`);
      if (functionName) details.push(`function: ${functionName}`);
      if (lineNumber) details.push(`line: ${lineNumber}`);
      lines.push(`Source: ${details.join(', ')}`);
    }

    // Show query with position marker
    if (showQuery && showPosition && cursorPosition !== undefined && cursorPosition >= 0) {
      let displayQuery = query;
      let adjustedPosition = cursorPosition;

      // Truncate if needed
      if (maxQueryLength && query.length > maxQueryLength) {
        const start = Math.max(0, cursorPosition - Math.floor(maxQueryLength / 2));
        const end = Math.min(query.length, start + maxQueryLength);
        displayQuery = (start > 0 ? '...' : '') +
                      query.substring(start, end) +
                      (end < query.length ? '...' : '');
        // Adjust cursor position for truncation
        adjustedPosition = cursorPosition - start + (start > 0 ? 3 : 0);
      }

      lines.push(displayQuery);
      lines.push(' '.repeat(adjustedPosition) + `${yellow}^${reset}`);
    }
  } else if (showQuery) {
    // No SQL details, just show the query if requested
    let displayQuery = query;
    if (maxQueryLength && query.length > maxQueryLength) {
      displayQuery = query.substring(0, maxQueryLength) + '...';
    }
    lines.push(`Query: ${displayQuery}`);
  }

  return lines.join('\n');
}

// @ts-ignore
import PgQueryModule from './libpg-query.js';

interface WasmModule {
  _malloc: (size: number) => number;
  _free: (ptr: number) => void;
  _wasm_free_string: (ptr: number) => void;
  _wasm_parse_query: (queryPtr: number) => number;
  _wasm_parse_query_raw: (queryPtr: number) => number;
  _wasm_free_parse_result: (ptr: number) => void;
  _wasm_parse_plpgsql: (queryPtr: number) => number;
  _wasm_fingerprint: (queryPtr: number) => number;
  _wasm_normalize_query: (queryPtr: number) => number;
  _wasm_scan: (queryPtr: number) => number;
  lengthBytesUTF8: (str: string) => number;
  stringToUTF8: (str: string, ptr: number, len: number) => void;
  UTF8ToString: (ptr: number) => string;
  getValue: (ptr: number, type: string) => number;
  HEAPU8: Uint8Array;
}

let wasmModule: WasmModule;

// An exception out of a WASM call (V8 stack overflow on deeply nested SQL, a
// trap, or exit() once the heap limit is hit) skips libpg_query's cleanup and
// can leave the instance corrupt. callWasm() therefore swaps in a fresh instance
// before rethrowing. It builds that instance synchronously from the compiled
// module, so the very next call, sync or async, already runs on a clean one.
let compiled: WebAssembly.Module | undefined;
let loading: Promise<void> | undefined;
// Counts WASM calls that threw, so cleanup skips memory of the replaced instance.
let failures = 0;
// Why the last synchronous replacement failed; the next loadModule() retries.
let replaceError: unknown;

// Reads the .wasm file the way the Emscripten loader does: from disk in Node, else with fetch.
async function compileWasm(url: string): Promise<WebAssembly.Module> {
  const proc = (globalThis as any).process;
  if (proc?.versions?.node && proc.type !== 'renderer') {
    return WebAssembly.compile(require('node:fs').readFileSync(url.startsWith('file://') ? new URL(url) : url));
  }
  const response = await fetch(url, { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`Failed to load ${url}: HTTP ${response.status}`);
  return WebAssembly.compile(await response.arrayBuffer());
}

function instantiate(): Promise<void> {
  if (loading) return loading;
  const promise = (async () => {
    let wasmUrl: string | undefined;
    const module: WasmModule = await PgQueryModule({
      locateFile: (path: string, dir: string) => (wasmUrl = dir + path),
    });
    compiled ??= await compileWasm(wasmUrl);
    wasmModule = module;
    replaceError = undefined;
  })();
  loading = promise;
  promise.then(
    () => { loading = undefined; },
    () => { loading = undefined; }
  );
  return promise;
}

// Rejects only for the callers awaiting it.
instantiate().catch(() => {});

function replaceInstance(): void {
  let error: unknown = new Error('the WASM loader did not instantiate synchronously');
  const module: any = {
    instantiateWasm(imports: WebAssembly.Imports, receive: (instance: WebAssembly.Instance) => void) {
      try {
        receive(new WebAssembly.Instance(compiled, imports));
        error = undefined;
      } catch (e) {
        error = e;
      }
      return {};
    },
  };
  // receive() sets the exports and memory views, so the instance is usable right
  // away; the loader runs the rest of its start-up (stdio streams) on a later microtask.
  PgQueryModule(module).catch(() => {});
  wasmModule = error === undefined ? module : undefined;
  replaceError = error;
}

function callWasm(fn: () => number): number {
  const proc = (globalThis as any).process;
  const exitCode = proc?.exitCode;
  try {
    return fn();
  } catch (error) {
    failures++;
    replaceInstance();
    if (proc) proc.exitCode = exitCode;
    if (error instanceof Error) throw error;
    const reason = typeof error === 'object' && error !== null
      ? ((error as any).message ?? (error as any).constructor?.name)
      : error;
    throw new Error(
      `libpg_query terminated (${reason}), most likely out of WASM memory; parse large inputs in smaller pieces`,
      { cause: error }
    );
  }
}

function ensureLoaded() {
  // A replacement that failed to start is retried here, for callers that never await.
  if (!wasmModule && compiled) replaceInstance();
  if (wasmModule) return;
  if (replaceError !== undefined) {
    throw new Error('Could not start a fresh WASM instance after a failed call; await `loadModule()` to retry', { cause: replaceError });
  }
  throw new Error("WASM module not initialized. Call `loadModule()` first.");
}

export async function loadModule(): Promise<void> {
  while (!wasmModule) await instantiate();
}

function awaitInit<T extends (...args: any[]) => Promise<any>>(fn: T): T {
  return (async (...args: Parameters<T>) => {
    while (!wasmModule) await instantiate();
    return fn(...args);
  }) as T;
}

const SURROGATE = /[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g;

function stringToPtr(str: string): number {
  ensureLoaded();
  if (typeof str !== 'string') {
    throw new TypeError(`Expected a string, got ${typeof str}`);
  }
  // libpg_query takes a NUL-terminated C string: an embedded NUL would end the
  // parse early and silently drop everything after it.
  if (str.includes('\0')) {
    throw new Error('Query must not contain a NUL (U+0000) character');
  }
  // lengthBytesUTF8 and stringToUTF8 disagree on unpaired surrogates, which cut
  // the query short. Write each as U+FFFD, the same bytes a Postgres driver sends.
  const wellFormed = str.replace(SURROGATE, (s) => (s.length === 2 ? s : '\uFFFD'));
  const size = wasmModule.lengthBytesUTF8(wellFormed) + 1;
  const ptr = wasmModule._malloc(size);
  if (!ptr) {
    throw new Error('Failed to allocate memory for query');
  }
  wasmModule.stringToUTF8(wellFormed, ptr, size);
  return ptr;
}

function ptrToString(ptr: number): string {
  ensureLoaded();
  if (typeof ptr !== 'number') {
    throw new TypeError(`Expected a number, got ${typeof ptr}`);
  }
  return wasmModule.UTF8ToString(ptr);
}

export const parse = awaitInit(async (query: string): Promise<ParseResult> => {
  // Input validation
  if (query === null || query === undefined) {
    throw new Error('Query cannot be null or undefined');
  }
  
  if (query === '') {
    throw new Error('Query cannot be empty');
  }

  const queryPtr = stringToPtr(query);
  const failuresBefore = failures;
  let resultPtr = 0;
  
  try {
    resultPtr = callWasm(() => wasmModule._wasm_parse_query_raw(queryPtr));
    if (!resultPtr) {
      throw new Error('Failed to parse query: memory allocation failed');
    }
    
    // Read the PgQueryParseResult struct
    const parseTreePtr = wasmModule.getValue(resultPtr, 'i32');
    const stderrBufferPtr = wasmModule.getValue(resultPtr + 4, 'i32');
    const errorPtr = wasmModule.getValue(resultPtr + 8, 'i32');
    
    if (errorPtr) {
      // Read PgQueryError struct
      const messagePtr = wasmModule.getValue(errorPtr, 'i32');
      const funcnamePtr = wasmModule.getValue(errorPtr + 4, 'i32');
      const filenamePtr = wasmModule.getValue(errorPtr + 8, 'i32');
      const lineno = wasmModule.getValue(errorPtr + 12, 'i32');
      const cursorpos = wasmModule.getValue(errorPtr + 16, 'i32');
      
      const message = messagePtr ? wasmModule.UTF8ToString(messagePtr) : 'Unknown error';
      const funcname = funcnamePtr ? wasmModule.UTF8ToString(funcnamePtr) : undefined;
      const filename = filenamePtr ? wasmModule.UTF8ToString(filenamePtr) : undefined;
      
      throw new SqlError(message, {
        message,
        cursorPosition: cursorpos > 0 ? cursorpos - 1 : 0, // Convert to 0-based
        fileName: filename,
        functionName: funcname,
        lineNumber: lineno > 0 ? lineno : undefined
      });
    }
    
    if (!parseTreePtr) {
      throw new Error('libpg_query returned no parse tree: out of WASM memory (heap limit is WASM_MAXIMUM_MEMORY, 1 GiB); parse large inputs in smaller pieces');
    }
    
    const parseTreeStr = wasmModule.UTF8ToString(parseTreePtr);
    return JSON.parse(parseTreeStr);
  } finally {
    if (failures === failuresBefore) {
      wasmModule._free(queryPtr);
      if (resultPtr) {
        wasmModule._wasm_free_parse_result(resultPtr);
      }
    }
  }
});

export const parsePlPgSQL = awaitInit(async (query: string): Promise<ParseResult> => {
  const queryPtr = stringToPtr(query);
  const failuresBefore = failures;
  let resultPtr = 0;
  
  try {
    resultPtr = callWasm(() => wasmModule._wasm_parse_plpgsql(queryPtr));
    const resultStr = ptrToString(resultPtr);
    
    // Success is always a JSON object; anything else is an error message
    if (!resultStr.startsWith('{')) {
      throw new Error(resultStr);
    }
    
    return JSON.parse(resultStr);
  } finally {
    if (failures === failuresBefore) {
      wasmModule._free(queryPtr);
      if (resultPtr) {
        wasmModule._wasm_free_string(resultPtr);
      }
    }
  }
});

export const fingerprint = awaitInit(async (query: string): Promise<string> => {
  const queryPtr = stringToPtr(query);
  const failuresBefore = failures;
  let resultPtr = 0;
  
  try {
    resultPtr = callWasm(() => wasmModule._wasm_fingerprint(queryPtr));
    const resultStr = ptrToString(resultPtr);
    
    if (resultStr.startsWith('syntax error') || resultStr.startsWith('deparse error') || resultStr.startsWith('ERROR')) {
      throw new Error(resultStr);
    }
    
    return resultStr;
  } finally {
    if (failures === failuresBefore) {
      wasmModule._free(queryPtr);
      if (resultPtr) {
        wasmModule._wasm_free_string(resultPtr);
      }
    }
  }
});

export const normalize = awaitInit(async (query: string): Promise<string> => {
  const queryPtr = stringToPtr(query);
  const failuresBefore = failures;
  let resultPtr = 0;
  
  try {
    resultPtr = callWasm(() => wasmModule._wasm_normalize_query(queryPtr));
    const resultStr = ptrToString(resultPtr);
    
    if (resultStr.startsWith('syntax error') || resultStr.startsWith('deparse error') || resultStr.startsWith('ERROR')) {
      throw new Error(resultStr);
    }
    
    return resultStr;
  } finally {
    if (failures === failuresBefore) {
      wasmModule._free(queryPtr);
      if (resultPtr) {
        wasmModule._wasm_free_string(resultPtr);
      }
    }
  }
});

// Sync versions
export function parseSync(query: string): ParseResult {
  ensureLoaded();
  
  // Input validation
  if (query === null || query === undefined) {
    throw new Error('Query cannot be null or undefined');
  }
  
  if (query === '') {
    throw new Error('Query cannot be empty');
  }

  const queryPtr = stringToPtr(query);
  const failuresBefore = failures;
  let resultPtr = 0;
  
  try {
    resultPtr = callWasm(() => wasmModule._wasm_parse_query_raw(queryPtr));
    if (!resultPtr) {
      throw new Error('Failed to parse query: memory allocation failed');
    }
    
    // Read the PgQueryParseResult struct
    const parseTreePtr = wasmModule.getValue(resultPtr, 'i32');
    const stderrBufferPtr = wasmModule.getValue(resultPtr + 4, 'i32');
    const errorPtr = wasmModule.getValue(resultPtr + 8, 'i32');
    
    if (errorPtr) {
      // Read PgQueryError struct
      const messagePtr = wasmModule.getValue(errorPtr, 'i32');
      const funcnamePtr = wasmModule.getValue(errorPtr + 4, 'i32');
      const filenamePtr = wasmModule.getValue(errorPtr + 8, 'i32');
      const lineno = wasmModule.getValue(errorPtr + 12, 'i32');
      const cursorpos = wasmModule.getValue(errorPtr + 16, 'i32');
      
      const message = messagePtr ? wasmModule.UTF8ToString(messagePtr) : 'Unknown error';
      const funcname = funcnamePtr ? wasmModule.UTF8ToString(funcnamePtr) : undefined;
      const filename = filenamePtr ? wasmModule.UTF8ToString(filenamePtr) : undefined;
      
      throw new SqlError(message, {
        message,
        cursorPosition: cursorpos > 0 ? cursorpos - 1 : 0, // Convert to 0-based
        fileName: filename,
        functionName: funcname,
        lineNumber: lineno > 0 ? lineno : undefined
      });
    }
    
    if (!parseTreePtr) {
      throw new Error('libpg_query returned no parse tree: out of WASM memory (heap limit is WASM_MAXIMUM_MEMORY, 1 GiB); parse large inputs in smaller pieces');
    }
    
    const parseTreeStr = wasmModule.UTF8ToString(parseTreePtr);
    return JSON.parse(parseTreeStr);
  } finally {
    if (failures === failuresBefore) {
      wasmModule._free(queryPtr);
      if (resultPtr) {
        wasmModule._wasm_free_parse_result(resultPtr);
      }
    }
  }
}

export function parsePlPgSQLSync(query: string): ParseResult {
  ensureLoaded();
  const queryPtr = stringToPtr(query);
  const failuresBefore = failures;
  let resultPtr = 0;
  
  try {
    resultPtr = callWasm(() => wasmModule._wasm_parse_plpgsql(queryPtr));
    const resultStr = ptrToString(resultPtr);
    
    // Success is always a JSON object; anything else is an error message
    if (!resultStr.startsWith('{')) {
      throw new Error(resultStr);
    }
    
    return JSON.parse(resultStr);
  } finally {
    if (failures === failuresBefore) {
      wasmModule._free(queryPtr);
      if (resultPtr) {
        wasmModule._wasm_free_string(resultPtr);
      }
    }
  }
}

export function fingerprintSync(query: string): string {
  ensureLoaded();
  const queryPtr = stringToPtr(query);
  const failuresBefore = failures;
  let resultPtr = 0;
  
  try {
    resultPtr = callWasm(() => wasmModule._wasm_fingerprint(queryPtr));
    const resultStr = ptrToString(resultPtr);
    
    if (resultStr.startsWith('syntax error') || resultStr.startsWith('deparse error') || resultStr.startsWith('ERROR')) {
      throw new Error(resultStr);
    }
    
    return resultStr;
  } finally {
    if (failures === failuresBefore) {
      wasmModule._free(queryPtr);
      if (resultPtr) {
        wasmModule._wasm_free_string(resultPtr);
      }
    }
  }
}

export function normalizeSync(query: string): string {
  ensureLoaded();
  const queryPtr = stringToPtr(query);
  const failuresBefore = failures;
  let resultPtr = 0;
  
  try {
    resultPtr = callWasm(() => wasmModule._wasm_normalize_query(queryPtr));
    const resultStr = ptrToString(resultPtr);
    
    if (resultStr.startsWith('syntax error') || resultStr.startsWith('deparse error') || resultStr.startsWith('ERROR')) {
      throw new Error(resultStr);
    }
    
    return resultStr;
  } finally {
    if (failures === failuresBefore) {
      wasmModule._free(queryPtr);
      if (resultPtr) {
        wasmModule._wasm_free_string(resultPtr);
      }
    }
  }
}

export const scan = awaitInit(async (query: string): Promise<ScanResult> => {
  const queryPtr = stringToPtr(query);
  const failuresBefore = failures;
  let resultPtr = 0;
  
  try {
    resultPtr = callWasm(() => wasmModule._wasm_scan(queryPtr));
    const resultStr = ptrToString(resultPtr);
    
    if (resultStr.startsWith('syntax error') || resultStr.startsWith('deparse error') || resultStr.startsWith('ERROR')) {
      throw new Error(resultStr);
    }
    
    return JSON.parse(resultStr);
  } finally {
    if (failures === failuresBefore) {
      wasmModule._free(queryPtr);
      if (resultPtr) {
        wasmModule._wasm_free_string(resultPtr);
      }
    }
  }
});

export function scanSync(query: string): ScanResult {
  ensureLoaded();
  const queryPtr = stringToPtr(query);
  const failuresBefore = failures;
  let resultPtr = 0;
  
  try {
    resultPtr = callWasm(() => wasmModule._wasm_scan(queryPtr));
    const resultStr = ptrToString(resultPtr);
    
    if (resultStr.startsWith('syntax error') || resultStr.startsWith('deparse error') || resultStr.startsWith('ERROR')) {
      throw new Error(resultStr);
    }
    
    return JSON.parse(resultStr);
  } finally {
    if (failures === failuresBefore) {
      wasmModule._free(queryPtr);
      if (resultPtr) {
        wasmModule._wasm_free_string(resultPtr);
      }
    }
  }
} 