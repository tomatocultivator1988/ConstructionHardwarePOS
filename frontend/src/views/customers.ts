import { apiGet, apiPost, apiPut, apiDel } from '../lib/api';
import { esc, val, setErr, clearErr, disableBtn, EMAIL_RE, PHONE_RE } from '../lib/helpers';
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
        <thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Address</th><th class="actions">Actions</th></tr></thead>
        <tbody>
          ${customers.length ? customers.map((c: Customer) => `
            <tr>
              <td style="font-weight:600">${esc(c.name)}</td>
              <td>${esc(c.phone || '—')}</td>
              <td>${esc(c.email || '—')}</td>
              <td>${esc(c.address || '—')}</td>
              <td class="actions">
                <button class="btn btn-primary btn-sm" onclick="editCustomer('${c.id}')">Edit</button>
                <button class="btn btn-danger btn-sm" onclick="delCustomer('${c.id}')">Delete</button>
              </td>
            </tr>
          `).join('') : '<tr><td colspan="5" style="text-align:center;color:var(--c-text-muted);padding:2rem">No customers yet</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

export function showCustomerModal(data?: Customer) {
  const isEdit = !!data;
  showModal(`
    <h3>${isEdit ? 'Edit' : 'Add'} Customer</h3>
    <div class="form-group"><label>Name *</label><input id="cf-name" maxlength="100" value="${esc(data?.name || '')}" /><div class="field-error" id="cf-name-err"></div></div>
    <div class="form-group"><label>Phone</label><input id="cf-phone" maxlength="11" value="${esc(data?.phone || '')}" placeholder="09123456789" /><div class="field-error" id="cf-phone-err"></div></div>
    <div class="form-group"><label>Email</label><input id="cf-email" type="email" value="${esc(data?.email || '')}" /><div class="field-error" id="cf-email-err"></div></div>
    <div class="form-group"><label>Address *</label><input id="cf-address" maxlength="200" value="${esc(data?.address || '')}" /><div class="field-error" id="cf-address-err"></div></div>
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
  if (!name) { setErr('cf-name-err', 'Name is required'); return; }
  if (phone && !PHONE_RE.test(phone)) { setErr('cf-phone-err', 'Must be exactly 11 digits'); return; }
  if (email && !EMAIL_RE.test(email)) { setErr('cf-email-err', 'Invalid email format'); return; }
  if (!address) { setErr('cf-address-err', 'Address is required'); return; }
  if (address.length < 5) { setErr('cf-address-err', 'Must be at least 5 characters'); return; }
  disableBtn('cf-save-btn', true);
  try {
    await apiPost('/customers', { name, phone, email, address });
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
  if (!name) { setErr('cf-name-err', 'Name is required'); return; }
  if (phone && !PHONE_RE.test(phone)) { setErr('cf-phone-err', 'Must be exactly 11 digits'); return; }
  if (email && !EMAIL_RE.test(email)) { setErr('cf-email-err', 'Invalid email format'); return; }
  if (!address) { setErr('cf-address-err', 'Address is required'); return; }
  if (address.length < 5) { setErr('cf-address-err', 'Must be at least 5 characters'); return; }
  disableBtn('cf-save-btn', true);
  try {
    await apiPut(`/customers/${id}`, { name, phone, email, address });
    closeModal();
    loadView('customers');
  } catch (e: any) { showToast(e.message); }
  finally { disableBtn('cf-save-btn', false); }
}

export async function editCustomer(id: string) {
  const customers = await apiGet<Customer[]>('/customers');
  showCustomerModal(customers.find((x: Customer) => x.id === id));
}

export async function delCustomer(id: string) {
  const name = customerNames[id] || 'this customer';
  const ok = await showConfirmModal(`<h3>Delete Customer</h3><p style="color:var(--c-text-secondary)">Are you sure you want to delete <strong>${esc(name)}</strong>?</p>`);
  if (!ok) return;
  try { await apiDel(`/customers/${id}`); loadView('customers'); }
  catch (e: any) { showToast(e.message); }
}
