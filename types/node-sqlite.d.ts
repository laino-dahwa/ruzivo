// The slice of Node's built-in SQLite module (Node 22.5+) that
// __tests__/sync.test.ts uses to stand in for Cloudflare D1. @types/node 20
// predates it; delete this file once @types/node is 22 or newer.
declare module 'node:sqlite' {
  type SQLValue = null | number | bigint | string | Uint8Array;
  export class StatementSync {
    run(...params: SQLValue[]): { changes: number | bigint; lastInsertRowid: number | bigint };
    get(...params: SQLValue[]): unknown;
    all(...params: SQLValue[]): unknown[];
  }
  export class DatabaseSync {
    constructor(path: string, options?: Record<string, unknown>);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
