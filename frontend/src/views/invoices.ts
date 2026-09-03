import { apiGet, apiPost, apiPut, apiDel } from '../lib/api';
import { esc, val, fmtDate, fmtPeso, setErr, clearErr, disableBtn, isAdmin } from '../lib/helpers';
import { showModal, closeModal, showToast, showConfirmModal } from '../lib/helpers';
import { loadView } from '../lib/router';
import { printReceipt } from './receipt';
import type { Invoice, Material, Customer } from '../lib/types';

let invoicePage = 1;
const INVOICE_PAGE_SIZE = 15;

export async function renderInvoices(): Promise<string> {
  const [invoices, customers, materials, settings] = await Promise.all([
    apiGet<Invoice[] | { data: Invoice[]; total: number }>(`/invoices?page=${invoicePage}&pageSize=${INVOICE_PAGE_SIZE}`),
    apiGet<Customer[]>('/customers'),
    apiGet<Material[]>('/materials'),
    apiGet<{ value: string }>('/settings/default_tax_rate'),
  ]);
  const invoiceData = Array.isArray(invoices) ? invoices : invoices.data;
  const totalInvoices = Array.isArray(invoices) ? invoices.length : invoices.total;
  (window as any).__invCustomers = customers;
  (window as any).__invMaterials = materials;
  (window as any).__invDefaultTax = settings.value || '0';
  return `
    <div class="page-header">
      <h2>Invoices</h2>
      <button class="btn btn-primary" onclick="showInvoiceModal()">+ New Invoice</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>#</th><th>Customer</th><th>Total</th><th>Status</th><th>Issued</th><th class="actions">Actions</th></tr></thead>
        <tbody>
          ${invoiceData.length ? invoiceData.map((inv: Invoice) => `
            <tr>
              <td data-label="#" style="font-weight:600">${esc(inv.invoice_number)}</td>
              <td data-label="Customer">${esc(inv.customer_name)}</td>
              <td data-label="Total" style="font-family:var(--ff-mono);font-weight:600">${fmtPeso(inv.total)}</td>
              <td data-label="Status"><span class="status-badge ${inv.status}">${inv.status}</span></td>
              <td data-label="Issued">${fmtDate(inv.issued_date)}</td>
              <td data-label="" class="actions">
                <button class="btn btn-success btn-sm" onclick="showInvoiceDetail('${inv.id}')">View</button>
                <button class="btn btn-danger btn-sm" onclick="delInvoice('${inv.id}')">Delete</button>
              </td>
            </tr>
          `).join('') : '<tr><td colspan="6" style="text-align:center;color:var(--c-text-muted);padding:2rem">No invoices yet</td></tr>'}
        </tbody>
      </table>
    </div>
    ${totalInvoices > INVOICE_PAGE_SIZE ? `<div class="pagination"><span>Showing ${(invoicePage-1)*INVOICE_PAGE_SIZE+1}–${Math.min(invoicePage*INVOICE_PAGE_SIZE, totalInvoices)} of ${totalInvoices}</span><button class="btn btn-sm" ${invoicePage===1?'disabled':''} onclick="changeInvoicePage(${invoicePage-1})">Previous</button><strong>Page ${invoicePage} of ${Math.ceil(totalInvoices/INVOICE_PAGE_SIZE)}</strong><button class="btn btn-sm" ${invoicePage>=Math.ceil(totalInvoices/INVOICE_PAGE_SIZE)?'disabled':''} onclick="changeInvoicePage(${invoicePage+1})">Next</button></div>` : ''}
  `;
}

export function changeInvoicePage(page: number) { invoicePage = Math.max(1, page); loadView('invoices'); }

