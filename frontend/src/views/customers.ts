import { apiGet, apiPost, apiPut, apiDel } from '../lib/api';
import { esc, val, setErr, clearErr, disableBtn, fmtPeso, fmtDate, EMAIL_RE, PHONE_RE } from '../lib/helpers';
import { showModal, closeModal, showToast, showConfirmModal } from '../lib/helpers';
import { loadView } from '../lib/router';
import type { Customer } from '../lib/types';

let customerNames: Record<string, string> = {};

export async function renderCustomers(): Promise<string> {
  const customers = await apiGet<Customer[]>('/customers');
  customerNames = Object.fromEntries(customers.map((c: Customer) => [c.id, c.name]));
  (window as any).__customerNames = customerNames;
  return `
    <div class="page-header">
      <h2>Customers</h2>
      <button class="btn btn-primary" onclick="showCustomerModal()">+ Add Customer</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Type</th><th class="actions">Actions</th></tr></thead>
        <tbody>
          ${customers.length ? customers.map((c: Customer) => `
            <tr class="customer-row" data-customer-row="${c.id}">
              <td data-label="Name" style="font-weight:600">${esc(c.name)}</td>
              <td data-label="Phone">${esc(c.phone || '-')}</td>
              <td class="customer-secondary" data-label="Email">${esc(c.email || '-')}</td>
              <td data-label="Type">${c.is_wholesale ? '<span class="status-badge" style="background:var(--c-primary-bg);color:var(--c-primary)">Wholesale</span>' : '<span style="color:var(--c-text-muted);font-size:var(--fs-xs)">Retail</span>'}</td>
              <td data-label="" class="actions">
                <button class="btn btn-sm mobile-details-btn" onclick="toggleCustomerDetails('${c.id}')">Details</button>
                <button class="btn btn-primary btn-sm" onclick="editCustomer('${c.id}')">Edit</button>
                <button class="btn btn-sm" onclick="showCustomerStatement('${c.id}')">SOA</button>
                <button class="btn btn-danger btn-sm" onclick="delCustomer('${c.id}')">Delete</button>
              </td>
            </tr>
          `).join('') : '<tr><td colspan="5" style="text-align:center;color:var(--c-text-muted);padding:2rem">No customers yet</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

export function toggleCustomerDetails(id: string) {
  document.querySelector(`[data-customer-row="${id}"]`)?.classList.toggle('expanded');
}

export function showCustomerModal(data?: Customer) {
  const isEdit = !!data;
  showModal(`
    <h3>${isEdit ? 'Edit' : 'Add'} Customer</h3>
    <div class="form-group"><label>Name *</label><input id="cf-name" maxlength="100" value="${esc(data?.name || '')}" /><div class="field-error" id="cf-name-err"></div></div>
    <div class="form-group"><label>Phone</label><input id="cf-phone" maxlength="11" value="${esc(data?.phone || '')}" placeholder="09123456789" /><div class="field-error" id="cf-phone-err"></div></div>
    <div class="form-group"><label>Email</label><input id="cf-email" type="email" value="${esc(data?.email || '')}" /><div class="field-error" id="cf-email-err"></div></div>
    <div class="form-group"><label>Address *</label><input id="cf-address" maxlength="200" value="${esc(data?.address || '')}" /><div class="field-error" id="cf-address-err"></div></div>
    <div class="toggle-group">
      <label class="toggle"><input type="checkbox" id="cf-wholesale" ${data?.is_wholesale ? 'checked' : ''} /><span class="slider"></span></label>
      <label for="cf-wholesale">Wholesale customer</label>
    </div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="cf-save-btn" onclick="${isEdit ? `updateCustomer('${data!.id}')` : 'saveCustomer()'}">Save</button>
    </div>
  `, 'customer-modal');
}

export async function saveCustomer() {
  clearErr('cf-name-err'); clearErr('cf-email-err'); clearErr('cf-phone-err'); clearErr('cf-address-err');
  const name = val('cf-name').trim();
  const phone = val('cf-phone').trim();
  const email = val('cf-email').trim();
  const address = val('cf-address').trim();
  const isWholesale = (document.getElementById('cf-wholesale') as HTMLInputElement)?.checked;
  if (!name) { setErr('cf-name-err', 'Name is required'); return; }
  if (phone && !PHONE_RE.test(phone)) { setErr('cf-phone-err', 'Must be exactly 11 digits'); return; }
  if (email && !EMAIL_RE.test(email)) { setErr('cf-email-err', 'Invalid email format'); return; }
  if (!address) { setErr('cf-address-err', 'Address is required'); return; }
  if (address.length < 5) { setErr('cf-address-err', 'Must be at least 5 characters'); return; }
  disableBtn('cf-save-btn', true);
  try {
    await apiPost('/customers', { name, phone, email, address, is_wholesale: isWholesale });
    closeModal();
    loadView('customers');
  } catch (e: any) { showToast(e.message); }
  finally { disableBtn('cf-save-btn', false); }
}

export async function updateCustomer(id: string) {
  clearErr('cf-name-err'); clearErr('cf-email-err'); clearErr('cf-phone-err'); clearErr('cf-address-err');
  const name = val('cf-name').trim();
  const phone = val('cf-phone').trim();
  const email = val('cf-email').trim();
  const address = val('cf-address').trim();
  const isWholesale = (document.getElementById('cf-wholesale') as HTMLInputElement)?.checked;
  if (!name) { setErr('cf-name-err', 'Name is required'); return; }
  if (phone && !PHONE_RE.test(phone)) { setErr('cf-phone-err', 'Must be exactly 11 digits'); return; }
  if (email && !EMAIL_RE.test(email)) { setErr('cf-email-err', 'Invalid email format'); return; }
  if (!address) { setErr('cf-address-err', 'Address is required'); return; }
  if (address.length < 5) { setErr('cf-address-err', 'Must be at least 5 characters'); return; }
  disableBtn('cf-save-btn', true);
  try {
    await apiPut(`/customers/${id}`, { name, phone, email, address, is_wholesale: isWholesale });
    closeModal();
    loadView('customers');
  } catch (e: any) { showToast(e.message); }
  finally { disableBtn('cf-save-btn', false); }
}

export async function editCustomer(id: string): Promise<void> {
  const customers = await apiGet<Customer[]>('/customers');
  showCustomerModal(customers.find((c: Customer) => c.id === id));
}

export async function delCustomer(id: string): Promise<void> {
  const name = customerNames[id] || 'this customer';
  const ok = await showConfirmModal(`<h3>Delete Customer</h3><p style="color:var(--c-text-secondary)">Are you sure you want to delete <strong>${esc(name)}</strong>?</p>`);
  if (!ok) return;
  try { await apiDel(`/customers/${id}`); loadView('customers'); }
  catch (e: any) { showToast(e.message); }
}

// ─── Statement of Account ───
export async function showCustomerStatement(id: string) {
  const data = await apiGet<any>(`/customers/${id}/statement`);
  const balanceColor = data.total_owed > 0 ? 'color:var(--c-danger)' : 'color:var(--c-success)';
  const w = window.open('', '', 'width=800,height=700');
  if (!w) return;
  w.document.write(`
    <html><head><title>Statement — ${esc(data.customer.name)}</title>
    <style>
      body { font-family: sans-serif; padding: 2rem; color: #111; max-width: 760px; margin: auto; }
      h2 { margin-bottom: 2px; } .sub { color: #666; font-size: 12px; margin-bottom: 1rem; }
      table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
      th { background: #f0f0f0; padding: 8px; text-align: left; font-size: 11px; text-transform: uppercase; }
      td { padding: 8px; border-bottom: 1px solid #e0e0e0; font-size: 12px; }
      .right { text-align: right; }
      .total-row td { font-weight: bold; border-top: 2px solid #333; }
      .paid { color: #22c55e; } .pending { color: #ef4444; } .partial { color: #f59e0b; }
      .btn { padding: 8px 16px; border: 1px solid #ccc; background: #fff; border-radius: 4px; cursor: pointer; }
      .btn-primary { background: #f0b429; border-color: #d49a1c; }
    </style></head><body>
    <div style="display:flex;justify-content:space-between;margin-bottom:1rem">
      <div><h2>${esc(data.customer.name)}</h2><div class="sub">${esc(data.customer.address || '')} · ${esc(data.customer.phone || '')}</div></div>
      <button class="btn btn-primary" onclick="window.print()">Print</button>
    </div>
    <table>
      <thead><tr><th>Invoice #</th><th>Date</th><th>Total</th><th>Paid</th><th class="right">Balance</th></tr></thead>
      <tbody>
        ${data.statements.length ? data.statements.map((s: any) => `
          <tr>
            <td data-label="Invoice #">${esc(s.invoice_number)}</td>
            <td data-label="Date">${fmtDate(s.issued_date)}</td>
            <td data-label="Total">${fmtPeso(s.total)}</td>
            <td data-label="Paid" class="${s.paid >= s.total ? 'paid' : s.paid > 0 ? 'partial' : 'pending'}">${fmtPeso(s.paid)}</td>
            <td data-label="Balance" class="right" style="${s.balance > 0 ? 'color:#ef4444' : 'color:#22c55e'}">${fmtPeso(s.balance)}</td>
          </tr>
        `).join('') : '<tr><td data-label="" colspan="5" style="text-align:center;padding:2rem;color:#666">No transactions</td></tr>'}
        <tr class="total-row"><td data-label="" colspan="4" class="right">Total Outstanding</td><td data-label="Balance" class="right" style="${balanceColor}">${fmtPeso(data.total_owed)}</td></tr>
      </tbody>
    </table>
    <script>window.onload=function(){window.print();window.close()}<\/script>
    </body></html>
  `);
  w.document.close();
}
