import { apiGet, apiPost, apiPut, apiDel } from '../lib/api';
import { esc, val, setErr, clearErr, disableBtn } from '../lib/helpers';
import { showModal, closeModal, showToast, showConfirmModal } from '../lib/helpers';
import { loadView } from '../lib/router';
import type { Supplier } from '../lib/types';

export async function renderSuppliers(): Promise<string> {
  const suppliers = await apiGet<Supplier[]>('/suppliers');
  (window as any).__supplierNames = Object.fromEntries(suppliers.map((s: Supplier) => [s.id, s.name]));
  return `
    <div class="page-header">
      <h2>Suppliers</h2>
      <button class="btn btn-primary" onclick="showSupplierModal()">+ Add Supplier</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Name</th><th>Contact Person</th><th>Phone</th><th>Email</th><th>TIN</th><th class="actions">Actions</th></tr></thead>
        <tbody>
          ${suppliers.length ? suppliers.map((s: Supplier) => `
            <tr>
              <td style="font-weight:600">${esc(s.name)}</td>
              <td>${esc(s.contact_person || '-')}</td>
              <td>${esc(s.phone || '-')}</td>
              <td>${esc(s.email || '-')}</td>
              <td>${esc(s.tin || '-')}</td>
              <td class="actions">
                <button class="btn btn-primary btn-sm" onclick="editSupplier('${s.id}')">Edit</button>
                <button class="btn btn-danger btn-sm" onclick="delSupplier('${s.id}')">Delete</button>
              </td>
            </tr>
          `).join('') : '<tr><td colspan="6" style="text-align:center;color:var(--c-text-muted);padding:2rem">No suppliers yet</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

export function showSupplierModal(data?: Supplier) {
  const isEdit = !!data;
  return showModal(`
    <h3>${isEdit ? 'Edit' : 'Add'} Supplier</h3>
    <div class="form-group"><label>Name *</label><input id="sf-name" maxlength="100" value="${esc(data?.name || '')}" /><div class="field-error" id="sf-name-err"></div></div>
    <div class="form-row">
      <div class="form-group"><label>Contact Person</label><input id="sf-contact" maxlength="100" value="${esc(data?.contact_person || '')}" /></div>
      <div class="form-group"><label>Phone</label><input id="sf-phone" maxlength="13" placeholder="09123456789" value="${esc(data?.phone || '')}" /><div class="field-error" id="sf-phone-err"></div></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Email</label><input id="sf-email" type="email" maxlength="100" value="${esc(data?.email || '')}" /><div class="field-error" id="sf-email-err"></div></div>
      <div class="form-group"><label>TIN</label><input id="sf-tin" maxlength="20" value="${esc(data?.tin || '')}" /></div>
    </div>
    <div class="form-group"><label>Address</label><input id="sf-address" maxlength="200" value="${esc(data?.address || '')}" /></div>
    <div class="form-group"><label>Notes</label><input id="sf-notes" maxlength="200" value="${esc(data?.notes || '')}" /></div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="sf-save-btn" onclick="${isEdit ? `updateSupplier('${data!.id}')` : 'createSupplier()'}">Save</button>
    </div>
  `, 'supplier-modal');
}

export async function createSupplier() {
  clearErr('sf-name-err'); clearErr('sf-phone-err'); clearErr('sf-email-err');
  const name = val('sf-name').trim();
  if (!name) { setErr('sf-name-err', 'Name is required'); return; }
  if (name.length < 2) { setErr('sf-name-err', 'Must be at least 2 characters'); return; }
  const phone = val('sf-phone').trim();
  if (phone && !/^\d{7,13}$/.test(phone)) { setErr('sf-phone-err', 'Must be 7-13 digits'); return; }
  const email = val('sf-email').trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setErr('sf-email-err', 'Invalid email'); return; }
  disableBtn('sf-save-btn', true);
  try {
    await apiPost('/suppliers', {
      name, contact_person: val('sf-contact').trim() || null,
      phone: phone || null, email: email || null,
      address: val('sf-address').trim() || null,
      tin: val('sf-tin').trim() || null,
      notes: val('sf-notes').trim() || null,
    });
    closeModal(); loadView('suppliers');
  } catch (e: any) { showToast(e.message); }
  finally { disableBtn('sf-save-btn', false); }
}

export async function updateSupplier(id: string) {
  clearErr('sf-name-err'); clearErr('sf-phone-err'); clearErr('sf-email-err');
  const name = val('sf-name').trim();
  if (!name) { setErr('sf-name-err', 'Name is required'); return; }
  if (name.length < 2) { setErr('sf-name-err', 'Must be at least 2 characters'); return; }
  const phone = val('sf-phone').trim();
  if (phone && !/^\d{7,13}$/.test(phone)) { setErr('sf-phone-err', 'Must be 7-13 digits'); return; }
  const email = val('sf-email').trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setErr('sf-email-err', 'Invalid email'); return; }
  disableBtn('sf-save-btn', true);
  try {
    await apiPut(`/suppliers/${id}`, {
      name, contact_person: val('sf-contact').trim() || null,
      phone: phone || null, email: email || null,
      address: val('sf-address').trim() || null,
      tin: val('sf-tin').trim() || null,
      notes: val('sf-notes').trim() || null,
    });
    closeModal(); loadView('suppliers');
  } catch (e: any) { showToast(e.message); }
  finally { disableBtn('sf-save-btn', false); }
}

export async function editSupplier(id: string) {
  const suppliers = await apiGet<Supplier[]>('/suppliers');
  showSupplierModal(suppliers.find((s: Supplier) => s.id === id));
}

export async function delSupplier(id: string) {
  const name = (window as any).__supplierNames?.[id] || 'this supplier';
  const ok = await showConfirmModal(`<h3>Delete Supplier</h3><p style="color:var(--c-text-secondary)">Are you sure you want to delete <strong>${esc(name)}</strong>?</p>`);
  if (!ok) return;
  try { await apiDel(`/suppliers/${id}`); loadView('suppliers'); }
  catch (e: any) { showToast(e.message); }
}
