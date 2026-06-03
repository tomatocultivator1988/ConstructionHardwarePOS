import { apiGet, apiPost, apiPut, apiDel } from '../lib/api';
import { esc, val, setErr, clearErr, disableBtn, fmtDate, fmtPeso } from '../lib/helpers';
import { showModal, closeModal, showToast, showConfirmModal } from '../lib/helpers';
import { loadView } from '../lib/router';
import type { Material, StockMovement } from '../lib/types';

const UNIT_OPTIONS = ['Each', 'Kilogram', 'Meter', 'Roll', 'Gallon', 'Pieces', 'Liter', 'Box', 'Set', 'Bag', 'Pair', 'Sack', 'Bottle', 'Pack'];

const MAT_CATEGORIES = ['', 'Cement', 'Steel/Rebar', 'Lumber/Wood', 'Plumbing', 'Electrical', 'Paint', 'Hardware', 'Sand/Gravel', 'Roofing', 'Tools', 'Other'];

function unitOptions(selected?: string) {
  const all = selected && !UNIT_OPTIONS.includes(selected) ? [selected, ...UNIT_OPTIONS] : UNIT_OPTIONS;
  return all.map(u => `<option value="${esc(u)}"${u === selected ? ' selected' : ''}>${esc(u)}</option>`).join('');
}

function catOptions(selected?: string) {
  return MAT_CATEGORIES.map(c => `<option value="${esc(c)}"${c === selected ? ' selected' : ''}>${esc(c) || '- All Categories -'}</option>`).join('');
}

