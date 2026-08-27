// Minimal type declarations for Node's built-in `node:sqlite` module
// (available since Node 22.5). @types/node 20 does not ship these yet.
declare module 'node:sqlite' {
  export interface StatementSync {
    run(...params: unknown[]): { lastInsertRowid: number | bigint; changes: number };
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
  }

  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
