import { createClient, Client } from '@libsql/client';

const TURSO_URL = process.env.TURSO_URL!;
const TURSO_TOKEN = process.env.TURSO_TOKEN!;

let client: Client;

export async function initDatabase(): Promise<void> {
  client = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });
}

class StatementWrapper {
  private sql: string;
  private params: any[];

  constructor(sql: string) {
    this.sql = sql;
    this.params = [];
  }

  bind(...params: any[]): this {
    this.params = params;
    return this;
  }

  async all(...params: any[]): Promise<any[]> {
    const args = params.length ? params : this.params;
    const r = await client.execute({ sql: this.sql, args });
    return r.rows as any[];
  }

  async get(...params: any[]): Promise<any> {
    const args = params.length ? params : this.params;
    const r = await client.execute({ sql: this.sql, args });
    return r.rows[0] || null;
  }

  async run(...params: any[]): Promise<{ changes: number; lastInsertRowid: bigint | number }> {
    const args = params.length ? params : this.params;
    const r = await client.execute({ sql: this.sql, args });
    return { changes: r.rowsAffected, lastInsertRowid: Number(r.lastInsertRowid ?? 0) };
  }
}

export class Database {
  prepare(sql: string): StatementWrapper {
    return new StatementWrapper(sql);
  }

  async exec(sql: string): Promise<void> {
    await client.executeMultiple(sql);
  }

  transaction(fn: () => void | Promise<void>): () => Promise<void> {
    return async () => {
      const txn = await client.transaction('write');
      try {
        await fn();
        await txn.commit();
      } catch (e) {
        await txn.rollback();
        throw e;
      }
    };
  }
}
