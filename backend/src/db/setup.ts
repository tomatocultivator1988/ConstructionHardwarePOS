import path from 'path';
import { Database, initDatabase } from './database';

const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'data', 'construction_pos.db');

let db: Database;

export async function initDb(): Promise<void> {
  if (db) return;
  try {
    await initDatabase();
    db = new Database(dbPath);
    initTables();
    migrateSchema();
  } catch (err) {
    console.error('Failed to open database:', err);
    throw new Error('Database unavailable');
  }
}

export function getDb(): Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return db;
}

function initTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      address TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS materials (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      unit TEXT NOT NULL,
      stock REAL DEFAULT 0,
      cost_price REAL DEFAULT 0,
      price_per_unit REAL NOT NULL,
      reorder_point REAL DEFAULT 10,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      customer_id TEXT,
      invoice_number TEXT NOT NULL,
      subtotal REAL DEFAULT 0,
      tax_rate REAL DEFAULT 0,
      tax_amount REAL DEFAULT 0,
      total REAL DEFAULT 0,
      status TEXT DEFAULT 'pending',
      issued_date TEXT DEFAULT (datetime('now')),
      due_date TEXT,
      paid_date TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    );

    CREATE TABLE IF NOT EXISTS invoice_items (
      id TEXT PRIMARY KEY,
      invoice_id TEXT NOT NULL,
      material_id TEXT,
      description TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit_price REAL NOT NULL,
      total REAL NOT NULL,
      FOREIGN KEY (invoice_id) REFERENCES invoices(id)
    );

    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      invoice_id TEXT NOT NULL,
      amount REAL NOT NULL,
      method TEXT NOT NULL,
      payment_date TEXT DEFAULT (datetime('now')),
      notes TEXT,
      FOREIGN KEY (invoice_id) REFERENCES invoices(id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS invoice_sequence (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      next_number INTEGER NOT NULL DEFAULT 1
    );

    INSERT OR IGNORE INTO invoice_sequence (id, next_number) VALUES (1, 1);
  `);
}

function migrateSchema() {
  const tableInfo = db.prepare("PRAGMA table_info('materials')").all() as any[];
  const materialCols = tableInfo.map(r => r.name);

  if (!materialCols.includes('reorder_point')) {
    db.exec("ALTER TABLE materials ADD COLUMN reorder_point REAL DEFAULT 10");
  }

  if (!materialCols.includes('cost_price')) {
    db.exec("ALTER TABLE materials ADD COLUMN cost_price REAL DEFAULT 0");
  }

  const invoiceInfo = db.prepare("PRAGMA table_info('invoices')").all() as any[];
  const invoiceCols = invoiceInfo.map(r => r.name);

  if (!invoiceCols.includes('subtotal')) {
    db.exec("ALTER TABLE invoices ADD COLUMN subtotal REAL DEFAULT 0");
  }
  if (!invoiceCols.includes('tax_rate')) {
    db.exec("ALTER TABLE invoices ADD COLUMN tax_rate REAL DEFAULT 0");
  }
  if (!invoiceCols.includes('tax_amount')) {
    db.exec("ALTER TABLE invoices ADD COLUMN tax_amount REAL DEFAULT 0");
  }

  const existingIndexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('idx_invoice_items_invoice_id', 'idx_payments_invoice_id')").all() as any[];
  const indexNames = existingIndexes.map((r: any) => r.name);

  if (!indexNames.includes('idx_invoice_items_invoice_id')) {
    db.exec("CREATE INDEX idx_invoice_items_invoice_id ON invoice_items(invoice_id)");
  }
  if (!indexNames.includes('idx_payments_invoice_id')) {
    db.exec("CREATE INDEX idx_payments_invoice_id ON payments(invoice_id)");
  }

  db.exec('DROP VIEW IF EXISTS v_invoice_profit_margin');
  db.exec(`
    CREATE VIEW IF NOT EXISTS v_invoice_profit_margin AS
    SELECT ii.invoice_id,
      CASE WHEN SUM(ii.total) > 0
        THEN 1 - (SUM(ii.quantity * COALESCE(m.cost_price, 0)) / SUM(ii.total))
        ELSE 0 END AS profit_ratio
    FROM invoice_items ii
    LEFT JOIN materials m ON m.id = ii.material_id
    GROUP BY ii.invoice_id
  `);
}
