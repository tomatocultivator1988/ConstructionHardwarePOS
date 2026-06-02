import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.join(__dirname, '..', '..', 'data', 'construction_pos.db');

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initTables();
    migrateSchema();
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
}