export function showInvoiceModal() {
  const customers = (window as any).__invCustomers || [];
  const materials = (window as any).__invMaterials || [];
  const matOpts = materials.map((m: Material) => {
    const cost = m.cost_price || 0;
    const profit = m.price_per_unit - cost;
    return `<option value="${m.id}">${esc(m.name)} (${m.stock} ${esc(m.unit)} — cost ${fmtPeso(cost)} / sell ${fmtPeso(m.price_per_unit)} / +${fmtPeso(profit)})</option>`;
  }).join('');
  showModal(`
    <h3>New Invoice</h3>

    <div class="toggle-group">
      <label>Walk-in / Cash Sale</label>
      <label class="toggle">
        <input type="checkbox" id="inv-walkin" onchange="toggleWalkin()" />
        <span class="slider"></span>
      </label>
      <label>Account Sale</label>
    </div>

    <div class="form-group" id="inv-customer-group">
      <label>Customer</label>
      <select id="inv-customer">
        <option value="">Select customer...</option>
        ${customers.map((c: Customer) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}
      </select>
      <div class="field-error" id="inv-customer-err"></div>
    </div>

    <h4>Line Items</h4>
    <div id="line-items">
      <div class="line-item">
        <select class="li-mat" style="flex:3">
          <option value="">Select material...</option>
          ${matOpts}
        </select>
        <div style="flex:1;display:flex;flex-direction:column;justify-content:center">
          <input placeholder="Qty" type="number" min="0.01" step="0.01" class="li-qty" />
          <div class="li-err"></div>
        </div>
        <button class="btn btn-danger btn-sm" onclick="this.parentElement.remove()">✕</button>
      </div>
    </div>
    <button class="btn" onclick="addLineItem()" style="margin-bottom:1rem">+ Add Item</button>

    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="inv-create-btn" onclick="createInvoice()">Create Invoice</button>
    </div>
  `, 'invoice-modal');
}

export function toggleWalkin() {
  const isWalkin = (document.getElementById('inv-walkin') as HTMLInputElement).checked;
  const group = document.getElementById('inv-customer-group')!;
  group.style.display = isWalkin ? 'none' : '';
}

export function addLineItem() {
  const materials = (window as any).__invMaterials || [];
  const matOpts = materials.map((m: Material) => {
    const cost = m.cost_price || 0;
    const profit = m.price_per_unit - cost;
    return `<option value="${m.id}">${esc(m.name)} (${m.stock} ${esc(m.unit)} — cost ${fmtPeso(cost)} / sell ${fmtPeso(m.price_per_unit)} / +${fmtPeso(profit)})</option>`;
  }).join('');
  const container = document.getElementById('line-items')!;
  const div = document.createElement('div');
  div.className = 'line-item';
  div.innerHTML = `
    <select class="li-mat" style="flex:3">
      <option value="">Select material...</option>
      ${matOpts}
    </select>
    <div style="flex:1;display:flex;flex-direction:column;justify-content:center">
      <input placeholder="Qty" type="number" min="0.01" step="0.01" class="li-qty" />
      <div class="li-err"></div>
    </div>
    <button class="btn btn-danger btn-sm" onclick="this.parentElement.remove()">✕</button>
  `;
  container.appendChild(div);
}