export async function renderMaterials(): Promise<string> {
  const materials = await apiGet<Material[]>('/materials');
  (window as any).__materialNames = Object.fromEntries(materials.map((m: Material) => [m.id, m.name]));
  return `
    <div class="page-header">
      <h2>Materials</h2>
      <div style="display:flex;gap:var(--space-3);align-items:center">
        <select id="mat-cat-filter" onchange="filterMaterials()" style="min-height:36px;background:var(--c-surface-elevated);color:var(--c-text);border:1px solid var(--c-border);border-radius:var(--radius-md);padding:0 var(--space-3);font-size:var(--fs-sm)">
          ${catOptions()}
        </select>
        <button class="btn btn-primary" onclick="showMaterialModal()">+ Add Material</button>
      </div>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Name</th><th>Category</th><th>Unit</th><th>Stock</th><th>Cost</th><th>Retail</th><th>Profit</th><th>Margin</th><th class="actions">Actions</th></tr></thead>
        <tbody>
          ${materials.length ? materials.map((m: Material) => {
            const isLow = m.stock <= m.reorder_point;
            const profit = m.price_per_unit - (m.cost_price || 0);
            const margin = m.price_per_unit > 0 ? (profit / m.price_per_unit * 100) : 0;
            return `<tr class="${isLow ? 'low-stock' : ''}">
              <td style="font-weight:600">${esc(m.name)}</td>
              <td><span style="font-size:var(--fs-xs);color:var(--c-text-muted)">${esc(m.category || '-')}</span></td>
              <td>${esc(m.unit)}</td>
              <td>${m.stock}${isLow ? ' ⚠' : ''}</td>
              <td>₱${(m.cost_price || 0).toFixed(2)}</td>
              <td>₱${m.price_per_unit.toFixed(2)}</td>
              <td style="color:${profit > 0 ? 'var(--c-success)' : profit < 0 ? 'var(--c-danger)' : 'var(--c-text-muted)'}">₱${profit.toFixed(2)}</td>
              <td style="color:${margin > 0 ? 'var(--c-success)' : margin < 0 ? 'var(--c-danger)' : 'var(--c-text-muted)'}">${margin.toFixed(1)}%</td>
              <td class="actions">
                <button class="btn btn-primary btn-sm" onclick="editMaterial('${m.id}')">Edit</button>
                <button class="btn btn-sm" onclick="showStockHistory('${m.id}')">History</button>
                <button class="btn btn-danger btn-sm" onclick="delMaterial('${m.id}')">Delete</button>
              </td>
            </tr>`;
          }).join('') : '<tr><td colspan="9" style="text-align:center;color:var(--c-text-muted);padding:2rem">No materials yet</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

export function showMaterialModal(data?: Material) {
  const isEdit = !!data;
  showModal(`
    <h3>${isEdit ? 'Edit' : 'Add'} Material</h3>
    <div class="form-row">
      <div class="form-group"><label>Name *</label><input id="mf-name" maxlength="100" value="${esc(data?.name || '')}" /><div class="field-error" id="mf-name-err"></div></div>
      <div class="form-group"><label>Category</label>
        <select id="mf-category">${catOptions(data?.category || '')}</select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Unit *</label>
        <select id="mf-unit"><option value="">Select unit...</option>${unitOptions(data?.unit)}</select>
        <div class="field-error" id="mf-unit-err"></div>
      </div>
      <div class="form-group"><label>Stock</label><input id="mf-stock" type="number" min="0" value="${data?.stock ?? 0}" /><div class="field-error" id="mf-stock-err"></div></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Cost Price</label><input id="mf-cost" type="number" step="0.01" min="0" value="${data?.cost_price ?? ''}" placeholder="0.00" /><div class="field-error" id="mf-cost-err"></div></div>
      <div class="form-group"><label>Retail Price *</label><input id="mf-price" type="number" step="0.01" min="0.01" value="${data?.price_per_unit ?? ''}" /><div class="field-error" id="mf-price-err"></div></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Wholesale Price</label><input id="mf-wprice" type="number" step="0.01" min="0" value="${data?.wholesale_price ? data.wholesale_price.toString() : ''}" placeholder="0.00 = same as retail" /><div class="helper" style="font-size:var(--fs-xs);color:var(--c-text-muted);margin-top:var(--space-1)">Leave 0 to use retail price</div></div>
      <div class="form-group"><label>Reorder Point</label><input id="mf-reorder" type="number" min="0" value="${data?.reorder_point ?? 10}" /><div class="field-error" id="mf-reorder-err"></div></div>
    </div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="mf-save-btn" onclick="${isEdit ? `updateMaterial('${data!.id}')` : 'createMaterial()'}">Save</button>
    </div>
  `, 'material-modal');
}

export async function createMaterial() {
  ['mf-name','mf-unit','mf-price','mf-cost','mf-stock','mf-reorder'].forEach(id => clearErr(id + '-err'));
  const name = val('mf-name').trim(); const unit = val('mf-unit');
  const price = parseFloat(val('mf-price')); const cost = parseFloat(val('mf-cost'));
  const wpriceRaw = parseFloat(val('mf-wprice')); const wprice = isNaN(wpriceRaw) ? 0 : wpriceRaw;
  const stockRaw = val('mf-stock'); const reorderRaw = val('mf-reorder');
  const stock = parseInt(stockRaw) || 0; const reorder = parseInt(reorderRaw) || 0;
  const category = val('mf-category');
  if (!name) { setErr('mf-name-err', 'Name is required'); return; }
  if (name.length < 2) { setErr('mf-name-err', 'Must be at least 2 characters'); return; }
  if (!unit) { setErr('mf-unit-err', 'Unit is required'); return; }
  if (stockRaw && (isNaN(parseInt(stockRaw)) || parseInt(stockRaw) < 0 || String(parseInt(stockRaw)) !== stockRaw)) { setErr('mf-stock-err', 'Must be a whole number ≥ 0'); return; }
  if (reorderRaw && (isNaN(parseInt(reorderRaw)) || parseInt(reorderRaw) < 0 || String(parseInt(reorderRaw)) !== reorderRaw)) { setErr('mf-reorder-err', 'Must be a whole number ≥ 0'); return; }
  if (isNaN(cost) || cost < 0) { setErr('mf-cost-err', 'Must be 0 or more'); return; }
  if (isNaN(price) || price <= 0) { setErr('mf-price-err', 'Must be > 0'); return; }
  disableBtn('mf-save-btn', true);
  try {
    await apiPost('/materials', { name, unit, stock, cost_price: cost, price_per_unit: price, wholesale_price: wprice, reorder_point: reorder, category });
    closeModal(); loadView('materials');
  } catch (e: any) { showToast(e.message); }
  finally { disableBtn('mf-save-btn', false); }
}

export async function updateMaterial(id: string) {
  ['mf-name','mf-unit','mf-price','mf-cost','mf-stock','mf-reorder'].forEach(i => clearErr(i + '-err'));
  const name = val('mf-name').trim(); const unit = val('mf-unit');
  const price = parseFloat(val('mf-price')); const cost = parseFloat(val('mf-cost'));
  const wpriceRaw = parseFloat(val('mf-wprice')); const wprice = isNaN(wpriceRaw) ? 0 : wpriceRaw;
  const stockRaw = val('mf-stock'); const reorderRaw = val('mf-reorder');
  const stock = parseInt(stockRaw) || 0; const reorder = parseInt(reorderRaw) || 0;
  const category = val('mf-category');
  if (!name) { setErr('mf-name-err', 'Name is required'); return; }
  if (name.length < 2) { setErr('mf-name-err', 'Must be at least 2 characters'); return; }
  if (!unit) { setErr('mf-unit-err', 'Unit is required'); return; }
  if (stockRaw && (isNaN(parseInt(stockRaw)) || parseInt(stockRaw) < 0 || String(parseInt(stockRaw)) !== stockRaw)) { setErr('mf-stock-err', 'Must be a whole number ≥ 0'); return; }
  if (reorderRaw && (isNaN(parseInt(reorderRaw)) || parseInt(reorderRaw) < 0 || String(parseInt(reorderRaw)) !== reorderRaw)) { setErr('mf-reorder-err', 'Must be a whole number ≥ 0'); return; }
  if (isNaN(cost) || cost < 0) { setErr('mf-cost-err', 'Must be 0 or more'); return; }
  if (isNaN(price) || price <= 0) { setErr('mf-price-err', 'Must be > 0'); return; }
  disableBtn('mf-save-btn', true);
  try {
    await apiPut(`/materials/${id}`, { name, unit, stock, cost_price: cost, price_per_unit: price, wholesale_price: wprice, reorder_point: reorder, category });
    closeModal(); loadView('materials');
  } catch (e: any) { showToast(e.message); }
  finally { disableBtn('mf-save-btn', false); }
}

export async function editMaterial(id: string) {
  const mats = await apiGet<Material[]>('/materials');
  showMaterialModal(mats.find((x: Material) => x.id === id));
}

export async function delMaterial(id: string) {
  const name = (window as any).__materialNames?.[id] || 'this material';
  const ok = await showConfirmModal(`<h3>Delete Material</h3><p style="color:var(--c-text-secondary)">Are you sure you want to delete <strong>${esc(name)}</strong>?</p>`);
  if (!ok) return;
  try { await apiDel(`/materials/${id}`); loadView('materials'); }
  catch (e: any) { showToast(e.message); }
}

export async function showStockHistory(materialId: string) {
  const name = (window as any).__materialNames?.[materialId] || 'this material';
  const movements = await apiGet<StockMovement[]>(`/stock-movements?material_id=${materialId}`);
  showModal(`
    <h3>Stock History — ${esc(name)}</h3>
    ${movements.length ? `
    <table style="margin-top:var(--space-2)">
      <thead><tr><th>Date</th><th>Type</th><th>Qty</th><th>Reference</th><th>Notes</th></tr></thead>
      <tbody>
        ${movements.map((sm: StockMovement) => `
          <tr>
            <td>${fmtDate(sm.created_at)}</td>
            <td><span class="status-badge" style="background:${sm.type === 'sale' ? 'var(--c-danger-bg)' : sm.type === 'po' ? 'var(--c-success-bg)' : 'var(--c-primary-bg)'};color:${sm.type === 'sale' ? 'var(--c-danger)' : sm.type === 'po' ? 'var(--c-success)' : 'var(--c-primary)'}">${sm.type}</span></td>
            <td style="color:${sm.quantity < 0 ? 'var(--c-danger)' : 'var(--c-success)'};font-weight:600">${sm.quantity > 0 ? '+' : ''}${sm.quantity}</td>
            <td>${esc(sm.reference_type || '-')}</td>
            <td>${esc(sm.notes || '-')}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    ` : '<p style="color:var(--c-text-muted);padding:2rem;text-align:center">No movement history yet</p>'}
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Close</button>
    </div>
  `, 'stock-history-modal');
}

