/**
 * DO NOT MODIFY MANUALLY — this is generated from the templates dir
 * 
 * To make changes, edit the files in the templates/ directory and run:
 * npm run copy:templates
 */

export * from "@pgsql/types";

// @ts-ignore
import PgQueryModule from './libpg-query.js';

let wasmModule: any;

// SQL error details interface
export interface SqlErrorDetails {
  message: string;
  cursorPosition: number;  // 0-based position in the query
  fileName?: string;       // Source file where error occurred (e.g., 'scan.l', 'gram.y')
  functionName?: string;   // Internal function name
  lineNumber?: number;     // Line number in source file
  context?: string;        // Additional context
}

// Options for formatting SQL errors
export interface SqlErrorFormatOptions {
  showPosition?: boolean;  // Show the error position marker (default: true)
  showQuery?: boolean;     // Show the query text (default: true)
  color?: boolean;         // Use ANSI colors (default: false)
  maxQueryLength?: number; // Max query length to display (default: no limit)
}

export class SqlError extends Error {
  sqlDetails?: SqlErrorDetails;

  constructor(message: string, details?: SqlErrorDetails) {
    super(message);
    this.name = 'SqlError';
    this.sqlDetails = details;
  }
}



// Helper function to classify error source
function getErrorSource(filename: string | null): string {
  if (!filename) return 'unknown';
  if (filename === 'scan.l') return 'lexer';      // Lexical analysis errors
  if (filename === 'gram.y') return 'parser';     // Grammar/parsing errors  
  return filename;
}

