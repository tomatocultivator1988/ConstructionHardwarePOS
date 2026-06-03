import { Database, initDatabase } from './database';

let db: Database;

export async function initDb(): Promise<void> {
  if (db) return;
  try {
    await initDatabase();
    db = new Database();
    await initTables();
    await migrateSchema();
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

async function initTables() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      address TEXT,
      is_wholesale INTEGER DEFAULT 0,
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
      wholesale_price REAL DEFAULT 0,
      reorder_point REAL DEFAULT 10,
      category TEXT DEFAULT '',
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
      user_id TEXT,
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

    CREATE TABLE IF NOT EXISTS expenses (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      amount REAL NOT NULL,
      description TEXT,
      vendor TEXT,
      expense_date TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      contact_person TEXT,
      phone TEXT,
      email TEXT,
      address TEXT,
      tin TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS purchase_orders (
      id TEXT PRIMARY KEY,
      supplier_id TEXT NOT NULL,
      po_number TEXT NOT NULL UNIQUE,
      status TEXT DEFAULT 'pending',
      total REAL NOT NULL,
      order_date TEXT NOT NULL,
      received_date TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
    );

    CREATE TABLE IF NOT EXISTS po_items (
      id TEXT PRIMARY KEY,
      po_id TEXT NOT NULL,
      material_id TEXT,
      description TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit_cost REAL NOT NULL,
      total REAL NOT NULL,
      FOREIGN KEY (po_id) REFERENCES purchase_orders(id)
    );

    CREATE TABLE IF NOT EXISTS po_sequence (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      next_number INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS stock_movements (
      id TEXT PRIMARY KEY,
      material_id TEXT NOT NULL,
      type TEXT NOT NULL,
      quantity REAL NOT NULL,
      reference_id TEXT,
      reference_type TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (material_id) REFERENCES materials(id)
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      pin_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'staff',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      action TEXT NOT NULL,
      entity TEXT NOT NULL,
      entity_id TEXT,
      details TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    INSERT OR IGNORE INTO invoice_sequence (id, next_number) VALUES (1, 1);
    INSERT OR IGNORE INTO po_sequence (id, next_number) VALUES (1, 1);
  `);
}

async function migrateSchema() {
  const tableInfo = (await db.prepare("PRAGMA table_info('materials')").all()) as any[];
  const materialCols = tableInfo.map((r: any) => r.name);

  if (!materialCols.includes('reorder_point')) {
    await db.exec("ALTER TABLE materials ADD COLUMN reorder_point REAL DEFAULT 10");
  }
  if (!materialCols.includes('cost_price')) {
    await db.exec("ALTER TABLE materials ADD COLUMN cost_price REAL DEFAULT 0");
  }
  if (!materialCols.includes('category')) {
    await db.exec("ALTER TABLE materials ADD COLUMN category TEXT DEFAULT ''");
  }
  if (!materialCols.includes('wholesale_price')) {
    await db.exec("ALTER TABLE materials ADD COLUMN wholesale_price REAL DEFAULT 0");
  }

  const custInfo = (await db.prepare("PRAGMA table_info('customers')").all()) as any[];
  const custCols = custInfo.map((r: any) => r.name);
  if (!custCols.includes('is_wholesale')) {
    await db.exec("ALTER TABLE customers ADD COLUMN is_wholesale INTEGER DEFAULT 0");
  }

  const invoiceInfo = (await db.prepare("PRAGMA table_info('invoices')").all()) as any[];
  const invoiceCols = invoiceInfo.map((r: any) => r.name);

  if (!invoiceCols.includes('subtotal')) {
    await db.exec("ALTER TABLE invoices ADD COLUMN subtotal REAL DEFAULT 0");
  }
  if (!invoiceCols.includes('tax_rate')) {
    await db.exec("ALTER TABLE invoices ADD COLUMN tax_rate REAL DEFAULT 0");
  }
  if (!invoiceCols.includes('tax_amount')) {
    await db.exec("ALTER TABLE invoices ADD COLUMN tax_amount REAL DEFAULT 0");
  }
  if (!invoiceCols.includes('user_id')) {
    await db.exec("ALTER TABLE invoices ADD COLUMN user_id TEXT");
  }

  const existingIndexes = (await db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all()) as any[];
  const indexNames = existingIndexes.map((r: any) => r.name);

  const idxList = [
    'idx_invoice_items_invoice_id', 'idx_payments_invoice_id',
    'idx_expenses_date', 'idx_expenses_category',
    'idx_po_supplier', 'idx_po_status', 'idx_po_items_po',
    'idx_stock_mov_material', 'idx_stock_mov_type',
    'idx_audit_entity', 'idx_audit_date',
  ];

  for (const idx of idxList) {
    if (!indexNames.includes(idx)) {
      const create = idx.replace('idx_', 'CREATE INDEX IF NOT EXISTS ' + idx + ' ON ').replace(/_/g, ' ').split(' ').slice(0, -1).join('_');
      // Use simple approach: create index if not exists
      await db.exec(`CREATE INDEX IF NOT EXISTS ${idx} ON ${idx.split('_').slice(1).join('_')}(${idx.split('_').pop()})`);
    }
  }

  await db.exec('DROP VIEW IF EXISTS v_invoice_profit_margin');
  await db.exec(`
    CREATE VIEW IF NOT EXISTS v_invoice_profit_margin AS
    SELECT ii.invoice_id,
      CASE WHEN SUM(ii.total) > 0
        THEN 1 - (SUM(ii.quantity * COALESCE(m.cost_price, 0)) / SUM(ii.total))
        ELSE 0 END AS profit_ratio
    FROM invoice_items ii
    LEFT JOIN materials m ON m.id = ii.material_id
    GROUP BY ii.invoice_id
  `);

  // Create default admin if no users exist
  const userCount = (await db.prepare('SELECT COUNT(*) as cnt FROM users').get()) as any;
  if (userCount.cnt === 0) {
    const bcrypt = require('bcryptjs');
    const hash = bcrypt.hashSync('0000', 10);
    await db.prepare('INSERT INTO users (id, username, pin_hash, role) VALUES (?, ?, ?, ?)').run(require('uuid').v4(), 'admin', hash, 'admin');
    console.log('Default admin user created (username: admin, PIN: 0000)');
  }
}