export async function filterMaterials() {
  const cat = (document.getElementById('mat-cat-filter') as HTMLSelectElement)?.value ?? '';
  const url = cat ? `/materials?category=${encodeURIComponent(cat)}` : '/materials';
  const materials = await apiGet<Material[]>(url);
  const tbody = document.querySelector('table tbody');
  if (!tbody) return;
  tbody.innerHTML = materials.length ? materials.map((m: Material) => {
    const isLow = m.stock <= m.reorder_point;
    const profit = m.price_per_unit - (m.cost_price || 0);
    const margin = m.price_per_unit > 0 ? (profit / m.price_per_unit * 100) : 0;
    return `<tr class="${isLow ? 'low-stock' : ''}">
      <td style="font-weight:600">${esc(m.name)}</td>
      <td><span style="font-size:var(--fs-xs);color:var(--c-text-muted)">${esc(m.category || '-')}</span></td>
      <td>${esc(m.unit)}</td>
      <td>${m.stock}${isLow ? ' ⚠' : ''}</td>
      <td>₱${(m.cost_price || 0).toFixed(2)}</td>
      <td>₱${m.price_per_unit.toFixed(2)}</td>
      <td style="color:${profit > 0 ? 'var(--c-success)' : profit < 0 ? 'var(--c-danger)' : 'var(--c-text-muted)'}">₱${profit.toFixed(2)}</td>
      <td style="color:${margin > 0 ? 'var(--c-success)' : margin < 0 ? 'var(--c-danger)' : 'var(--c-text-muted)'}">${margin.toFixed(1)}%</td>
      <td class="actions">
        <button class="btn btn-primary btn-sm" onclick="editMaterial('${m.id}')">Edit</button>
        <button class="btn btn-sm" onclick="showStockHistory('${m.id}')">History</button>
        <button class="btn btn-danger btn-sm" onclick="delMaterial('${m.id}')">Delete</button>
      </td>
    </tr>`;
  }).join('') : '<tr><td colspan="9" style="text-align:center;color:var(--c-text-muted);padding:2rem">No materials found</td></tr>';
}