// Format SQL error with visual position indicator
export function formatSqlError(
  error: Error & { sqlDetails?: SqlErrorDetails },
  query: string,
  options: SqlErrorFormatOptions = {}
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
      
      // Truncate if needed
      if (maxQueryLength && query.length > maxQueryLength) {
        const start = Math.max(0, cursorPosition - Math.floor(maxQueryLength / 2));
        const end = Math.min(query.length, start + maxQueryLength);
        displayQuery = (start > 0 ? '...' : '') + 
                      query.substring(start, end) + 
                      (end < query.length ? '...' : '');
        // Adjust cursor position for truncation
        const adjustedPosition = cursorPosition - start + (start > 0 ? 3 : 0);
        lines.push(displayQuery);
        lines.push(' '.repeat(adjustedPosition) + `${yellow}^${reset}`);
      } else {
        lines.push(displayQuery);
        lines.push(' '.repeat(cursorPosition) + `${yellow}^${reset}`);
      }
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

// Check if an error has SQL details
export function hasSqlDetails(error: any): error is Error & { sqlDetails: SqlErrorDetails } {
  return error instanceof Error && 
         'sqlDetails' in error &&
         typeof (error as any).sqlDetails === 'object' && 
         (error as any).sqlDetails !== null &&
         'message' in (error as any).sqlDetails &&
         'cursorPosition' in (error as any).sqlDetails;
}

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
// Set by loadModule({ wasm }); instances are then created from it instead of the file.
let provided: WasmCompiledModule | undefined;

function createModule(): Promise<any> {
  const module = provided;
  if (!module) return PgQueryModule();
  return new Promise((resolve, reject) => {
    PgQueryModule({
      instantiateWasm(imports: any, receive: (instance: any) => void) {
        WebAssembly.instantiate(module, imports).then(receive, reject);
        return {};
      },
    }).then(resolve, reject);
  });
}

function instantiate(): Promise<void> {
  if (loading) return loading;
  const promise = createModule().then(
    (module: any) => {
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
  try {
    return fn();
  } catch (error) {
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
    provided = wasm instanceof WebAssembly.Module
      ? wasm
      : await WebAssembly.compile(wasm as ArrayBuffer | ArrayBufferView);
    // An instance loaded from the file, or still loading, is replaced by one from `wasm`.
    await loading?.catch(() => {});
    stale = true;
  }
  while (!wasmModule || stale) await instantiate();
}

function awaitInit<T extends (...args: any[]) => any>(fn: T): T {
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

export const parse = awaitInit(async (query: string) => {
  // Pre-validation
  if (query === null || query === undefined) {
    throw new Error('Query cannot be null or undefined');
  }
  if (typeof query !== 'string') {
    throw new Error(`Query must be a string, got ${typeof query}`);
  }
  if (query.trim() === '') {
    throw new Error('Query cannot be empty');
  }
  
  const queryPtr = stringToPtr(query);
  const failuresBefore = failures;
  let resultPtr = 0;
  
  try {
    // Call the raw function that returns a struct pointer
    resultPtr = callWasm(() => wasmModule._wasm_parse_query_raw(queryPtr));
    if (!resultPtr) {
      throw new Error('Failed to allocate memory for parse result');
    }
    
    // Read the PgQueryParseResult struct fields
    // struct { char* parse_tree; char* stderr_buffer; PgQueryError* error; }
    const parseTreePtr = wasmModule.getValue(resultPtr, 'i32');      // offset 0
    const stderrBufferPtr = wasmModule.getValue(resultPtr + 4, 'i32'); // offset 4
    const errorPtr = wasmModule.getValue(resultPtr + 8, 'i32');        // offset 8
    
    // Check for error
    if (errorPtr) {
      // Read PgQueryError struct fields
      // struct { char* message; char* funcname; char* filename; int lineno; int cursorpos; char* context; }
      const messagePtr = wasmModule.getValue(errorPtr, 'i32');           // offset 0
      const funcnamePtr = wasmModule.getValue(errorPtr + 4, 'i32');      // offset 4
      const filenamePtr = wasmModule.getValue(errorPtr + 8, 'i32');      // offset 8
      const lineno = wasmModule.getValue(errorPtr + 12, 'i32');          // offset 12
      const cursorpos = wasmModule.getValue(errorPtr + 16, 'i32');       // offset 16
      const contextPtr = wasmModule.getValue(errorPtr + 20, 'i32');      // offset 20
      
      const message = messagePtr ? wasmModule.UTF8ToString(messagePtr) : 'Unknown error';
      const filename = filenamePtr ? wasmModule.UTF8ToString(filenamePtr) : null;
      
      const errorDetails: SqlErrorDetails = {
        message: message,
        cursorPosition: cursorpos > 0 ? cursorpos - 1 : 0, // Convert to 0-based
        fileName: filename || undefined,
        functionName: funcnamePtr ? wasmModule.UTF8ToString(funcnamePtr) : undefined,
        lineNumber: lineno > 0 ? lineno : undefined,
        context: contextPtr ? wasmModule.UTF8ToString(contextPtr) : undefined
      };
      
      throw new SqlError(message, errorDetails);
    }
    
    if (!parseTreePtr) {
      throw new Error('libpg_query returned no parse tree: out of WASM memory (heap limit is WASM_MAXIMUM_MEMORY, 1 GiB); parse large inputs in smaller pieces');
    }
    
    const parseTree = wasmModule.UTF8ToString(parseTreePtr);
    return JSON.parse(parseTree);
  }
  finally {
    if (failures === failuresBefore) {
      wasmModule._free(queryPtr);
      if (resultPtr) {
        wasmModule._wasm_free_parse_result(resultPtr);
      }
    }
  }
});

export function parseSync(query: string) {
  // Pre-validation
  if (query === null || query === undefined) {
    throw new Error('Query cannot be null or undefined');
  }
  if (typeof query !== 'string') {
    throw new Error(`Query must be a string, got ${typeof query}`);
  }
  if (query.trim() === '') {
    throw new Error('Query cannot be empty');
  }
  
  const queryPtr = stringToPtr(query);
  const failuresBefore = failures;
  let resultPtr = 0;
  
  try {
    // Call the raw function that returns a struct pointer
    resultPtr = callWasm(() => wasmModule._wasm_parse_query_raw(queryPtr));
    if (!resultPtr) {
      throw new Error('Failed to allocate memory for parse result');
    }
    
    // Read the PgQueryParseResult struct fields
    // struct { char* parse_tree; char* stderr_buffer; PgQueryError* error; }
    const parseTreePtr = wasmModule.getValue(resultPtr, 'i32');      // offset 0
    const stderrBufferPtr = wasmModule.getValue(resultPtr + 4, 'i32'); // offset 4
    const errorPtr = wasmModule.getValue(resultPtr + 8, 'i32');        // offset 8
    
    // Check for error
    if (errorPtr) {
      // Read PgQueryError struct fields
      // struct { char* message; char* funcname; char* filename; int lineno; int cursorpos; char* context; }
      const messagePtr = wasmModule.getValue(errorPtr, 'i32');           // offset 0
      const funcnamePtr = wasmModule.getValue(errorPtr + 4, 'i32');      // offset 4
      const filenamePtr = wasmModule.getValue(errorPtr + 8, 'i32');      // offset 8
      const lineno = wasmModule.getValue(errorPtr + 12, 'i32');          // offset 12
      const cursorpos = wasmModule.getValue(errorPtr + 16, 'i32');       // offset 16
      const contextPtr = wasmModule.getValue(errorPtr + 20, 'i32');      // offset 20
      
      const message = messagePtr ? wasmModule.UTF8ToString(messagePtr) : 'Unknown error';
      const filename = filenamePtr ? wasmModule.UTF8ToString(filenamePtr) : null;
      
      const errorDetails: SqlErrorDetails = {
        message: message,
        cursorPosition: cursorpos > 0 ? cursorpos - 1 : 0, // Convert to 0-based
        fileName: filename || undefined,
        functionName: funcnamePtr ? wasmModule.UTF8ToString(funcnamePtr) : undefined,
        lineNumber: lineno > 0 ? lineno : undefined,
        context: contextPtr ? wasmModule.UTF8ToString(contextPtr) : undefined
      };
      
      throw new SqlError(message, errorDetails);
    }
    
    if (!parseTreePtr) {
      throw new Error('libpg_query returned no parse tree: out of WASM memory (heap limit is WASM_MAXIMUM_MEMORY, 1 GiB); parse large inputs in smaller pieces');
    }
    
    const parseTree = wasmModule.UTF8ToString(parseTreePtr);
    return JSON.parse(parseTree);
  }
  finally {
    if (failures === failuresBefore) {
      wasmModule._free(queryPtr);
      if (resultPtr) {
        wasmModule._wasm_free_parse_result(resultPtr);
      }
    }
  }
}