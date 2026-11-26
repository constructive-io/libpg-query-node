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
  compiledWasm: WasmCompiledModule;
  _malloc: (size: number) => number;
  _free: (ptr: number) => void;
  _wasm_free_string: (ptr: number) => void;
  _wasm_free_detailed_result: (ptr: number) => void;
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
let compiledWasm: WasmCompiledModule | undefined;
let loading: Promise<void> | undefined;
// Invalidation skips cleanup through pointers that belong to a failed instance.
let failures = 0;
// Dropped instances can remain live until the current synchronous run yields.
const LARGE_HEAP_BYTES = 512 * 1024 * 1024;
let largeFailures = 0;
let memoryLimitError: Error | undefined;
let largeHeapYield: Promise<void> | undefined;

function createSync(module: WasmCompiledModule): WasmModule {
  const options: Partial<WasmModule> & { readySync?: boolean; initError?: unknown } = {
    compiledWasm: module,
  };
  PgQueryModule(options).catch(() => {});
  if (!options.readySync) {
    throw new Error('Could not start a fresh WASM instance', { cause: options.initError });
  }
  return options as WasmModule;
}

function instantiate(): Promise<void> {
  if (loading) return loading;
  const promise = Promise.resolve().then(async () => {
    while (!wasmModule && largeHeapYield) await largeHeapYield;
    if (!wasmModule) {
      wasmModule = compiledWasm ? createSync(compiledWasm) : await PgQueryModule();
      compiledWasm = wasmModule.compiledWasm;
    }
  }).finally(() => { loading = undefined; });
  loading = promise;
  // Rejects only for the callers awaiting it.
  promise.catch(() => {});
  return promise;
}

instantiate();

function invalidateModule(error: unknown): void {
  if (wasmModule.HEAPU8.length > LARGE_HEAP_BYTES) {
    // Async callers can give V8 a task to release the dropped heap before allocating again.
    largeHeapYield ??= new Promise<void>((resolve) => setTimeout(() => {
      largeHeapYield = undefined;
      resolve();
    }, 0));
    if (++largeFailures === 1) {
      queueMicrotask(() => {
        largeFailures = 0;
        memoryLimitError = undefined;
      });
    } else {
      memoryLimitError = new Error(
        'WASM memory limit hit repeatedly in one synchronous run; yield (await) before retrying',
        { cause: error }
      );
    }
  }
  failures++;
  wasmModule = undefined;
}

// The host engine's native stack (V8 and JSC: RangeError, Firefox:
// InternalError) can run out inside a WASM call before libpg_query's own
// stack depth check, which only measures the WASM stack.
function isStackOverflow(error: Error): boolean {
  return (error instanceof RangeError && /call stack/i.test(error.message))
    || (error.name === 'InternalError' && /too much recursion/i.test(error.message));
}

function stackDepthError(cause: Error): SqlError {
  const message = 'stack depth limit exceeded';
  // Until its stack is formatted, the error's WASM frames keep the dropped instance alive.
  void cause.stack;
  return Object.assign(new SqlError(message, { message, cursorPosition: 0 }), { cause });
}

// An exception out of a WASM call (host stack overflow on deeply nested SQL, a
// trap, or exit() once the heap limit is hit) skips libpg_query's cleanup and
// leaves the instance corrupt, so replace it with a fresh one.
function callWasm(fn: () => number): number {
  const proc = (globalThis as any).process;
  const exitCode = proc?.exitCode;
  try {
    return fn();
  } catch (error) {
    if (proc) proc.exitCode = exitCode;
    if (error instanceof Error) {
      invalidateModule(error);
      if (isStackOverflow(error)) throw stackDepthError(error);
      throw error;
    }
    const reason = typeof error === 'object' && error !== null
      ? ((error as any).message ?? (error as any).constructor?.name)
      : error;
    // Emscripten's ExitStatus keeps its loader closure and WASM heap alive.
    const cause = typeof error === 'object' && error !== null && 'name' in error && error.name === 'ExitStatus'
      ? { ...error }
      : error;
    const wrapped = new Error(
      `libpg_query terminated (${reason}), most likely out of WASM memory; parse large inputs in smaller pieces`,
      { cause }
    );
    invalidateModule(wrapped);
    throw wrapped;
  }
}

// libpg_query reports a failed allocation as a plain "out of memory" error and
// keeps going, but the instance's heap stays grown to the size it reached (WASM
// memory never shrinks), so load a fresh instance and let this one be freed.
function outOfMemoryError(): Error {
  const error = new Error('libpg_query ran out of WASM memory (heap limit is WASM_MAXIMUM_MEMORY, 1 GiB); parse large inputs in smaller pieces');
  invalidateModule(error);
  return error;
}

