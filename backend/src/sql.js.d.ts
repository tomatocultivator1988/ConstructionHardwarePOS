declare module 'sql.js' {
  export interface SqlJsStatic {
    Database: new (data?: ArrayLike<number> | Buffer | null) => SqlJsDatabase;
  }
  export interface Statement {
    bind(params?: any[]): boolean;
    step(): boolean;
    getAsObject(): Record<string, any>;
    free(): boolean;
    reset(): void;
  }
  export interface QueryExecResult {
    columns: string[];
    values: any[][];
  }
  export interface SqlJsDatabase {
    run(sql: string, params?: any[]): SqlJsDatabase;
    exec(sql: string): QueryExecResult[];
    prepare(sql: string): Statement;
    export(): Uint8Array;
    close(): void;
    getRowsModified(): number;
  }
  export default function initSqlJs(): Promise<SqlJsStatic>;
}
