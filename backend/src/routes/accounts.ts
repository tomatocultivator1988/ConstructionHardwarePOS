import { Router, Request, Response } from 'express';
import { getDb } from '../db/setup';
import { requireAdmin } from '../lib/auth';
import { v4 as uuidv4 } from 'uuid';

const router = Router();
const types = new Set(['asset','liability','equity','revenue','expense']);
const manualSettingByCode: Record<string, string> = { '1010': 'bank', '1020': 'gcash', '2000': 'supplier_payables', '3000': 'owner_capital' };
router.use(requireAdmin);

router.get('/', async (req: Request, res: Response) => {
  const db = getDb();
  const type = String(req.query.type || '').trim();
  const where = type && types.has(type) ? 'WHERE type = ?' : '';
  const rows = await db.prepare(`SELECT id, code, name, type, description, opening_balance, opening_balance_date, balance_source, is_active, created_at, updated_at FROM chart_accounts ${where} ORDER BY code`).all(...(where ? [type] : [])) as any[];
  const [sales, returns, cogs, expenses, payments, refunds, inventory, receivables, manualRow] = await Promise.all([
    db.prepare("SELECT COALESCE(SUM(net_sales),0) value FROM v_invoice_financials WHERE status <> 'voided'").get(),
    db.prepare("SELECT COALESCE(SUM(total_credit),0) value FROM invoice_returns").get(),
    db.prepare("SELECT COALESCE(SUM((ii.quantity - COALESCE((SELECT SUM(ir.quantity) FROM invoice_returns ir WHERE ir.invoice_item_id=ii.id),0)) * COALESCE(ii.cost_price,m.cost_price,0)),0) value FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id LEFT JOIN materials m ON m.id=ii.material_id WHERE i.status <> 'voided'").get(),
    db.prepare("SELECT COALESCE(SUM(amount),0) value FROM expenses").get(),
    db.prepare("SELECT method, COALESCE(SUM(amount),0) value FROM payments p JOIN invoices i ON i.id=p.invoice_id WHERE i.status <> 'voided' AND p.method <> 'credit' GROUP BY method").all(),
    db.prepare("SELECT method, COALESCE(SUM(amount),0) value FROM refunds r JOIN invoices i ON i.id=r.invoice_id WHERE i.status <> 'voided' GROUP BY method").all(),
    db.prepare("SELECT COALESCE(SUM(stock * cost_price),0) value FROM materials").get(),
    db.prepare("SELECT COALESCE(SUM(adjusted_total - net_collections),0) value FROM v_invoice_financials WHERE status <> 'voided' AND adjusted_total > net_collections").get(),
    db.prepare("SELECT value FROM settings WHERE key='balance_sheet_manual_accounts'").get(),
  ]);
  const amount = (result: any) => Number(result?.value || 0);
  const byMethod = (result: any[], method: string) => Number(result.find(row => String(row.method).toLowerCase() === method)?.value || 0);
  let manual: Record<string, number> = {}; try { manual = JSON.parse((manualRow as any)?.value || '{}'); } catch { manual = {}; }
  const balances: Record<string, number> = {
    '1000': byMethod(payments as any[], 'cash') - byMethod(refunds as any[], 'cash'),
    '1010': Number(rows.find(row => row.code === '1010')?.opening_balance || 0) + byMethod(payments as any[], 'bank') - byMethod(refunds as any[], 'bank'),
    '1020': Number(rows.find(row => row.code === '1020')?.opening_balance || 0) + byMethod(payments as any[], 'gcash') - byMethod(refunds as any[], 'gcash'),
    '1100': amount(receivables), '1200': amount(inventory), '2000': Number(manual.supplier_payables || 0),
    '3000': Number(rows.find(row => row.code === '3000')?.opening_balance || manual.owner_capital || 0), '3100': amount(sales) - amount(cogs) - amount(expenses),
    '4000': amount(sales), '4100': amount(returns), '5000': amount(cogs), '6000': amount(expenses),
  };
  res.json(rows.map(row => ({ ...row, balance: Math.round((balances[row.code] ?? Number(row.opening_balance || manual[row.code] || 0)) * 100) / 100 })));
});

router.post('/', async (req: Request, res: Response) => {
  const db = getDb();
  const code = String(req.body?.code || '').trim();
  const name = String(req.body?.name || '').trim();
  const type = String(req.body?.type || '').trim();
  const description = String(req.body?.description || '').trim();
  const openingBalance = Number(req.body?.opening_balance || 0);
  const openingDate = req.body?.opening_balance_date ? String(req.body.opening_balance_date) : null;
  if (!/^\d{3,6}$/.test(code) || !name || !types.has(type)) return res.status(400).json({ error: 'Code, name, and a valid account type are required' });
  try {
    await db.prepare('INSERT INTO chart_accounts (id,code,name,type,description,opening_balance,opening_balance_date,balance_source) VALUES (?,?,?,?,?,?,?,?)').run(uuidv4(), code, name, type, description, openingBalance, openingDate, 'manual');
    res.status(201).json({ ok: true });
  } catch (e: any) { res.status(400).json({ error: e.message?.includes('UNIQUE') ? 'Account code already exists' : 'Unable to create account' }); }
});

router.put('/:id', async (req: Request, res: Response) => {
  const db = getDb();
  const code = String(req.body?.code || '').trim();
  const name = String(req.body?.name || '').trim();
  const type = String(req.body?.type || '').trim();
  const description = String(req.body?.description || '').trim();
  const openingBalance = Number(req.body?.opening_balance || 0);
  const openingDate = req.body?.opening_balance_date ? String(req.body.opening_balance_date) : null;
  const current = await db.prepare('SELECT balance_source FROM chart_accounts WHERE id=?').get(req.params.id) as any;
  if (current?.balance_source === 'pos' && (req.body?.opening_balance !== undefined || req.body?.opening_balance_date !== undefined)) return res.status(400).json({ error: 'POS-connected account balances are calculated automatically' });
  if (!/^\d{3,6}$/.test(code) || !name || !types.has(type)) return res.status(400).json({ error: 'Code, name, and a valid account type are required' });
  try {
    await db.prepare("UPDATE chart_accounts SET code=?, name=?, type=?, description=?, opening_balance=?, opening_balance_date=?, updated_at=datetime('now') WHERE id=?").run(code, name, type, description, openingBalance, openingDate, req.params.id);
    const settingKey = manualSettingByCode[code];
    if (settingKey) {
      const existing = await db.prepare("SELECT value FROM settings WHERE key='balance_sheet_manual_accounts'").get() as any;
      let settings: Record<string, number> = {}; try { settings = JSON.parse(existing?.value || '{}'); } catch { settings = {}; }
      settings[settingKey] = openingBalance;
      await db.prepare("INSERT INTO settings (key,value) VALUES ('balance_sheet_manual_accounts',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(settings));
    }
    res.json({ ok: true });
  }
  catch (e: any) { res.status(400).json({ error: e.message?.includes('UNIQUE') ? 'Account code already exists' : 'Unable to update account' }); }
});

router.put('/:id/status', async (req: Request, res: Response) => {
  const db = getDb();
  await db.prepare("UPDATE chart_accounts SET is_active=?, updated_at=datetime('now') WHERE id=?").run(req.body?.is_active ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

export default router;