function plpgsqlError(message: string): Error {
  if (message === 'out of memory') return outOfMemoryError();
  // The PL/pgSQL C API gives the JS wrapper only the diagnostic text.
  if (message === 'stack depth limit exceeded' || message.startsWith('memory exhausted at or near ')) {
    return new SqlError(message);
  }
  return new Error(message);
}

function ensureLoaded() {
  if (wasmModule) return;
  if (memoryLimitError) throw memoryLimitError;
  if (!compiledWasm) throw new Error("WASM module not initialized. Call `loadModule()` first.");
  wasmModule = createSync(compiledWasm);
}

type WasmCompiledModule = typeof globalThis extends {
  WebAssembly: { Module: new (...args: any[]) => infer M }
} ? M : never;

export interface LoadModuleOptions {
  /**
   * The contents of `libpg-query.wasm`, or the module compiled from them, for
   * hosts where the wrapper cannot read the file itself (a custom protocol
   * without fetch support, a bundle that inlines assets). Every later instance,
   * including replacements after a failed call, is created from it.
   */
  wasm?: ArrayBuffer | ArrayBufferView | WasmCompiledModule;
}

// A rest parameter keeps loadModule.length at 0, so `before(loadModule)` is not
// mistaken for a callback-style hook by test runners.
export async function loadModule(...args: [options?: LoadModuleOptions]): Promise<void> {
  const wasm = args[0]?.wasm;
  if (wasm !== undefined) {
    const module = wasm instanceof WebAssembly.Module
      ? wasm
      : await WebAssembly.compile(wasm as ArrayBuffer | ArrayBufferView);
    // An instance loaded from the file, or still loading, is replaced by one from `wasm`.
    await loading?.catch(() => {});
    if (largeHeapYield) await largeHeapYield;
    wasmModule = createSync(module);
    compiledWasm = module;
  }
  while (!wasmModule) await instantiate();
}

function awaitInit<T extends (...args: any[]) => Promise<any>>(fn: T): T {
  return (async (...args: Parameters<T>) => {
    // Re-checked after every await: another call may have failed in between.
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

type DetailedOperation = '_wasm_fingerprint' | '_wasm_normalize_query' | '_wasm_scan';

function callDetailed(query: string, operation: DetailedOperation): string {
  const queryPtr = stringToPtr(query);
  const failuresBefore = failures;
  let resultPtr = 0;

  try {
    resultPtr = callWasm(() => wasmModule[operation](queryPtr));
    if (!resultPtr) throw outOfMemoryError();

    // WasmDetailedResult uses 32-bit fields and pointers.
    if (wasmModule.getValue(resultPtr, 'i32')) {
      const readString = (offset: number) => {
        const ptr = wasmModule.getValue(resultPtr + offset, 'i32');
        return ptr ? wasmModule.UTF8ToString(ptr) : undefined;
      };
      const message = readString(4) ?? 'Unknown error';
      if (message === 'out of memory') throw outOfMemoryError();

      const lineno = wasmModule.getValue(resultPtr + 16, 'i32');
      const cursorpos = wasmModule.getValue(resultPtr + 20, 'i32');
      const context = readString(24);
      throw new SqlError(message, {
        message,
        cursorPosition: cursorpos > 0 ? cursorpos - 1 : 0,
        fileName: readString(12),
        functionName: readString(8),
        lineNumber: lineno > 0 ? lineno : undefined,
        ...(context !== undefined ? { context } : {})
      });
    }
    return wasmModule.UTF8ToString(wasmModule.getValue(resultPtr + 28, 'i32'));
  } finally {
    if (failures === failuresBefore) {
      wasmModule._free(queryPtr);
      if (resultPtr) {
        wasmModule._wasm_free_detailed_result(resultPtr);
      }
    }
  }
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
      
      if (message === 'out of memory') throw outOfMemoryError();
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
    if (!resultStr.startsWith('{')) throw plpgsqlError(resultStr);
    
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
  return callDetailed(query, '_wasm_fingerprint');
});

export const normalize = awaitInit(async (query: string): Promise<string> => {
  return callDetailed(query, '_wasm_normalize_query');
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
      
      if (message === 'out of memory') throw outOfMemoryError();
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
  const queryPtr = stringToPtr(query);
  const failuresBefore = failures;
  let resultPtr = 0;
  
  try {
    resultPtr = callWasm(() => wasmModule._wasm_parse_plpgsql(queryPtr));
    const resultStr = ptrToString(resultPtr);
    
    // Success is always a JSON object; anything else is an error message
    if (!resultStr.startsWith('{')) throw plpgsqlError(resultStr);
    
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
  return callDetailed(query, '_wasm_fingerprint');
}

export function normalizeSync(query: string): string {
  return callDetailed(query, '_wasm_normalize_query');
}

export const scan = awaitInit(async (query: string): Promise<ScanResult> => {
  return JSON.parse(callDetailed(query, '_wasm_scan'));
});

export function scanSync(query: string): ScanResult {
  return JSON.parse(callDetailed(query, '_wasm_scan'));
}
