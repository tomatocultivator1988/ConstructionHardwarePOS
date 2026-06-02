import { apiGet, apiPost, apiPut, apiDel } from '../lib/api';
import { esc, val, setErr, clearErr, disableBtn } from '../lib/helpers';
import { showModal, closeModal, showToast, showConfirmModal } from '../lib/helpers';
import { loadView } from '../lib/router';
import type { Material } from '../lib/types';

const UNIT_OPTIONS = ['Each', 'Kilogram', 'Meter', 'Roll', 'Gallon', 'Pieces', 'Liter', 'Box', 'Set', 'Bag', 'Pair', 'Sack', 'Bottle', 'Pack'];

function unitOptions(selected?: string) {
  const all = selected && !UNIT_OPTIONS.includes(selected) ? [selected, ...UNIT_OPTIONS] : UNIT_OPTIONS;
  return all.map(u => `<option value="${esc(u)}"${u === selected ? ' selected' : ''}>${esc(u)}</option>`).join('');
}

export async function renderMaterials(): Promise<string> {
  const materials = await apiGet<Material[]>('/materials');
  (window as any).__materialNames = Object.fromEntries(materials.map((m: Material) => [m.id, m.name]));
  return `
    <div class="page-header">
      <h2>Materials</h2>
      <button class="btn btn-primary" onclick="showMaterialModal()">+ Add Material</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Name</th><th>Unit</th><th>Stock</th><th>Cost</th><th>Retail</th><th>Profit</th><th>Margin</th><th class="actions">Actions</th></tr></thead>
        <tbody>
          ${materials.length ? materials.map((m: Material) => {
            const isLow = m.stock <= m.reorder_point;
            const profit = m.price_per_unit - (m.cost_price || 0);
            const margin = m.price_per_unit > 0 ? (profit / m.price_per_unit * 100) : 0;
            return `<tr class="${isLow ? 'low-stock' : ''}">
              <td style="font-weight:600">${esc(m.name)}</td>
              <td>${esc(m.unit)}</td>
              <td>${m.stock}${isLow ? ' ⚠' : ''}</td>
              <td>₱${(m.cost_price || 0).toFixed(2)}</td>
              <td>₱${m.price_per_unit.toFixed(2)}</td>
              <td style="color:${profit > 0 ? 'var(--c-success)' : profit < 0 ? 'var(--c-danger)' : 'var(--c-text-muted)'}">₱${profit.toFixed(2)}</td>
              <td style="color:${margin > 0 ? 'var(--c-success)' : margin < 0 ? 'var(--c-danger)' : 'var(--c-text-muted)'}">${margin.toFixed(1)}%</td>
              <td class="actions">
                <button class="btn btn-primary btn-sm" onclick="editMaterial('${m.id}')">Edit</button>
                <button class="btn btn-danger btn-sm" onclick="delMaterial('${m.id}')">Delete</button>
              </td>
            </tr>`;
          }).join('') : '<tr><td colspan="8" style="text-align:center;color:var(--c-text-muted);padding:2rem">No materials yet</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

export function showMaterialModal(data?: Material) {
  const isEdit = !!data;
  showModal(`
    <h3>${isEdit ? 'Edit' : 'Add'} Material</h3>
    <div class="form-group"><label>Name *</label><input id="mf-name" maxlength="100" value="${esc(data?.name || '')}" /><div class="field-error" id="mf-name-err"></div></div>
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
  const stockRaw = val('mf-stock'); const reorderRaw = val('mf-reorder');
  const stock = parseInt(stockRaw) || 0; const reorder = parseInt(reorderRaw) || 0;
  if (!name) { setErr('mf-name-err', 'Name is required'); return; }
  if (name.length < 2) { setErr('mf-name-err', 'Must be at least 2 characters'); return; }
  if (!unit) { setErr('mf-unit-err', 'Unit is required'); return; }
  if (stockRaw && (isNaN(parseInt(stockRaw)) || parseInt(stockRaw) < 0 || String(parseInt(stockRaw)) !== stockRaw)) { setErr('mf-stock-err', 'Must be a whole number ≥ 0'); return; }
  if (reorderRaw && (isNaN(parseInt(reorderRaw)) || parseInt(reorderRaw) < 0 || String(parseInt(reorderRaw)) !== reorderRaw)) { setErr('mf-reorder-err', 'Must be a whole number ≥ 0'); return; }
  if (isNaN(cost) || cost < 0) { setErr('mf-cost-err', 'Must be 0 or more'); return; }
  if (isNaN(price) || price <= 0) { setErr('mf-price-err', 'Must be > 0'); return; }
  disableBtn('mf-save-btn', true);
  try {
    await apiPost('/materials', { name, unit, stock, cost_price: cost, price_per_unit: price, reorder_point: reorder });
    closeModal(); loadView('materials');
  } catch (e: any) { showToast(e.message); }
  finally { disableBtn('mf-save-btn', false); }
}

export async function updateMaterial(id: string) {
  ['mf-name','mf-unit','mf-price','mf-cost','mf-stock','mf-reorder'].forEach(i => clearErr(i + '-err'));
  const name = val('mf-name').trim(); const unit = val('mf-unit');
  const price = parseFloat(val('mf-price')); const cost = parseFloat(val('mf-cost'));
  const stockRaw = val('mf-stock'); const reorderRaw = val('mf-reorder');
  const stock = parseInt(stockRaw) || 0; const reorder = parseInt(reorderRaw) || 0;
  if (!name) { setErr('mf-name-err', 'Name is required'); return; }
  if (name.length < 2) { setErr('mf-name-err', 'Must be at least 2 characters'); return; }
  if (!unit) { setErr('mf-unit-err', 'Unit is required'); return; }
  if (stockRaw && (isNaN(parseInt(stockRaw)) || parseInt(stockRaw) < 0 || String(parseInt(stockRaw)) !== stockRaw)) { setErr('mf-stock-err', 'Must be a whole number ≥ 0'); return; }
  if (reorderRaw && (isNaN(parseInt(reorderRaw)) || parseInt(reorderRaw) < 0 || String(parseInt(reorderRaw)) !== reorderRaw)) { setErr('mf-reorder-err', 'Must be a whole number ≥ 0'); return; }
  if (isNaN(cost) || cost < 0) { setErr('mf-cost-err', 'Must be 0 or more'); return; }
  if (isNaN(price) || price <= 0) { setErr('mf-price-err', 'Must be > 0'); return; }
  disableBtn('mf-save-btn', true);
  try {
    await apiPut(`/materials/${id}`, { name, unit, stock, cost_price: cost, price_per_unit: price, reorder_point: reorder });
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
