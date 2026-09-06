/* BuildPro POS admin/staff shift and POS E2E test.
 * Run only against a disposable QA database:
 * QA_BASE_URL=https://... QA_ADMIN_USER=admin QA_ADMIN_PIN=... QA_ALLOW_MUTATION=true npm run qa:e2e
 */
import assert from 'node:assert/strict';

const base = (process.env.QA_BASE_URL || '').replace(/\/$/, '');
const host = (() => { try { return new URL(base).hostname; } catch { return ''; } })();
const productionHosts = ['buildpro-pos.vercel.app', 'construction-pos1-6ufbc6iaf-huhus-projects-444565d7.vercel.app'];
if (process.env.QA_ALLOW_MUTATION !== 'true' || !base || (productionHosts.includes(host) && process.env.QA_ALLOW_PRODUCTION !== 'true')) {
  console.error('Refusing to run: use a disposable QA database and set QA_ALLOW_MUTATION=true. Production additionally requires QA_ALLOW_PRODUCTION=true.'); process.exit(2);
}

const adminUser = process.env.QA_ADMIN_USER || 'admin';
const adminPin = process.env.QA_ADMIN_PIN || '0000';
const marker = `QA-SHIFT-${Date.now()}`;

async function request(path, { token, method = 'GET', body, expected } = {}) {
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 20000);
  let response;
  try {
    response = await fetch(`${base}/api${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal });
  } catch (error) {
    throw new Error(`${method} ${path} failed: ${error?.message || error}`);
  } finally { clearTimeout(timeout); }
  const text = await response.text(); let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (expected !== undefined) assert.equal(response.status, expected, `${method} ${path}: ${data?.error || response.status}`);
  else assert.ok(response.ok, `${method} ${path}: ${data?.error || response.status}`);
  return data;
}
async function login(username, pin, expected = 200) { return (await request('/auth/login', { method: 'POST', body: { username, pin }, expected }))?.token; }

const adminToken = await login(adminUser, adminPin);
const staffUser = `${marker.toLowerCase()}-cashier`; const staffPin = '2468';
await request('/users', { token: adminToken, method: 'POST', body: { username: staffUser, pin: staffPin, role: 'staff' }, expected: 201 });
await login(staffUser, staffPin, 403);

const users = await request('/users', { token: adminToken });
const staffRecord = users.find(u => u.username === staffUser); assert.ok(staffRecord);
const shift = await request('/shifts/open', { token: adminToken, method: 'POST', body: { user_id: staffRecord.id, opening_cash: 100 }, expected: 201 });
const staffToken = await login(staffUser, staffPin);
assert.equal(shift.user_id, staffRecord.id);

await request('/shifts/open', { token: adminToken, method: 'POST', body: { user_id: staffRecord.id, opening_cash: 100 }, expected: 409 });
await request('/reports/daily?date=2026-01-01', { token: staffToken, expected: 403 });
await request('/materials', { token: staffToken, method: 'POST', body: { name: `${marker} Forbidden`, unit: 'Piece', stock: 1, cost_price: 1, price_per_unit: 2 }, expected: 403 });
await request('/shifts/active', { token: staffToken, expected: 403 });

const material = await request('/materials', { token: adminToken, method: 'POST', body: { name: `${marker} Product`, unit: 'Piece', stock: 10, cost_price: 10, price_per_unit: 20, wholesale_price: 18, reorder_point: 2, category: 'Other', barcode: `${marker}-BARCODE` }, expected: 201 });
const invoice = await request('/invoices', { token: staffToken, method: 'POST', body: { customer_id: null, tax_rate: 0, items: [{ material_id: material.id, description: material.name, quantity: 1, unit_price: 20 }], payment: { amount: 20, method: 'cash', notes: '' } }, expected: 201 });
assert.equal(invoice.total, 20);
assert.equal(Number((await request(`/materials/${material.id}`, { token: staffToken })).stock), 9);

await request(`/shifts/${shift.id}/event`, { token: adminToken, method: 'POST', body: { type: 'cash_out', amount: 121, reason: 'Too much' }, expected: 400 });
await request(`/shifts/${shift.id}/event`, { token: adminToken, method: 'POST', body: { type: 'cash_out', amount: 10, reason: 'QA drawer test' }, expected: 201 });
const active = (await request('/shifts/active', { token: adminToken })).find(s => s.id === shift.id); assert.equal(Number(active.expected_cash), 110);

const closed = await request(`/shifts/${shift.id}/close`, { token: adminToken, method: 'POST', body: { closing_cash: 110, notes: 'QA shift test' }, expected: 200 });
assert.equal(closed.status, 'closed'); assert.equal(Number(closed.expected_cash), 110); assert.equal(Number(closed.variance), 0);
assert.ok(!(await request('/shifts/active', { token: adminToken })).some(s => s.id === shift.id));

await request('/invoices', { token: staffToken, method: 'POST', body: { customer_id: null, tax_rate: 0, items: [{ material_id: material.id, description: material.name, quantity: 1, unit_price: 20 }], payment: { amount: 20, method: 'cash', notes: '' } }, expected: 403 });
await request('/shifts/current?fresh=1', { token: staffToken, expected: 200 }).then(value => assert.equal(value, null));

const history = await request('/shifts/history', { token: adminToken });
assert.ok(history.some(s => s.id === shift.id && s.user_id === staffRecord.id));
const audit = await request('/audit-log', { token: adminToken });
assert.ok(audit.some(entry => entry.entity_id === shift.id && entry.action === 'open'));
assert.ok(audit.some(entry => entry.entity_id === shift.id && entry.action === 'close'));
console.log('BuildPro POS admin/staff shift E2E checks passed:', marker);