export async function createInvoice() {
  clearErr('inv-customer-err');
  document.querySelectorAll('.li-err').forEach(el => { el.textContent = ''; });
  document.querySelectorAll('.li-qty').forEach(el => el.classList.remove('error'));

  const isWalkin = (document.getElementById('inv-walkin') as HTMLInputElement).checked;
  const customer_id = isWalkin ? null : val('inv-customer');
  if (!isWalkin && !customer_id) { setErr('inv-customer-err', 'Select a customer or enable walk-in mode'); return; }
  const tax_rate = parseFloat((window as any).__invDefaultTax || '0');

  const matList: Material[] = (window as any).__invMaterials || [];
  let hasLineErr = false;
  const items: any[] = [];

  document.querySelectorAll('.line-item').forEach(el => {
    const material_id = (el.querySelector('.li-mat') as HTMLSelectElement).value;
    const qtyRaw = (el.querySelector('.li-qty') as HTMLInputElement).value;
    const qty = parseFloat(qtyRaw);
    const liErr = el.querySelector('.li-err') as HTMLElement;
    const qtyInput = el.querySelector('.li-qty') as HTMLInputElement;
    if (!material_id) { hasLineErr = true; liErr.textContent = 'Select a material'; return; }
    if (!qtyRaw || isNaN(qty) || qty <= 0) { hasLineErr = true; liErr.textContent = 'Enter a valid quantity'; qtyInput.classList.add('error'); return; }
    const mat = matList.find((m: Material) => m.id === material_id);
    if (!mat) { hasLineErr = true; liErr.textContent = 'Material not found'; return; }
    if (qty > mat.stock) {
      hasLineErr = true;
      liErr.textContent = `Only ${mat.stock} ${mat.unit} available`;
      qtyInput.classList.add('error');
      return;
    }
    items.push({ description: mat.name, material_id, quantity: qty, unit_price: mat.price_per_unit });
  });
  if (hasLineErr) return;
  if (!items.length) { showToast('Add at least one valid line item'); return; }

  const subtotal = items.reduce((s: number, i: any) => s + i.quantity * i.unit_price, 0);
  const roundedSubtotal = Math.round(subtotal * 100) / 100;
  const taxAmount = Math.round(roundedSubtotal * tax_rate * 100) / 100;
  const total = Math.round((roundedSubtotal + taxAmount) * 100) / 100;
  const customerSel = document.getElementById('inv-customer') as HTMLSelectElement;
  const customerName = isWalkin ? 'Walk-in / Cash Sale' : (customerSel?.selectedOptions?.[0]?.text || 'Unknown');

  const confirmHtml = `
    <h3>Confirm Invoice</h3>
    <p style="margin-bottom:var(--space-4);color:var(--c-text-secondary)">Review the details before creating:</p>
    <div class="summary-line"><span>Customer</span><span>${esc(customerName)}</span></div>
    <div class="summary-line"><span>Line Items</span><span>${items.length}</span></div>
    <div class="summary-line"><span>Subtotal</span><span>${fmtPeso(roundedSubtotal)}</span></div>
    ${tax_rate > 0 ? `<div class="summary-line"><span>Tax (${(tax_rate*100).toFixed(0)}%)</span><span>${fmtPeso(taxAmount)}</span></div>` : ''}
    <div class="summary-line total"><span>Total</span><span>${fmtPeso(total)}</span></div>
  `;
  if (!(await showConfirmModal(confirmHtml))) return;

  disableBtn('inv-create-btn', true);
  try {
    await apiPost('/invoices', { customer_id, due_date: null, tax_rate, items });
    closeModal();
    loadView('invoices');
  } catch (e: any) { showToast(e.message); }
  finally { disableBtn('inv-create-btn', false); }
}

