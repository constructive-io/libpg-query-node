/**
 * DO NOT MODIFY MANUALLY — this is generated from the templates dir
 * 
 * To make changes, edit the files in the templates/ directory and run:
 * npm run copy:templates
 */

declare module './libpg-query.js' {
  interface WasmModule {
    _malloc: (size: number) => number;
    _free: (ptr: number) => void;
    _wasm_free_string: (ptr: number) => void;
    _wasm_parse_query: (queryPtr: number) => number;
    lengthBytesUTF8: (str: string) => number;
    stringToUTF8: (str: string, ptr: number, len: number) => void;
    UTF8ToString: (ptr: number) => string;
    HEAPU8: Uint8Array;
  }

  const PgQueryModule: () => Promise<WasmModule>;
  export default PgQueryModule;
} 