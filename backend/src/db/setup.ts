import { Database, initDatabase } from './database';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';

let db: Database;
let dbInitPromise: Promise<void> | null = null;
const businessDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore' }).format(new Date());

const CURRENT_SCHEMA_VERSION = '2026.09.26';

export async function initDb(): Promise<void> {
  if (dbInitPromise) return dbInitPromise;
  if (db) return;
  dbInitPromise = (async () => {
    try {
      await initDatabase();
      db = new Database();
      try {
        const ver = await db.prepare("SELECT value FROM settings WHERE key='schema_version'").get() as any;
        if (ver?.value === CURRENT_SCHEMA_VERSION) {
          return;
        }
      } catch {
        // Settings table might not exist yet on fresh DB; proceed to full init
      }
      await initTables();
      await migrateSchema();
      await seedAccountTypes();
      await seedBalanceSheetAccountsIfMissing();
      await seedChartAccountsIfMissing();
      await db.prepare("INSERT INTO settings (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(CURRENT_SCHEMA_VERSION);
    } catch (err) {
      db = undefined as any;
      console.error('Failed to open database:', err);
      throw new Error('Database unavailable');
    }
  })();
  try {
    await dbInitPromise;
  } catch (err) {
    dbInitPromise = null;
    throw err;
  }
}

async function seedAccountTypes() {
  const defaults = [['asset','Asset'],['liability','Liability'],['equity','Equity'],['revenue','Revenue'],['expense','Expense']];
  for (const [baseType, name] of defaults) {
    await db.prepare('INSERT INTO account_types (id,name,base_type) VALUES (?,?,?) ON CONFLICT(name) DO NOTHING').run(baseType, name, baseType);
  }
}

// Creates a coherent starting balance for a fresh/demo database without
// touching sales, stock, cash, or any other POS transaction records.
async function seedBalanceSheetAccountsIfMissing() {
  const existing = await db.prepare("SELECT value FROM settings WHERE key='balance_sheet_manual_accounts'").get() as any;
  const assets = await db.prepare('SELECT COALESCE(SUM(stock * cost_price),0) total FROM materials').get() as any;
  const profit = await db.prepare(`SELECT COALESCE(SUM(net_sales),0) net_sales,
    COALESCE((SELECT SUM((ii.quantity - COALESCE((SELECT SUM(ir.quantity) FROM invoice_returns ir WHERE ir.invoice_item_id=ii.id),0)) * COALESCE(ii.cost_price,m.cost_price,0))
      FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id LEFT JOIN materials m ON m.id=ii.material_id WHERE i.status <> 'voided'),0) cogs,
    COALESCE((SELECT SUM(amount) FROM expenses),0) expenses FROM v_invoice_financials WHERE status <> 'voided'`).get() as any;
  const receivables = await db.prepare(`SELECT COALESCE(SUM(balance),0) total FROM (
    SELECT i.total - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id=i.id),0) + COALESCE((SELECT SUM(r.amount) FROM refunds r WHERE r.invoice_id=i.id),0) balance
    FROM invoices i WHERE i.status <> 'voided'
  ) open_balances WHERE balance > 0`).get() as any;
  const latestCash = await db.prepare("SELECT COALESCE(closing_cash,0) cash FROM cashier_shifts WHERE status='closed' ORDER BY closed_at DESC LIMIT 1").get() as any;
  const retained = Number(profit?.net_sales || 0) - Number(profit?.cogs || 0) - Number(profit?.expenses || 0);
  const knownAssets = Number(assets?.total || 0) + Number(receivables?.total || 0) + Number(latestCash?.cash || 0);
  let current: Record<string, number> = {};
  try { current = JSON.parse(existing?.value || '{}'); } catch { current = {}; }
  // Seed a complete, clearly editable demo set once. These are account
  // balances only; no fake sales, purchases, inventory, or payments are added.
  const demo = {
    bank: 150000, gcash: 50000, supplier_payables: 300000,
    accrued_liabilities: 20000, deferred_income: 0, accrued_salaries: 30000,
    mortgage_payable: 0, other_current_liabilities: 10000,
    long_term_debt: 0, notes_payable: 0, other_long_term_liabilities: 0,
    land: 500000, equipment: 300000, building: 0, other_fixed_assets: 50000,
    trademark: 0, other_assets: 25000, owner_withdrawals: 100000,
  };
  const hasCompleteSeed = ['bank','gcash','supplier_payables','land','equipment','owner_withdrawals'].every(key => Object.prototype.hasOwnProperty.call(current, key));
  if (existing?.value && hasCompleteSeed) return;
  const manualAssets = Number(demo.bank) + Number(demo.gcash) + Number(demo.land) + Number(demo.equipment) + Number(demo.building) + Number(demo.other_fixed_assets) + Number(demo.trademark) + Number(demo.other_assets);
  const manualLiabilities = Number(demo.supplier_payables) + Number(demo.accrued_liabilities) + Number(demo.deferred_income) + Number(demo.accrued_salaries) + Number(demo.mortgage_payable) + Number(demo.other_current_liabilities) + Number(demo.long_term_debt) + Number(demo.notes_payable) + Number(demo.other_long_term_liabilities);
  const ownerCapital = Math.round((knownAssets + manualAssets - manualLiabilities - retained + Number(demo.owner_withdrawals)) * 100) / 100;
  await db.prepare("INSERT INTO settings (key,value) VALUES ('balance_sheet_manual_accounts',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify({ ...demo, owner_capital: ownerCapital }));
}

async function seedChartAccountsIfMissing() {
  const schema = await db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='chart_accounts'").get() as any;
  if (String(schema?.sql || '').includes('CHECK (type IN')) {
    await db.exec(`CREATE TABLE chart_accounts_new (
      id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, type TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT '', description TEXT, opening_balance REAL NOT NULL DEFAULT 0,
      opening_balance_date TEXT, balance_source TEXT NOT NULL DEFAULT 'manual', is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
    );
    INSERT INTO chart_accounts_new SELECT id,code,name,type,category,description,opening_balance,opening_balance_date,balance_source,is_active,created_at,updated_at FROM chart_accounts;
    DROP TABLE chart_accounts;
    ALTER TABLE chart_accounts_new RENAME TO chart_accounts;`);
  }
  const accountInfo = await db.prepare("PRAGMA table_info('chart_accounts')").all() as any[];
  if (!accountInfo.some((r: any) => r.name === 'opening_balance')) await db.exec("ALTER TABLE chart_accounts ADD COLUMN opening_balance REAL NOT NULL DEFAULT 0");
  if (!accountInfo.some((r: any) => r.name === 'opening_balance_date')) await db.exec("ALTER TABLE chart_accounts ADD COLUMN opening_balance_date TEXT");
  if (!accountInfo.some((r: any) => r.name === 'balance_source')) await db.exec("ALTER TABLE chart_accounts ADD COLUMN balance_source TEXT NOT NULL DEFAULT 'manual'");
  if (!accountInfo.some((r: any) => r.name === 'category')) await db.exec("ALTER TABLE chart_accounts ADD COLUMN category TEXT NOT NULL DEFAULT ''");
  const count = await db.prepare('SELECT COUNT(*) count FROM chart_accounts').get() as any;
  const accounts = [
    ['1000','Cash on Hand','asset','POS drawer cash','pos'], ['1010','Bank','asset','Manual bank balance','manual'], ['1020','GCash','asset','Manual GCash balance','manual'],
    ['1100','Accounts Receivable','asset','Unpaid credit balances','pos'], ['1200','Inventory','asset','Inventory at recorded cost','pos'],
    ['2000','Supplier Payables','liability','Manual supplier balances','manual'], ['3000',"Owner's Capital",'equity','Opening owner capital','manual'], ['3100','Retained Earnings','equity','Cumulative POS profit','pos'],
    ['4000','Sales','revenue','POS sales','pos'], ['4100','Sales Returns','revenue','Returned sales','pos'], ['5000','Cost of Goods Sold','expense','Cost of inventory sold','pos'], ['6000','Operating Expenses','expense','Recorded business expenses','pos'],
  ];
  if (Number(count?.count || 0) === 0) {
    const stmt = db.prepare('INSERT INTO chart_accounts (id,code,name,type,description,balance_source) VALUES (?,?,?,?,?,?)');
    for (const account of accounts) await stmt.run(uuidv4(), ...account);
  }
  // Older demo data used different account codes and left POS accounts as
  // manual. Adopt those rows into the canonical POS mapping so reports do not
  // show duplicate/conflicting Cash, A/R, Inventory, Sales, or Returns rows.
  const legacyAliases: Record<string, string[]> = {
    '1000': ['cash on hand', 'cash'], '1010': ['bank'], '1020': ['gcash'],
    '1100': ['accounts receivable'], '1200': ['inventory'],
    '2000': ['supplier payables', 'accounts payable'], '3000': ["owner's capital", 'owner capital'],
    '3100': ['retained earnings'], '4000': ['sales'], '4100': ['sales return', 'sales returns'],
    '5000': ['cost of goods sold', 'cogs'], '6000': ['operating expenses', 'expenses'],
  };
  const canonical = new Set(Object.keys(Object.fromEntries(accounts.map((account) => [account[0], true]))));
  for (const account of accounts) {
    const [code, name, type, description, source] = account as string[];
    const typeRow = await db.prepare('SELECT name FROM account_types WHERE lower(name)=lower(?) OR lower(base_type)=lower(?) ORDER BY CASE WHEN lower(name)=lower(?) THEN 0 ELSE 1 END LIMIT 1').get(type, type, type) as any;
    const accountType = String(typeRow?.name || type);
    let row = await db.prepare('SELECT id FROM chart_accounts WHERE code=?').get(code) as any;
    if (!row) {
      const aliases = legacyAliases[code] || [];
      const candidates = await db.prepare('SELECT id,name FROM chart_accounts WHERE lower(trim(name)) IN (' + aliases.map(() => '?').join(',') + ') ORDER BY is_active DESC, created_at ASC').all(...aliases) as any[];
      if (candidates.length) {
        row = candidates[0];
        await db.prepare('UPDATE chart_accounts SET code=?, name=?, type=?, category=?, description=?, balance_source=?, opening_balance=CASE WHEN ?=\'pos\' THEN 0 ELSE opening_balance END, updated_at=datetime(\'now\') WHERE id=?').run(code, name, accountType, description, description, source, source, row.id);
      }
    }
    if (!row) {
      await db.prepare('INSERT INTO chart_accounts (id,code,name,type,description,balance_source) VALUES (?,?,?,?,?,?)').run(uuidv4(), code, name, accountType, description, source);
    }
    await db.prepare('UPDATE chart_accounts SET balance_source=?, type=?, name=?, description=?, is_active=1 WHERE code=?').run(source, accountType, name, description, code);
  }
  for (const [code, aliases] of Object.entries(legacyAliases)) {
    if (!canonical.has(code)) continue;
    const placeholders = aliases.map(() => '?').join(',');
    await db.prepare(`UPDATE chart_accounts SET is_active=0, updated_at=datetime('now') WHERE code<>? AND lower(trim(name)) IN (${placeholders})`).run(code, ...aliases);
  }
  // Hide known legacy rows even when their names no longer match after a
  // previous partial migration. Custom/manual accounts remain untouched.
  await db.prepare("UPDATE chart_accounts SET is_active=0, updated_at=datetime('now') WHERE code IN ('1001','114','2001','3001','3002','4001','5001','5002','7001','7002')").run();
  const manualRow = await db.prepare("SELECT value FROM settings WHERE key='balance_sheet_manual_accounts'").get() as any;
  let manual: Record<string, number> = {}; try { manual = JSON.parse(manualRow?.value || '{}'); } catch { manual = {}; }
  const map: Record<string, string> = { bank:'1010', gcash:'1020', owner_capital:'3000', supplier_payables:'2000' };
  for (const [key, code] of Object.entries(map)) if (manual[key] !== undefined) await db.prepare('UPDATE chart_accounts SET opening_balance=?, opening_balance_date=?, balance_source=\'manual\' WHERE code=?').run(Number(manual[key]), businessDate(), code);
  for (const code of ['1000','1100','1200','3100','4000','4100','5000','6000']) await db.prepare("UPDATE chart_accounts SET balance_source='pos' WHERE code=?").run(code);
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
      tin TEXT,
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
      supplier_id TEXT,
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
      delivery_person TEXT,
      credit_account_name TEXT,
      buyer_address TEXT,
      notes TEXT,
      idempotency_key TEXT,
      delivery_person_id TEXT,
      delivery_status TEXT NOT NULL DEFAULT 'unassigned' CHECK (delivery_status IN ('unassigned','assigned','delivered')),
      delivered_at TEXT,
      delivered_by TEXT,
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
      cost_price REAL DEFAULT 0,
      total REAL NOT NULL,
      FOREIGN KEY (invoice_id) REFERENCES invoices(id)
    );

    CREATE TABLE IF NOT EXISTS invoice_returns (
      id TEXT PRIMARY KEY,
      invoice_item_id TEXT NOT NULL,
      invoice_id TEXT NOT NULL,
      material_id TEXT NOT NULL,
      quantity REAL NOT NULL CHECK (quantity > 0),
      total_credit REAL NOT NULL DEFAULT 0,
      return_batch_id TEXT,
      idempotency_key TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (invoice_item_id) REFERENCES invoice_items(id),
      FOREIGN KEY (invoice_id) REFERENCES invoices(id),
      FOREIGN KEY (material_id) REFERENCES materials(id)
    );

    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      invoice_id TEXT NOT NULL,
      amount REAL NOT NULL,
      payment_method TEXT NOT NULL DEFAULT 'cash',
      method TEXT NOT NULL,
      payment_date TEXT DEFAULT (datetime('now')),
      notes TEXT,
      idempotency_key TEXT,
      shift_id TEXT,
      FOREIGN KEY (invoice_id) REFERENCES invoices(id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chart_accounts (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('asset','liability','equity','revenue','expense')),
      category TEXT NOT NULL DEFAULT '',
      description TEXT,
      opening_balance REAL NOT NULL DEFAULT 0,
      opening_balance_date TEXT,
      balance_source TEXT NOT NULL DEFAULT 'manual',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS account_types (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      base_type TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS catalog_options (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      UNIQUE(type, name)
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
      notes TEXT,
      mode_of_payment TEXT,
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
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS delivery_personnel (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      phone TEXT,
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS attendance (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      attendance_date TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('present','absent')),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE (user_id, attendance_date),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS attendance_notes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      attendance_date TEXT NOT NULL,
      remarks TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE (user_id, attendance_date),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      action TEXT NOT NULL,
      entity TEXT NOT NULL,
      entity_id TEXT,
      details TEXT,
      old_values TEXT,
      new_values TEXT,
      ip_address TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cashier_shifts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      opened_by TEXT,
      opened_at TEXT DEFAULT (datetime('now')),
      opening_cash REAL NOT NULL CHECK (opening_cash >= 0),
      closed_at TEXT,
      expected_cash REAL,
      closing_cash REAL,
      variance REAL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
      notes TEXT,
      closed_by TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS cash_drawer_events (
      id TEXT PRIMARY KEY,
      shift_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('cash_in','cash_out')),
      amount REAL NOT NULL CHECK (amount > 0),
      reason TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (shift_id) REFERENCES cashier_shifts(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS credit_memos (
      id TEXT PRIMARY KEY,
      invoice_id TEXT NOT NULL,
      memo_number TEXT NOT NULL UNIQUE,
      reason TEXT NOT NULL,
      amount REAL NOT NULL CHECK (amount > 0),
      tax_amount REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','voided')),
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (invoice_id) REFERENCES invoices(id)
    );

    CREATE TABLE IF NOT EXISTS refunds (
      id TEXT PRIMARY KEY,
      invoice_id TEXT NOT NULL,
      credit_memo_id TEXT,
      return_batch_id TEXT,
      shift_id TEXT,
      amount REAL NOT NULL CHECK (amount > 0),
      method TEXT NOT NULL,
      reference TEXT,
      idempotency_key TEXT,
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (invoice_id) REFERENCES invoices(id),
      FOREIGN KEY (credit_memo_id) REFERENCES credit_memos(id)
    );

    INSERT OR IGNORE INTO invoice_sequence (id, next_number) VALUES (1, 1);
    INSERT OR IGNORE INTO po_sequence (id, next_number) VALUES (1, 1);
  `);
  const userCols = await db.prepare("PRAGMA table_info('users')").all() as any[];
  if (!userCols.some((c: any) => c.name === 'is_active')) await db.exec("ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1");
  const catalogDefaults: Record<string, string[]> = {
    category: ['Cement', 'Steel/Rebar', 'Lumber/Wood', 'Plumbing', 'Electrical', 'Paint', 'Hardware', 'Sand/Gravel', 'Roofing', 'Tools', 'Other'],
    unit: ['Each', 'Kilogram', 'Meter', 'Roll', 'Gallon', 'Pieces', 'Liter', 'Box', 'Set', 'Bag', 'Pair', 'Sack', 'Bottle', 'Pack'],
    expense_category: ['Rent', 'Utilities', 'Labor/Salary', 'Delivery/Transport', 'Tools & Equipment', 'Maintenance', 'Supplies', 'Other'],
  };
  for (const [type, names] of Object.entries(catalogDefaults)) for (const name of names) {
    await db.prepare('INSERT OR IGNORE INTO catalog_options (id,type,name) VALUES (?,?,?)').run(uuidv4(), type, name);
  }
}

async function migrateSchema() {
  await db.exec('PRAGMA foreign_keys = ON');
  const itemInfo = (await db.prepare("PRAGMA table_info('invoice_items')").all()) as any[];
  if (!itemInfo.some((r: any) => r.name === 'cost_price')) await db.exec('ALTER TABLE invoice_items ADD COLUMN cost_price REAL DEFAULT 0');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_invoice_returns_item ON invoice_returns(invoice_item_id)');
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
  if (!custCols.includes('tin')) await db.exec("ALTER TABLE customers ADD COLUMN tin TEXT");

  const invoiceInfo = (await db.prepare("PRAGMA table_info('invoices')").all()) as any[];
  const materialInfo = (await db.prepare("PRAGMA table_info('materials')").all()) as any[];
  if (!materialInfo.some((r: any) => r.name === 'supplier_id')) await db.exec("ALTER TABLE materials ADD COLUMN supplier_id TEXT");
  if (!materialInfo.some((r: any) => r.name === 'barcode')) await db.exec("ALTER TABLE materials ADD COLUMN barcode TEXT");
  const invoiceCols = invoiceInfo.map((r: any) => r.name);
  if (!invoiceCols.includes('delivery_person')) await db.exec("ALTER TABLE invoices ADD COLUMN delivery_person TEXT");
  if (!invoiceCols.includes('delivery_person_id')) await db.exec("ALTER TABLE invoices ADD COLUMN delivery_person_id TEXT");
  if (!invoiceCols.includes('delivery_status')) await db.exec("ALTER TABLE invoices ADD COLUMN delivery_status TEXT NOT NULL DEFAULT 'unassigned'");
  if (!invoiceCols.includes('delivered_at')) await db.exec("ALTER TABLE invoices ADD COLUMN delivered_at TEXT");
  if (!invoiceCols.includes('delivered_by')) await db.exec("ALTER TABLE invoices ADD COLUMN delivered_by TEXT");
  const poInfo = (await db.prepare("PRAGMA table_info('purchase_orders')").all()) as any[];
  if (!poInfo.some((r: any) => r.name === 'notes')) await db.exec("ALTER TABLE purchase_orders ADD COLUMN notes TEXT");
  if (!poInfo.some((r: any) => r.name === 'mode_of_payment')) await db.exec("ALTER TABLE purchase_orders ADD COLUMN mode_of_payment TEXT");

  await db.exec("UPDATE invoices SET delivery_status = CASE WHEN delivery_person_id IS NOT NULL AND trim(delivery_person_id) <> '' THEN 'assigned' WHEN delivery_person IS NOT NULL AND trim(delivery_person) <> '' THEN 'assigned' ELSE 'unassigned' END WHERE delivery_status IS NULL OR trim(delivery_status) = ''");

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
  if (!invoiceCols.includes('voided_at')) await db.exec("ALTER TABLE invoices ADD COLUMN voided_at TEXT");
  if (!invoiceCols.includes('voided_by')) await db.exec("ALTER TABLE invoices ADD COLUMN voided_by TEXT");
  if (!invoiceCols.includes('void_reason')) await db.exec("ALTER TABLE invoices ADD COLUMN void_reason TEXT");
  if (!invoiceCols.includes('credit_account_name')) await db.exec("ALTER TABLE invoices ADD COLUMN credit_account_name TEXT");
  if (!invoiceCols.includes('buyer_address')) await db.exec("ALTER TABLE invoices ADD COLUMN buyer_address TEXT");
  if (!invoiceCols.includes('notes')) await db.exec("ALTER TABLE invoices ADD COLUMN notes TEXT");
  if (!invoiceCols.includes('idempotency_key')) await db.exec("ALTER TABLE invoices ADD COLUMN idempotency_key TEXT");
  // Older POS checkouts explicitly inserted NULL instead of allowing the
  // column default to run. Recover those dates from the invoice creation time
  // so they appear in reports and dashboard day totals.
  await db.exec("UPDATE invoices SET issued_date = COALESCE(created_at, datetime('now')) WHERE issued_date IS NULL OR trim(issued_date) = ''");
  const paymentInfo = (await db.prepare("PRAGMA table_info('payments')").all()) as any[];
  if (!paymentInfo.some((r: any) => r.name === 'shift_id')) await db.exec("ALTER TABLE payments ADD COLUMN shift_id TEXT");
  if (!paymentInfo.some((r: any) => r.name === 'idempotency_key')) await db.exec("ALTER TABLE payments ADD COLUMN idempotency_key TEXT");
  const expenseInfo = (await db.prepare("PRAGMA table_info('expenses')").all()) as any[];
  if (!expenseInfo.some((r: any) => r.name === 'payment_method')) await db.exec("ALTER TABLE expenses ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'cash'");
  const refundInfo = (await db.prepare("PRAGMA table_info('refunds')").all()) as any[];
  if (!refundInfo.some((r: any) => r.name === 'shift_id')) await db.exec("ALTER TABLE refunds ADD COLUMN shift_id TEXT");
  if (!refundInfo.some((r: any) => r.name === 'return_batch_id')) await db.exec("ALTER TABLE refunds ADD COLUMN return_batch_id TEXT");
  if (!refundInfo.some((r: any) => r.name === 'idempotency_key')) await db.exec("ALTER TABLE refunds ADD COLUMN idempotency_key TEXT");
  const creditInfo = (await db.prepare("PRAGMA table_info('credit_memos')").all()) as any[];
  if (!creditInfo.some((r: any) => r.name === 'tax_amount')) await db.exec("ALTER TABLE credit_memos ADD COLUMN tax_amount REAL NOT NULL DEFAULT 0");
  const returnInfo = (await db.prepare("PRAGMA table_info('invoice_returns')").all()) as any[];
  if (!returnInfo.some((r: any) => r.name === 'total_credit')) await db.exec("ALTER TABLE invoice_returns ADD COLUMN total_credit REAL NOT NULL DEFAULT 0");
  if (!returnInfo.some((r: any) => r.name === 'return_batch_id')) await db.exec("ALTER TABLE invoice_returns ADD COLUMN return_batch_id TEXT");
  if (!returnInfo.some((r: any) => r.name === 'idempotency_key')) await db.exec("ALTER TABLE invoice_returns ADD COLUMN idempotency_key TEXT");
  const poItemInfo = (await db.prepare("PRAGMA table_info('po_items')").all()) as any[];
  if (!poItemInfo.some((r: any) => r.name === 'selling_price')) await db.exec("ALTER TABLE po_items ADD COLUMN selling_price REAL");
  if (!poItemInfo.some((r: any) => r.name === 'average_price')) await db.exec("ALTER TABLE po_items ADD COLUMN average_price REAL");
  const invoiceColumns = (await db.prepare("PRAGMA table_info('invoices')").all()) as any[];
  if (!invoiceColumns.some((r: any) => r.name === 'amount_received')) await db.exec("ALTER TABLE invoices ADD COLUMN amount_received REAL");
  if (!invoiceColumns.some((r: any) => r.name === 'change_amount')) await db.exec("ALTER TABLE invoices ADD COLUMN change_amount REAL NOT NULL DEFAULT 0");
  if (!invoiceColumns.some((r: any) => r.name === 'discount_amount')) await db.exec("ALTER TABLE invoices ADD COLUMN discount_amount REAL NOT NULL DEFAULT 0");
  const auditInfo = (await db.prepare("PRAGMA table_info('audit_log')").all()) as any[];
  const auditCols = auditInfo.map((r: any) => r.name);
  if (!auditCols.includes('old_values')) await db.exec("ALTER TABLE audit_log ADD COLUMN old_values TEXT");
  if (!auditCols.includes('new_values')) await db.exec("ALTER TABLE audit_log ADD COLUMN new_values TEXT");
  if (!auditCols.includes('ip_address')) await db.exec("ALTER TABLE audit_log ADD COLUMN ip_address TEXT");

  const existingIndexes = (await db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all()) as any[];
  const indexNames = existingIndexes.map((r: any) => r.name);

  if (!indexNames.includes('idx_invoice_items_invoice_id')) {
    await db.exec("CREATE INDEX idx_invoice_items_invoice_id ON invoice_items(invoice_id)");
  }
  if (!indexNames.includes('idx_payments_invoice_id')) {
    await db.exec("CREATE INDEX idx_payments_invoice_id ON payments(invoice_id)");
  }
  if (!indexNames.includes('idx_expenses_date')) {
    await db.exec("CREATE INDEX idx_expenses_date ON expenses(expense_date)");
  }
  if (!indexNames.includes('idx_expenses_category')) {
    await db.exec("CREATE INDEX idx_expenses_category ON expenses(category)");
  }
  if (!indexNames.includes('idx_po_supplier')) {
    await db.exec("CREATE INDEX idx_po_supplier ON purchase_orders(supplier_id)");
  }
  if (!indexNames.includes('idx_po_status')) {
    await db.exec("CREATE INDEX idx_po_status ON purchase_orders(status)");
  }
  if (!indexNames.includes('idx_po_items_po')) {
    await db.exec("CREATE INDEX idx_po_items_po ON po_items(po_id)");
  }
  if (!indexNames.includes('idx_stock_mov_material')) {
    await db.exec("CREATE INDEX idx_stock_mov_material ON stock_movements(material_id)");
  }
  if (!indexNames.includes('idx_stock_mov_type')) {
    await db.exec("CREATE INDEX idx_stock_mov_type ON stock_movements(type)");
  }
  if (!indexNames.includes('idx_audit_entity')) {
    await db.exec("CREATE INDEX idx_audit_entity ON audit_log(entity)");
  }
  if (!indexNames.includes('idx_audit_date')) {
    await db.exec("CREATE INDEX idx_audit_date ON audit_log(created_at)");
  }
  if (!indexNames.includes('idx_payments_date')) {
    await db.exec("CREATE INDEX idx_payments_date ON payments(payment_date)");
  }
  if (!indexNames.includes('idx_invoices_issued_date')) {
    await db.exec("CREATE INDEX idx_invoices_issued_date ON invoices(issued_date)");
  }
  await db.exec('CREATE INDEX IF NOT EXISTS idx_invoices_delivery_person ON invoices(delivery_person_id)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_delivery_personnel_active ON delivery_personnel(active)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_invoices_issued_day ON invoices(date(issued_date))');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_payments_payment_day ON payments(date(payment_date))');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_refunds_created_day ON refunds(date(created_at))');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_expenses_date_day ON expenses(date(expense_date))');
  if (!indexNames.includes('idx_invoices_status')) {
    await db.exec("CREATE INDEX idx_invoices_status ON invoices(status)");
  }
  await db.exec('CREATE INDEX IF NOT EXISTS idx_customers_tin ON customers(tin)');
  await db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_materials_barcode ON materials(barcode) WHERE barcode IS NOT NULL AND barcode <> \'\'');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_shifts_status ON cashier_shifts(status)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_attendance_month ON attendance(attendance_date, user_id)');
  const shiftCols = await db.prepare('PRAGMA table_info(cashier_shifts)').all() as any[];
  if (!shiftCols.some((c: any) => c.name === 'opened_by')) await db.exec('ALTER TABLE cashier_shifts ADD COLUMN opened_by TEXT');
  if (!shiftCols.some((c: any) => c.name === 'closed_by')) await db.exec('ALTER TABLE cashier_shifts ADD COLUMN closed_by TEXT');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_cash_events_shift ON cash_drawer_events(shift_id)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_payments_shift ON payments(shift_id)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_refunds_shift ON refunds(shift_id)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_credit_memos_invoice ON credit_memos(invoice_id)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_invoice_returns_invoice ON invoice_returns(invoice_id)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_refunds_invoice_method ON refunds(invoice_id, method)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_refunds_return_batch ON refunds(return_batch_id)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_invoice_returns_batch ON invoice_returns(return_batch_id)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_payments_invoice_method ON payments(invoice_id, method)');
  await db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_idempotency ON invoices(idempotency_key) WHERE idempotency_key IS NOT NULL AND idempotency_key <> ''");
  await db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_idempotency ON payments(idempotency_key) WHERE idempotency_key IS NOT NULL AND idempotency_key <> ''");
  await db.exec("CREATE INDEX IF NOT EXISTS idx_returns_idempotency ON invoice_returns(invoice_id, idempotency_key)");
  await db.exec("CREATE INDEX IF NOT EXISTS idx_invoices_created_at ON invoices(created_at DESC)");
  await db.exec("CREATE INDEX IF NOT EXISTS idx_invoice_items_material ON invoice_items(material_id)");
  await db.exec("CREATE INDEX IF NOT EXISTS idx_stock_mov_created ON stock_movements(created_at DESC)");

  // Views are created idempotently. Dropping and recreating them on every
  // serverless cold start creates a race when multiple Vercel instances
  // initialize against the same Turso database.
  await db.exec(`
    CREATE VIEW IF NOT EXISTS v_invoice_financials AS
    SELECT i.id AS invoice_id, i.customer_id, i.invoice_number, i.issued_date, i.status,
      i.subtotal, i.tax_rate, i.tax_amount, i.total,
      i.total - COALESCE((SELECT SUM(amount) FROM credit_memos cm WHERE cm.invoice_id=i.id AND cm.status='issued'),0)
        - COALESCE((SELECT SUM(total_credit) FROM invoice_returns ir WHERE ir.invoice_id=i.id),0) AS adjusted_total,
      i.tax_amount - COALESCE((SELECT SUM(tax_amount) FROM credit_memos cm WHERE cm.invoice_id=i.id AND cm.status='issued'),0)
        - CASE WHEN i.tax_rate > 0 THEN COALESCE((SELECT SUM(total_credit) FROM invoice_returns ir WHERE ir.invoice_id=i.id),0) * i.tax_rate / (1+i.tax_rate) ELSE 0 END AS adjusted_tax,
      (i.total - COALESCE((SELECT SUM(amount) FROM credit_memos cm WHERE cm.invoice_id=i.id AND cm.status='issued'),0)
        - COALESCE((SELECT SUM(total_credit) FROM invoice_returns ir WHERE ir.invoice_id=i.id),0))
        - (i.tax_amount - COALESCE((SELECT SUM(tax_amount) FROM credit_memos cm WHERE cm.invoice_id=i.id AND cm.status='issued'),0)
        - CASE WHEN i.tax_rate > 0 THEN COALESCE((SELECT SUM(total_credit) FROM invoice_returns ir WHERE ir.invoice_id=i.id),0) * i.tax_rate / (1+i.tax_rate) ELSE 0 END) AS net_sales,
      COALESCE((SELECT SUM(amount) FROM payments p WHERE p.invoice_id=i.id),0) AS payments_total,
      COALESCE((SELECT SUM(amount) FROM refunds r WHERE r.invoice_id=i.id),0) AS refunds_total,
      COALESCE((SELECT SUM(amount) FROM payments p WHERE p.invoice_id=i.id),0)
        - COALESCE((SELECT SUM(amount) FROM refunds r WHERE r.invoice_id=i.id),0) AS net_collections
    FROM invoices i
  `);
  await db.exec(`
    CREATE VIEW IF NOT EXISTS v_invoice_profit_margin AS
    SELECT ii.invoice_id,
      CASE WHEN SUM(ii.total) > 0
        THEN 1 - (SUM(ii.quantity * COALESCE(ii.cost_price, m.cost_price, 0)) / SUM(ii.total))
        ELSE 0 END AS profit_ratio
    FROM invoice_items ii
    LEFT JOIN materials m ON m.id = ii.material_id
    GROUP BY ii.invoice_id
  `);
  await db.exec(`
    CREATE VIEW IF NOT EXISTS v_invoice_profit_margin_returns AS
    WITH line_values AS (
      SELECT ii.invoice_id,
        MAX(ii.total - COALESCE((SELECT SUM(ir.total_credit) FROM invoice_returns ir WHERE ir.invoice_item_id=ii.id), 0), 0) AS revenue,
        MAX(ii.quantity - COALESCE((SELECT SUM(ir.quantity) FROM invoice_returns ir WHERE ir.invoice_item_id=ii.id), 0), 0)
          * COALESCE(ii.cost_price, m.cost_price, 0) AS cogs
      FROM invoice_items ii
      LEFT JOIN materials m ON m.id=ii.material_id
      GROUP BY ii.id
    )
    SELECT invoice_id, SUM(revenue) AS revenue, SUM(cogs) AS cogs,
      CASE WHEN SUM(revenue) > 0 THEN (SUM(revenue) - SUM(cogs)) / SUM(revenue) ELSE 0 END AS profit_ratio
    FROM line_values GROUP BY invoice_id
  `);

  // Create default admin if no users exist
  const userCount = (await db.prepare('SELECT COUNT(*) as cnt FROM users').get()) as any;
  if (userCount.cnt === 0) {
    try {
      const hash = bcrypt.hashSync('0000', 10);
      await db.prepare('INSERT INTO users (id, username, pin_hash, role) VALUES (?, ?, ?, ?)').run(uuidv4(), 'admin', hash, 'admin');
      console.log('Default admin user created (username: admin, PIN: 0000)');
    } catch (e: any) {
      console.error('Failed to create admin user:', e.message);
    }
  }
}