export async function showInvoiceDetail(id: string) {
  const inv = await apiGet<Invoice>(`/invoices/${id}`);
  const totalPaid = inv.payments.reduce((s: number, p: any) => s + p.amount, 0);
  const balance = inv.total - totalPaid;
  const modalId = 'invoice-detail-modal';
  document.getElementById(modalId)?.remove();
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.id = modalId;
  modal.addEventListener('click', e => { if (e.target === modal) { modal.remove(); loadView('invoices'); } });
  document.body.appendChild(modal);
  modal.innerHTML = `<div class="modal-content">
    <h3>Invoice ${esc(inv.invoice_number)}</h3>
    <div style="display:flex;gap:var(--space-4);align-items:center;margin-bottom:var(--space-4);flex-wrap:wrap">
      <span style="color:var(--c-text-secondary)">${esc(inv.customer_name)}</span>
      <span class="status-badge ${inv.status}">${inv.status}</span>
      <span style="font-size:var(--fs-xs);color:var(--c-text-muted)">Issued: ${fmtDate(inv.issued_date)}</span>
      ${inv.paid_date ? `<span style="font-size:var(--fs-xs);color:var(--c-success)">Paid: ${fmtDate(inv.paid_date)}</span>` : ''}
    </div>

    <h4>Line Items</h4>
    <div class="table-wrap" style="margin-bottom:1rem">
      <table>
        <thead><tr><th>Description</th><th>Qty</th><th>Unit Price</th><th>Total</th></tr></thead>
        <tbody>
          ${inv.items.map((item: any) => `
            <tr><td data-label="Description">${esc(item.description)}</td><td data-label="Qty">${item.quantity}</td><td data-label="Unit Price" style="font-family:var(--ff-mono)">${fmtPeso(item.unit_price)}</td><td data-label="Total" style="font-family:var(--ff-mono);font-weight:600">${fmtPeso(item.total)}</td></tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    <div style="max-width:300px;margin-left:auto">
      <div class="summary-line"><span>Subtotal</span><span>${fmtPeso(inv.subtotal)}</span></div>
      ${Number(inv.tax_rate) > 0 ? `<div class="summary-line"><span>Tax (${(Number(inv.tax_rate)*100).toFixed(0)}%)</span><span>${fmtPeso(inv.tax_amount)}</span></div>` : ''}
      <div class="summary-line total"><span>Total</span><span>${fmtPeso(inv.total)}</span></div>
      <div class="summary-line"><span>Paid</span><span style="color:var(--c-success)">${fmtPeso(totalPaid)}</span></div>
      <div class="summary-line" style="font-weight:600;font-size:var(--fs-lg)"><span>Balance</span><span style="color:${balance < 0 ? 'var(--c-warning)' : balance > 0 ? 'var(--c-danger)' : 'var(--c-success)'}">${fmtPeso(balance)}</span></div>
    </div>

    ${inv.payments.length ? `
    <h4>Payments</h4>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Date</th><th>Amount</th><th>Method</th><th>Notes</th></tr></thead>
        <tbody>
          ${inv.payments.map((p: any) => `
            <tr><td data-label="Date">${fmtDate(p.payment_date)}</td><td data-label="Amount" style="font-family:var(--ff-mono);font-weight:600;color:var(--c-success)">${fmtPeso(p.amount)}</td><td data-label="Method">${esc(p.method)}</td><td data-label="Notes" style="color:var(--c-text-muted)">${esc(p.notes || '—')}</td></tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    ` : ''}

    ${balance > 0 && inv.status !== 'voided' ? `
    <h4>Record Payment</h4>
    <div style="display:flex;gap:0.75rem;align-items:end;flex-wrap:wrap">
      <div class="form-group" style="flex:1;min-width:120px"><label>Amount</label><input id="pay-amount" type="number" step="0.01" min="0.01" max="${balance.toFixed(2)}" value="${balance.toFixed(2)}" /></div>
      <div class="form-group" style="flex:1;min-width:120px"><label>Method</label>
        <select id="pay-method">
          <option value="cash">Cash</option>
          <option value="card">Card</option>
          <option value="check">Check</option>
          <option value="bank">Bank Transfer</option>
        </select>
      </div>
      <div class="form-group" style="flex:1;min-width:120px"><label>Notes</label><input id="pay-notes" maxlength="200" /></div>
      <button class="btn btn-success" id="pay-btn" onclick="recordPayment('${inv.id}')" style="margin-bottom:1rem">Pay</button>
    </div>
    <div class="field-error" id="pay-err"></div>
    ` : '<p style="color:var(--c-success);font-weight:600;margin-top:1rem">✓ Paid in Full</p>'}

    ${inv.status !== 'pending' && inv.status !== 'voided' ? `
    <h4 style="margin-top:var(--space-5)">Return Items</h4>
    <div id="return-items">
      ${inv.items.map((item: any) => `
        <div class="line-item" style="margin-bottom:var(--space-2)">
          <span style="flex:2;font-size:var(--fs-sm)">${esc(item.description)}</span>
          <span style="flex:1;font-size:var(--fs-sm);color:var(--c-text-muted)">Sold: ${item.quantity}</span>
          <input id="ret-qty-${item.id}" type="number" min="0" max="${item.quantity}" value="0" style="flex:1;min-height:32px;font-size:var(--fs-sm);width:60px" />
        </div>
      `).join('')}
    </div>
    <button class="btn btn-warning" id="ret-btn" onclick="returnItems('${inv.id}')" style="margin-top:var(--space-2)">Process Returns</button>
    <div class="field-error" id="ret-err"></div>
    ` : ''}

    <div class="modal-actions">
      <button class="btn btn-primary" onclick="printReceipt('${inv.id}')">Print Receipt</button>
      ${isAdmin() && inv.status !== 'voided' ? `<button class="btn btn-warning" onclick="voidInvoice('${inv.id}')">Void Invoice</button><button class="btn" onclick="issueCreditMemo('${inv.id}')">Credit Memo</button>${totalPaid > 0 ? `<button class="btn" onclick="recordRefund('${inv.id}')">Refund</button>` : ''}` : ''}
      <button class="btn" onclick="closeModal();loadView('invoices')">Close</button>
    </div>
  </div>`;
}

export async function voidInvoice(id: string) {
  const reason = window.prompt('Enter the reason for voiding this invoice:')?.trim();
  if (!reason) return;
  try { await apiPut(`/invoices/${id}/void`, { reason }); showToast('Invoice voided and stock restored', 'success'); closeModal(); loadView('invoices'); }
  catch (e: any) { showToast(e.message); }
}

export async function issueCreditMemo(id: string) {
  const amount = Number(window.prompt('Credit memo amount:'));
  const reason = window.prompt('Credit memo reason:')?.trim();
  if (!Number.isFinite(amount) || amount <= 0 || !reason) return;
  try { await apiPost(`/invoices/${id}/credit-memo`, { amount, reason }); showToast('Credit memo issued', 'success'); }
  catch (e: any) { showToast(e.message); }
}

export async function recordRefund(id: string) {
  const amount = Number(window.prompt('Refund amount:'));
  const method = window.prompt('Refund method (cash/card/bank):')?.trim();
  if (!Number.isFinite(amount) || amount <= 0 || !method) return;
  try { await apiPost(`/invoices/${id}/refund`, { amount, method }); showToast('Refund recorded', 'success'); }
  catch (e: any) { showToast(e.message); }
}

export async function recordPayment(invoiceId: string) {
  clearErr('pay-err');
  const amount = parseFloat(val('pay-amount'));
  const method = val('pay-method');
  const notes = val('pay-notes');
  if (isNaN(amount) || amount <= 0) { setErr('pay-err', 'Enter a valid amount'); return; }
  const payInput = document.getElementById('pay-amount') as HTMLInputElement;
  const max = parseFloat(payInput?.getAttribute('max') || '0');
  if (max > 0 && amount > max) { setErr('pay-err', `Amount exceeds remaining balance of ${fmtPeso(max)}`); return; }
  const confirmHtml = `
    <h3>Confirm Payment</h3>
    <p style="margin-bottom:var(--space-4);color:var(--c-text-secondary)">Record this payment?</p>
    <div class="summary-line"><span>Amount</span><span>${fmtPeso(amount)}</span></div>
    <div class="summary-line"><span>Method</span><span>${esc(method)}</span></div>
    ${notes ? `<div class="summary-line"><span>Notes</span><span>${esc(notes)}</span></div>` : ''}
  `;
  if (!(await showConfirmModal(confirmHtml))) return;
  disableBtn('pay-btn', true);
  try {
    await apiPost(`/invoices/${invoiceId}/pay`, { amount, method, notes });
    closeModal();
    loadView('invoices');
  } catch (e: any) { showToast(e.message); }
  finally { disableBtn('pay-btn', false); }
}

export async function delInvoice(id: string) {
  const ok = await showConfirmModal(`<h3>Delete Invoice</h3><p style="color:var(--c-text-secondary)">Are you sure you want to delete this invoice? Stock will be restored.</p>`);
  if (!ok) return;
  try { await apiDel(`/invoices/${id}`); loadView('invoices'); }
  catch (e: any) { showToast(e.message); }
}

export async function returnItems(invoiceId: string) {
  disableBtn('ret-btn', true);
  try {
    const inv = await apiGet<any>(`/invoices/${invoiceId}`);
    const retItems: { material_id: string; quantity: number }[] = [];
    for (const item of inv.items) {
      if (!item.material_id) continue;
      const qty = parseFloat((document.getElementById(`ret-qty-${item.id}`) as HTMLInputElement)?.value || '0');
      if (qty > 0 && qty <= item.quantity) {
        retItems.push({ invoice_item_id: item.id, material_id: item.material_id, quantity: qty } as any);
      }
    }
    if (!retItems.length) { showToast('Enter return quantities'); return; }
    const ok = await showConfirmModal(`<h3>Confirm Returns</h3><p style="color:var(--c-text-secondary)">Return ${retItems.length} item(s) and restore stock?</p>`);
    if (!ok) return;
    await apiPost(`/invoices/${invoiceId}/return`, { items: retItems });
    showToast('Returns processed — stock restored', 'success');
    closeModal();
    loadView('invoices');
  } catch (e: any) { showToast(e.message); }
  finally { disableBtn('ret-btn', false); }
}
