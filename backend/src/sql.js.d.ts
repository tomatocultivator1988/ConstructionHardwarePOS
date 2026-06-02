declare module 'sql.js' {
  interface SqlJsStatic {
    Database: new (data?: ArrayLike<number> | Buffer | null) => Database;
  }
  interface Statement {
    bind(params?: any[]): boolean;
    step(): boolean;
    getAsObject(): Record<string, any>;
    free(): boolean;
    reset(): void;
  }
  interface QueryExecResult {
    columns: string[];
    values: any[][];
  }
  interface Database {
    run(sql: string, params?: any[]): Database;
    exec(sql: string): QueryExecResult[];
    prepare(sql: string): Statement;
    export(): Uint8Array;
    close(): void;
    getRowsModified(): number;
  }
  export default function initSqlJs(): Promise<SqlJsStatic>;
}
