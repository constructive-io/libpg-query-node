declare module '../proto.js' {
  export namespace pg_query {
    interface ParseResult {
      version: number;
      stmts: Statement[];
    }

    interface Statement {
      stmt_type: string;
      stmt_len: number;
      stmt_location: number;
      query: string;
    }

    class ParseResult {
      static fromObject(obj: ParseResult): ParseResult;
      static encode(msg: ParseResult): { finish(): Uint8Array };
    }
  }
} 