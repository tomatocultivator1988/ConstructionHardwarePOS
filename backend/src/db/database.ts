import initSqlJs, { SqlJsStatic, SqlJsDatabase } from 'sql.js';
import fs from 'fs';
import path from 'path';

let SQL: SqlJsStatic;

export async function initDatabase(): Promise<void> {
  SQL = await initSqlJs();
}

class StatementWrapper {
  private db: SqlJsDatabase;
  private sql: string;
  private stmt: any;
  private autoSave: () => void;

  constructor(db: SqlJsDatabase, sql: string, autoSave: () => void) {
    this.db = db;
    this.sql = sql;
    this.autoSave = autoSave;
    this.stmt = null;
  }

  private getStmt() {
    if (!this.stmt) {
      this.stmt = this.db.prepare(this.sql);
    }
    return this.stmt;
  }

  private freeStmt() {
    if (this.stmt) {
      try { this.stmt.free(); } catch {}
      this.stmt = null;
    }
  }

  all(...params: any[]): any[] {
    if (params.length) {
      const stmt = this.getStmt();
      stmt.bind(params);
      const rows: any[] = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject());
      }
      this.freeStmt();
      return rows;
    }
    const stmt = this.getStmt();
    const rows: any[] = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    this.freeStmt();
    return rows;
  }

  get(...params: any[]): any {
    if (params.length) {
      const stmt = this.getStmt();
      stmt.bind(params);
      const hasRow = stmt.step();
      if (!hasRow) { this.freeStmt(); return undefined; }
      const row = stmt.getAsObject();
      this.freeStmt();
      return row;
    }
    const stmt = this.getStmt();
    const hasRow = stmt.step();
    if (!hasRow) { this.freeStmt(); return undefined; }
    const row = stmt.getAsObject();
    this.freeStmt();
    return row;
  }

  run(...params: any[]): { changes: number } {
    if (params.length) {
      const stmt = this.getStmt();
      stmt.bind(params);
      stmt.step();
    } else {
      const stmt = this.getStmt();
      stmt.step();
    }
    this.freeStmt();
    this.autoSave();
    return { changes: 0 };
  }
}

export class Database {
  private db: SqlJsDatabase;
  private dbPath: string;
  private txDepth: number;

  constructor(filePath: string) {
    this.dbPath = filePath;
    this.txDepth = 0;
    let buffer: Buffer | undefined;
    try {
      buffer = fs.readFileSync(filePath);
    } catch {}
    this.db = new SQL.Database(buffer);
    this.db.exec('PRAGMA foreign_keys = ON');
  }

  private autoSave() {
    if (this.txDepth > 0) return;
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const data = this.db.export();
    fs.writeFileSync(this.dbPath, Buffer.from(data));
  }

  prepare(sql: string): StatementWrapper {
    return new StatementWrapper(this.db, sql, () => this.autoSave());
  }

  exec(sql: string): void {
    this.db.exec(sql);
    this.autoSave();
  }

  transaction<T>(fn: () => T): () => T {
    return () => {
      this.db.exec('BEGIN');
      this.txDepth++;
      try {
        const result = fn();
        this.db.exec('COMMIT');
        this.txDepth--;
        this.autoSave();
        return result;
      } catch (e) {
        this.db.exec('ROLLBACK');
        this.txDepth--;
        throw e;
      }
    };
  }
}
