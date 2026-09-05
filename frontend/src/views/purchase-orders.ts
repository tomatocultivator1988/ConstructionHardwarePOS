import { apiGet, apiPost, apiPut, apiDel } from '../lib/api';
import { esc, val, fmtDate, fmtPeso, disableBtn } from '../lib/helpers';
import { showModal, closeModal, showToast, showConfirmModal } from '../lib/helpers';
import { loadView } from '../lib/router';
import type { PurchaseOrder, Supplier, Material } from '../lib/types';

let lineItemCount = 0;

export async function renderPurchaseOrders(): Promise<string> {
  const pos = await apiGet<PurchaseOrder[]>('/purchase-orders');
  const materials = await apiGet<Material[]>('/materials');
  (window as any).__poMaterialNames = Object.fromEntries(materials.map((m: Material) => [m.id, `${m.name} (₱${(m.cost_price || 0).toFixed(2)})`]));
  return `
    <div class="page-header">
      <h2>Purchase Orders</h2>
      <button class="btn btn-primary" onclick="showPOModal()">+ New PO</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>PO #</th><th>Supplier</th><th>Total</th><th>Status</th><th>Order Date</th><th>Received</th><th class="actions">Actions</th></tr></thead>
        <tbody>
          ${pos.length ? pos.map((po: PurchaseOrder) => `
            <tr>
              <td data-label="PO #" style="font-weight:600">${esc(po.po_number)}</td>
              <td data-label="Supplier">${esc(po.supplier_name)}</td>
              <td data-label="Total" style="font-family:var(--ff-mono);font-weight:600">${fmtPeso(po.total)}</td>
              <td data-label="Status"><span class="status-badge ${po.status}">${po.status}</span></td>
              <td data-label="Order Date">${fmtDate(po.order_date)}</td>
              <td data-label="Received">${po.received_date ? fmtDate(po.received_date) : '-'}</td>
              <td data-label="" class="actions">
                <button class="btn btn-primary btn-sm" onclick="showPODetail('${po.id}')">View</button>
                ${po.status === 'pending' ? `
                  <button class="btn btn-success btn-sm" onclick="receivePO('${po.id}')">Receive</button>
                  <button class="btn btn-danger btn-sm" onclick="cancelPO('${po.id}')">Cancel</button>
                ` : ''}
              </td>
            </tr>
          `).join('') : '<tr><td colspan="7" style="text-align:center;color:var(--c-text-muted);padding:2rem">No purchase orders yet</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}


export async function showPOModal() {
  const suppliers = await apiGet<Supplier[]>('/suppliers');
  const materials = await apiGet<Material[]>('/materials');
  (window as any).__poMaterials = materials;
  lineItemCount = 0;

  const supplierOpts = suppliers.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  const matOpts = materials.map(m => `<option value="${m.id}">${esc(m.name)} (₱${(m.cost_price || 0).toFixed(2)})</option>`).join('');

  showModal(`
    <h3>New Purchase Order</h3>
    <div class="form-row">
      <div class="form-group">
        <label>Supplier *</label>
        <select id="pof-supplier"><option value="">Select supplier...</option>${supplierOpts}</select>
        <div class="field-error" id="pof-supplier-err"></div>
      </div>
      <div class="form-group">
        <label>Order Date *</label>
        <input id="pof-date" type="date" value="${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore' }).format(new Date())}" />
        <div class="field-error" id="pof-date-err"></div>
      </div>
    </div>
    <h4>Line Items</h4>
    <div id="po-line-items">
      ${renderLineItem(++lineItemCount, matOpts)}
    </div>
    <button class="btn btn-sm" onclick="addPOLineItem()" style="margin-bottom:var(--space-4)">+ Add Item</button>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="pof-save-btn" onclick="createPO()">Create PO</button>
    </div>
  `, 'po-modal');
}

function renderLineItem(n: number, matOpts: string, data?: any) {
  return `
    <div class="line-item" id="po-line-${n}" style="display:flex;gap:var(--space-2);margin-bottom:var(--space-2);align-items:flex-start">
      <div style="flex:2">
        <select id="po-mat-${n}" style="width:100%;min-height:36px;font-size:var(--fs-sm)" onchange="poMaterialChanged(${n})">
          <option value="">Select material...</option>
          ${matOpts}
        </select>
      </div>
      <div style="flex:2">
        <input id="po-desc-${n}" placeholder="Description" value="${esc(data?.description || '')}" style="width:100%;min-height:36px;font-size:var(--fs-sm)" />
      </div>
      <div style="flex:1">
        <input id="po-qty-${n}" type="number" min="1" placeholder="Qty" value="${data?.quantity || ''}" style="width:100%;min-height:36px;font-size:var(--fs-sm)" />
      </div>
      <div style="flex:1">
        <input id="po-cost-${n}" type="number" step="0.01" min="0" placeholder="Cost" value="${data?.unit_cost || ''}" style="width:100%;min-height:36px;font-size:var(--fs-sm)" />
      </div>
      <div style="display:flex;align-items:center;min-height:36px">
        <button class="btn btn-danger btn-sm" onclick="removePOLineItem(${n})">✕</button>
      </div>
    </div>
  `;
}

export function addPOLineItem() {
  const materials = (window as any).__poMaterials || [];
  const matOpts = materials.map((m: Material) => `<option value="${m.id}">${esc(m.name)} (₱${(m.cost_price || 0).toFixed(2)})</option>`).join('');
  lineItemCount++;
  const container = document.getElementById('po-line-items');
  if (container) {
    container.insertAdjacentHTML('beforeend', renderLineItem(lineItemCount, matOpts));
  }
}

export function poMaterialChanged(n: number) {
  const select = document.getElementById(`po-mat-${n}`) as HTMLSelectElement;
  const desc = document.getElementById(`po-desc-${n}`) as HTMLInputElement;
  const cost = document.getElementById(`po-cost-${n}`) as HTMLInputElement;
  if (!select || !desc || !cost) return;
  const materials = (window as any).__poMaterials || [];
  const mat = materials.find((m: Material) => m.id === select.value);
  if (mat) {
    if (!desc.value) desc.value = mat.name;
    if (!cost.value) cost.value = (mat.cost_price || 0).toString();
  }
}

export function removePOLineItem(n: number) {
  document.getElementById(`po-line-${n}`)?.remove();
}

export async function createPO() {
  const supplierId = val('pof-supplier');
  const orderDate = val('pof-date');
  if (!supplierId) { showToast('Please select a supplier'); return; }
  if (!orderDate) { showToast('Please select an order date'); return; }

  const items: any[] = [];
  for (let i = 1; i <= lineItemCount; i++) {
    const line = document.getElementById(`po-line-${i}`);
    if (!line) continue;
    const matId = (document.getElementById(`po-mat-${i}`) as HTMLSelectElement)?.value;
    const desc = (document.getElementById(`po-desc-${i}`) as HTMLInputElement)?.value?.trim();
    const qty = parseFloat((document.getElementById(`po-qty-${i}`) as HTMLInputElement)?.value);
    const cost = parseFloat((document.getElementById(`po-cost-${i}`) as HTMLInputElement)?.value);
    if (!desc) continue;
    if (isNaN(qty) || qty <= 0) { showToast(`Line ${i}: quantity must be > 0`); return; }
    if (isNaN(cost) || cost < 0) { showToast(`Line ${i}: cost must be >= 0`); return; }
    items.push({ material_id: matId || null, description: desc, quantity: qty, unit_cost: cost });
  }
  if (!items.length) { showToast('Add at least one line item'); return; }

  disableBtn('pof-save-btn', true);
  try {
    await apiPost('/purchase-orders', { supplier_id: supplierId, items, order_date: orderDate });
    closeModal(); loadView('purchase-orders');
  } catch (e: any) { showToast(e.message); }
  finally { disableBtn('pof-save-btn', false); }
}

export async function showPODetail(id: string) {
  const po = await apiGet<PurchaseOrder>(`/purchase-orders/${id}`);
  showModal(`
    <h3>${esc(po.po_number)}</h3>
    <div class="summary-line"><span>Supplier</span><span>${esc(po.supplier_name)}</span></div>
    <div class="summary-line"><span>Status</span><span class="status-badge ${po.status}">${po.status}</span></div>
    <div class="summary-line"><span>Order Date</span><span>${fmtDate(po.order_date)}</span></div>
    ${po.received_date ? `<div class="summary-line"><span>Received</span><span>${fmtDate(po.received_date)}</span></div>` : ''}
    <h4 style="margin-top:var(--space-4)">Items</h4>
    <table style="margin-top:var(--space-2)">
      <thead><tr><th>Material</th><th>Description</th><th>Qty</th><th>Unit Cost</th><th>Total</th></tr></thead>
      <tbody>
        ${(po.items || []).map((item: any) => `
          <tr>
            <td data-label="Material">${esc(item.material_name || '-')}</td>
            <td data-label="Description">${esc(item.description)}</td>
            <td data-label="Qty">${item.quantity}</td>
            <td data-label="Unit Cost" style="font-family:var(--ff-mono)">${fmtPeso(item.unit_cost)}</td>
            <td data-label="Total" style="font-family:var(--ff-mono);font-weight:700">${fmtPeso(item.total)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <div class="summary-line total"><span>Total</span><span>${fmtPeso(po.total)}</span></div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Close</button>
    </div>
  `, 'po-detail-modal');
}

export async function receivePO(id: string) {
  const ok = await showConfirmModal(`<h3>Receive PO</h3><p style="color:var(--c-text-secondary)">Mark this purchase order as received? Stock quantities will be updated.</p>`);
  if (!ok) return;
  try {
    await apiPut(`/purchase-orders/${id}/receive`, {});
    showToast('PO received — stock updated', 'success');
    loadView('purchase-orders');
  } catch (e: any) { showToast(e.message); }
}

export async function cancelPO(id: string) {
  const ok = await showConfirmModal(`<h3>Cancel PO</h3><p style="color:var(--c-text-secondary)">Are you sure you want to cancel this purchase order?</p>`);
  if (!ok) return;
  try {
    await apiPut(`/purchase-orders/${id}/cancel`, {});
    loadView('purchase-orders');
  } catch (e: any) { showToast(e.message); }
}

export async function delPO(id: string) {
  const ok = await showConfirmModal(`<h3>Delete PO</h3><p style="color:var(--c-text-secondary)">Delete this pending purchase order?</p>`);
  if (!ok) return;
  try { await apiDel(`/purchase-orders/${id}`); loadView('purchase-orders'); }
  catch (e: any) { showToast(e.message); }
}
