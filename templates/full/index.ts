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
  _wasm_free_detailed_result: (ptr: number) => void;
  lengthBytesUTF8: (str: string) => number;
  stringToUTF8: (str: string, ptr: number, len: number) => void;
  UTF8ToString: (ptr: number) => string;
  getValue: (ptr: number, type: string) => number;
  HEAPU8: Uint8Array;
  stackSave: () => number;
  stackRestore: (ptr: number) => void;
}

let wasmModule: WasmModule;

// After a WASM call throws, the instance is stale: async calls wait for its
// replacement, while sync calls, which cannot wait, keep using it until the
// replacement is ready. One replacement loads at a time; the next call retries
// a failed load.
let stale = false;
let loading: Promise<void> | undefined;
// Counts WASM calls that threw, so cleanup skips an instance that threw mid-call.
let failures = 0;
// Sync calls stop using a stale instance after this many failures on it: past
// about 45, a stack overflow can make the next one spin forever.
const MAX_STALE_FAILURES = 10;
let staleFailures = 0;

function instantiate(): Promise<void> {
  if (loading) return loading;
  const promise = PgQueryModule().then(
    (module: WasmModule) => {
      wasmModule = module;
      stale = false;
      staleFailures = 0;
      loading = undefined;
    },
    (error: unknown) => {
      loading = undefined;
      throw error;
    }
  );
  loading = promise;
  // Rejects only for the callers awaiting it.
  promise.catch(() => {});
  return promise;
}

instantiate();

// An exception out of a WASM call (V8 stack overflow on deeply nested SQL, a
// trap, or exit() once the heap limit is hit) skips libpg_query's cleanup and
// leaves the instance corrupt, so replace it with a fresh one.
function callWasm(fn: () => number): number {
  const proc = (globalThis as any).process;
  const exitCode = proc?.exitCode;
  const module = wasmModule;
  const stackPointer = module.stackSave();
  try {
    return fn();
  } catch (error) {
    // The throw unwound the JS frames but not the C shadow stack; give it
    // back so later sync calls on this instance do not start half-way down it.
    module.stackRestore(stackPointer);
    failures++;
    stale = true;
    if (++staleFailures >= MAX_STALE_FAILURES) wasmModule = undefined;
    instantiate();
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
  if (!wasmModule) throw new Error("WASM module not initialized. Call `loadModule()` first.");
}

export async function loadModule(): Promise<void> {
  while (!wasmModule || stale) await instantiate();
}

function awaitInit<T extends (...args: any[]) => Promise<any>>(fn: T): T {
  return (async (...args: Parameters<T>) => {
    // Re-checked after every await: another call may have failed in between.
    while (!wasmModule || stale) await instantiate();
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

const NO_RESULT_OUT_OF_MEMORY = 'libpg_query returned no result: out of WASM memory (heap limit is WASM_MAXIMUM_MEMORY, 1 GiB); parse large inputs in smaller pieces';

function readDetailedResult(resultPtr: number): string {
  if (!resultPtr) {
    throw new Error(NO_RESULT_OUT_OF_MEMORY);
  }
  const ptrAt = (offset: number) => wasmModule.getValue(resultPtr + offset, 'i32');
  const str = (ptr: number) => (ptr ? wasmModule.UTF8ToString(ptr) : undefined);
  if (ptrAt(0)) {
    const message = str(ptrAt(4)) ?? 'Unknown error';
    // libpg_query reports a failed malloc as a plain "out of memory" error.
    if (message === 'out of memory') {
      throw new Error(NO_RESULT_OUT_OF_MEMORY);
    }
    const lineno = ptrAt(16);
    const cursorpos = ptrAt(20);
    throw new SqlError(message, {
      message,
      cursorPosition: cursorpos > 0 ? cursorpos - 1 : 0,
      fileName: str(ptrAt(12)),
      functionName: str(ptrAt(8)),
      lineNumber: lineno > 0 ? lineno : undefined,
      context: str(ptrAt(24))
    });
  }
  return str(ptrAt(28)) ?? '';
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
    const resultStr = readDetailedResult(resultPtr);
    
    return resultStr;
  } finally {
    if (failures === failuresBefore) {
      wasmModule._free(queryPtr);
      if (resultPtr) {
        wasmModule._wasm_free_detailed_result(resultPtr);
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
    const resultStr = readDetailedResult(resultPtr);
    
    return resultStr;
  } finally {
    if (failures === failuresBefore) {
      wasmModule._free(queryPtr);
      if (resultPtr) {
        wasmModule._wasm_free_detailed_result(resultPtr);
      }
    }
  }
});

// Sync versions
export function parseSync(query: string): ParseResult {
  if (!wasmModule) {
    throw new Error('WASM module not initialized. Call loadModule() first.');
  }
  
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
  if (!wasmModule) {
    throw new Error('WASM module not initialized. Call loadModule() first.');
  }
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
  if (!wasmModule) {
    throw new Error('WASM module not initialized. Call loadModule() first.');
  }
  const queryPtr = stringToPtr(query);
  const failuresBefore = failures;
  let resultPtr = 0;
  
  try {
    resultPtr = callWasm(() => wasmModule._wasm_fingerprint(queryPtr));
    const resultStr = readDetailedResult(resultPtr);
    
    return resultStr;
  } finally {
    if (failures === failuresBefore) {
      wasmModule._free(queryPtr);
      if (resultPtr) {
        wasmModule._wasm_free_detailed_result(resultPtr);
      }
    }
  }
}

export function normalizeSync(query: string): string {
  if (!wasmModule) {
    throw new Error('WASM module not initialized. Call loadModule() first.');
  }
  const queryPtr = stringToPtr(query);
  const failuresBefore = failures;
  let resultPtr = 0;
  
  try {
    resultPtr = callWasm(() => wasmModule._wasm_normalize_query(queryPtr));
    const resultStr = readDetailedResult(resultPtr);
    
    return resultStr;
  } finally {
    if (failures === failuresBefore) {
      wasmModule._free(queryPtr);
      if (resultPtr) {
        wasmModule._wasm_free_detailed_result(resultPtr);
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
    const resultStr = readDetailedResult(resultPtr);
    
    return JSON.parse(resultStr);
  } finally {
    if (failures === failuresBefore) {
      wasmModule._free(queryPtr);
      if (resultPtr) {
        wasmModule._wasm_free_detailed_result(resultPtr);
      }
    }
  }
});

export function scanSync(query: string): ScanResult {
  if (!wasmModule) {
    throw new Error('WASM module not initialized. Call loadModule() first.');
  }
  const queryPtr = stringToPtr(query);
  const failuresBefore = failures;
  let resultPtr = 0;
  
  try {
    resultPtr = callWasm(() => wasmModule._wasm_scan(queryPtr));
    const resultStr = readDetailedResult(resultPtr);
    
    return JSON.parse(resultStr);
  } finally {
    if (failures === failuresBefore) {
      wasmModule._free(queryPtr);
      if (resultPtr) {
        wasmModule._wasm_free_detailed_result(resultPtr);
      }
    }
  }
} 