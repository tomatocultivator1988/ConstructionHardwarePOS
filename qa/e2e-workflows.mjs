/*
 * BuildPro POS workflow smoke test.
 * Run only against a disposable QA deployment/database:
 *   QA_BASE_URL=https://... QA_TOKEN=... QA_ALLOW_MUTATION=true npm run qa:e2e
 * The opt-in guard is intentional; this test creates invoices and stock movements.
 */
import assert from 'node:assert/strict';

const base = process.env.QA_BASE_URL;
if (process.env.QA_ALLOW_MUTATION !== 'true' || !base || !process.env.QA_TOKEN) {
  console.error('Refusing to run: set QA_BASE_URL, QA_TOKEN, and QA_ALLOW_MUTATION=true against a disposable QA database.');
  process.exit(2);
}

const headers = { Authorization: `Bearer ${process.env.QA_TOKEN}`, 'Content-Type': 'application/json' };
async function call(path, options = {}) {
  const response = await fetch(`${base.replace(/\/$/, '')}/api${path}`, { ...options, headers: { ...headers, ...(options.headers || {}) } });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  assert.ok(response.ok, `${options.method || 'GET'} ${path}: ${body?.error || response.status}`);
  return body;
}
const post = (path, body) => call(path, { method: 'POST', body: JSON.stringify(body) });
const put = (path, body) => call(path, { method: 'PUT', body: JSON.stringify(body) });

const marker = `QA-${Date.now()}`;
const shift = await post('/shifts/open', { opening_cash: 100 });
const rejectedCashOut = await fetch(`${base.replace(/\/$/, '')}/api/shifts/${shift.id}/event`, { method: 'POST', headers, body: JSON.stringify({ type: 'cash_out', amount: 101, reason: 'Too much' }) });
assert.equal(rejectedCashOut.status, 400, 'cash-out above drawer balance must be rejected');
const material = await post('/materials', { name: `${marker} Material`, unit: 'Piece', stock: 20, cost_price: 10, price_per_unit: 25, wholesale_price: 20, reorder_point: 2, category: 'Other' });
const customer = await post('/customers', { name: `${marker} Customer`, address: 'QA Test Address', tin: '000-000-000-000' });
const invoice = await post('/invoices', { customer_id: customer.id, tax_rate: 0, items: [{ material_id: material.id, description: material.name, quantity: 2, unit_price: 25 }] });
assert.equal(invoice.total, 50);
const afterSale = await call(`/materials/${material.id}`);
assert.equal(Number(afterSale.stock), 18);
await post(`/invoices/${invoice.id}/pay`, { amount: 50, method: 'cash' });
await post(`/invoices/${invoice.id}/return`, { items: [{ invoice_item_id: invoice.items[0].id, material_id: material.id, quantity: 1 }] });
const afterReturn = await call(`/invoices/${invoice.id}`);
assert.equal(Number(afterReturn.adjusted_total), 25);
await post(`/invoices/${invoice.id}/refund`, { amount: 25, method: 'cash', reference: marker });
await post(`/invoices/${invoice.id}/credit-memo`, { amount: 10, reason: 'QA adjustment' });
const adjusted = await call(`/invoices/${invoice.id}`);
assert.equal(Number(adjusted.adjusted_total), 15);
assert.equal(Number(adjusted.adjusted_tax), 0);
const summary = await call('/reports/financial-summary?from=2000-01-01&to=2100-01-01');
assert.ok(Number(summary.net_sales) >= 15, 'financial summary should include adjusted net sales');
assert.ok(Number(summary.refunds) >= 25, 'financial summary should include refunds');
const closed = await post(`/shifts/${shift.id}/close`, { closing_cash: 125 });
assert.equal(closed.status, 'closed');
assert.equal(Number(closed.expected_cash), 125);
await put(`/invoices/${invoice.id}/void`, { reason: 'QA cleanup' });
const voided = await call(`/invoices/${invoice.id}`);
assert.equal(voided.status, 'voided');
const audit = await call('/audit');
const auditedEntities = new Set(audit.filter((entry) => [invoice.id, material.id, customer.id, shift.id].includes(entry.entity_id)).map((entry) => entry.entity));
for (const entity of ['invoice', 'material', 'customer', 'cashier_shift']) assert.ok(auditedEntities.has(entity), `audit log missing ${entity}`);
console.log('BuildPro POS E2E workflow checks passed:', marker);
