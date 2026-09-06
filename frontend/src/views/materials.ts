import { apiGet, apiPost, apiPut, apiDel } from '../lib/api';
import { esc, val, setErr, clearErr, disableBtn, fmtDate, fmtPeso } from '../lib/helpers';
import { showModal, closeModal, showToast, showConfirmModal } from '../lib/helpers';
import { loadView } from '../lib/router';
import type { Material, StockMovement, Supplier } from '../lib/types';

let UNIT_OPTIONS = ['Each', 'Kilogram', 'Meter', 'Roll', 'Gallon', 'Pieces', 'Liter', 'Box', 'Set', 'Bag', 'Pair', 'Sack', 'Bottle', 'Pack'];

let MAT_CATEGORIES = ['', 'Cement', 'Steel/Rebar', 'Lumber/Wood', 'Plumbing', 'Electrical', 'Paint', 'Hardware', 'Sand/Gravel', 'Roofing', 'Tools', 'Other'];
let materialPage = 1;
const MATERIAL_PAGE_SIZE = 15;
let materialSearch = '';
let materialCategory = '';

function unitOptions(selected?: string) {
  const isCustom = !!selected && !UNIT_OPTIONS.includes(selected);
  return UNIT_OPTIONS.map(u => `<option value="${esc(u)}"${u === selected ? ' selected' : ''}>${esc(u)}</option>`).join('') + `<option value="__custom__"${isCustom ? ' selected' : ''}>Custom unit…</option>`;
}

export function toggleCustomUnit() {
  const select = document.getElementById('mf-unit') as HTMLSelectElement | null;
  const input = document.getElementById('mf-custom-unit') as HTMLInputElement | null;
  if (!select || !input) return;
  const custom = select.value === '__custom__';
  input.style.display = custom ? '' : 'none';
  input.required = custom;
  if (custom) input.focus();
}

export async function addProductCatalogOption(type: 'category' | 'unit') {
  const label = type === 'category' ? 'New Product Category' : 'New Unit of Measure';
  showModal(`<h3>${label}</h3><p class="modal-help">Add a reusable option for future products.</p><div class="form-group"><label for="catalog-name">Name *</label><input id="catalog-name" maxlength="60" autofocus placeholder="Enter ${type === 'category' ? 'category' : 'unit'} name" /><div class="field-error" id="catalog-name-err"></div></div><div class="modal-actions"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveProductCatalogOption('${type}')">Add</button></div>`, 'catalog-option-modal');
}

export async function saveProductCatalogOption(type: 'category' | 'unit') {
  const label = type === 'category' ? 'Product category' : 'Unit of measure';
  const name = val('catalog-name').trim();
  if (name.length < 2) { setErr('catalog-name-err', 'Enter at least 2 characters'); return; }
  try {
    const option = await apiPost<{ name: string }>('/catalog', { type, name });
    const values = type === 'category' ? MAT_CATEGORIES : UNIT_OPTIONS;
    if (!values.includes(option.name)) values.push(option.name);
    const select = document.getElementById(type === 'category' ? 'mf-category' : 'mf-unit') as HTMLSelectElement | null;
    if (select) { const opt = document.createElement('option'); opt.value = option.name; opt.textContent = option.name; opt.selected = true; select.appendChild(opt); }
    closeModal(); showToast(`${label} added`, 'success');
  } catch (e: any) { showToast(e.message || 'Unable to add option'); }
}

function catOptions(selected?: string) {
  return MAT_CATEGORIES.map(c => `<option value="${esc(c)}"${c === selected ? ' selected' : ''}>${esc(c) || '- All Categories -'}</option>`).join('');
}

export async function renderMaterials(): Promise<string> {
  const query = new URLSearchParams({ page: String(materialPage), pageSize: String(MATERIAL_PAGE_SIZE) });
  if (materialSearch) query.set('search', materialSearch);
  if (materialCategory) query.set('category', materialCategory);
  const [response, suppliers, catalog] = await Promise.all([
    apiGet<Material[] | { data: Material[]; total: number }>(`/materials?${query}`),
    apiGet<Supplier[]>('/suppliers'),
    apiGet<Record<string, string[]>>('/catalog'),
  ]);
  if (catalog.category?.length) MAT_CATEGORIES = ['', ...catalog.category];
  if (catalog.unit?.length) UNIT_OPTIONS = catalog.unit;
  (window as any).__materialSuppliers = suppliers;
  const materials = Array.isArray(response) ? response : response.data;
  const totalMaterials = Array.isArray(response) ? response.length : response.total;
  (window as any).__materialNames = Object.fromEntries(materials.map((m: Material) => [m.id, m.name]));
  return `
    <div class="page-header">
      <h2>Products</h2>
      <div class="material-toolbar" style="display:flex;gap:var(--space-3);align-items:center">
        <input id="mat-search" type="search" placeholder="Search materials..." value="${esc(materialSearch)}" oninput="filterMaterials()" style="min-height:36px;min-width:220px;background:var(--c-surface-elevated);color:var(--c-text);border:1px solid var(--c-border);border-radius:var(--radius-md);padding:0 var(--space-3);font-size:var(--fs-sm)" />
        <select id="mat-cat-filter" onchange="filterMaterials()" style="min-height:36px;background:var(--c-surface-elevated);color:var(--c-text);border:1px solid var(--c-border);border-radius:var(--radius-md);padding:0 var(--space-3);font-size:var(--fs-sm)">
          ${catOptions(materialCategory)}
        </select>
        <button class="btn btn-primary" onclick="showMaterialModal()">+ Add Product</button>
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
            return `<tr class="material-row ${isLow ? 'low-stock' : ''}" data-material-row="${m.id}">
              <td data-label="Name" style="font-weight:600">${esc(m.name)}</td>
              <td class="material-secondary" data-label="Category"><span style="font-size:var(--fs-xs);color:var(--c-text-muted)">${esc(m.category || '-')}</span></td>
              <td class="material-secondary" data-label="Unit">${esc(m.unit)}</td>
              <td data-label="Stock">${m.stock}${isLow ? ' ⚠' : ''}</td>
              <td class="material-secondary" data-label="Cost">₱${(m.cost_price || 0).toFixed(2)}</td>
              <td data-label="Retail">₱${m.price_per_unit.toFixed(2)}</td>
              <td class="material-secondary" data-label="Profit" style="color:${profit > 0 ? 'var(--c-success)' : profit < 0 ? 'var(--c-danger)' : 'var(--c-text-muted)'}">₱${profit.toFixed(2)}</td>
              <td class="material-secondary" data-label="Margin" style="color:${margin > 0 ? 'var(--c-success)' : margin < 0 ? 'var(--c-danger)' : 'var(--c-text-muted)'}">${margin.toFixed(1)}%</td>
              <td data-label="" class="actions">
                <button class="btn btn-sm mobile-details-btn" onclick="toggleMobileDetails('${m.id}')">Details</button>
                <button class="btn btn-primary btn-sm" onclick="editMaterial('${m.id}')">Edit</button>
                <button class="btn btn-sm" onclick="showStockHistory('${m.id}')">History</button>
                <button class="btn btn-danger btn-sm" onclick="delMaterial('${m.id}')">Delete</button>
              </td>
            </tr>`;
          }).join('') : '<tr><td colspan="9" style="text-align:center;color:var(--c-text-muted);padding:2rem">No materials yet</td></tr>'}
        </tbody>
      </table>
    </div>
    <div id="materials-pagination">${totalMaterials > MATERIAL_PAGE_SIZE ? paginationMarkup(totalMaterials) : ''}</div>
  `;
}

function paginationMarkup(total: number) {
  const pages = Math.ceil(total / MATERIAL_PAGE_SIZE);
  return `<div class="pagination"><span>Showing ${(materialPage-1)*MATERIAL_PAGE_SIZE+1}–${Math.min(materialPage*MATERIAL_PAGE_SIZE, total)} of ${total}</span><button class="btn btn-sm" ${materialPage===1?'disabled':''} onclick="changeMaterialPage(${materialPage-1})">Previous</button><strong>Page ${materialPage} of ${pages}</strong><button class="btn btn-sm" ${materialPage>=pages?'disabled':''} onclick="changeMaterialPage(${materialPage+1})">Next</button></div>`;
}

export function changeMaterialPage(page: number) { materialPage = Math.max(1, page); loadView('materials'); }

export function showMaterialModal(data?: Material) {
  const isEdit = !!data;
  const suppliers: Supplier[] = (window as any).__materialSuppliers || [];
  showModal(`
    <h3>${isEdit ? 'Edit' : 'Add'} Product</h3>
    <div class="form-row">
      <div class="form-group"><label>Name *</label><input id="mf-name" maxlength="100" value="${esc(data?.name || '')}" /><div class="field-error" id="mf-name-err"></div></div>
      <div class="form-group"><label>Category</label>
        <div class="catalog-field"><select id="mf-category">${catOptions(data?.category || '')}</select><button type="button" class="btn btn-sm" onclick="addProductCatalogOption('category')">+ Add</button></div>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Unit *</label>
        <div class="catalog-field"><select id="mf-unit" onchange="toggleCustomUnit()"><option value="">Select unit...</option>${unitOptions(data?.unit)}</select><button type="button" class="btn btn-sm" onclick="addProductCatalogOption('unit')">+ Add</button></div>
        <input id="mf-custom-unit" maxlength="30" value="${data?.unit && !UNIT_OPTIONS.includes(data.unit) ? esc(data.unit) : ''}" placeholder="e.g. Bundle, Sheet, Truckload" style="margin-top:6px;display:${data?.unit && !UNIT_OPTIONS.includes(data.unit) ? '' : 'none'}" />
        <div class="field-error" id="mf-unit-err"></div>
      </div>
      <div class="form-group"><label>Stock</label><input id="mf-stock" type="number" min="0" value="${data?.stock ?? 0}" /><div class="field-error" id="mf-stock-err"></div></div>
    </div>
    <div class="form-group"><label>Supplier (optional)</label><select id="mf-supplier"><option value="">No supplier selected</option>${suppliers.map(s => `<option value="${s.id}"${s.id === (data as any)?.supplier_id ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
    <div class="form-row">
      <div class="form-group"><label>Cost Price</label><input id="mf-cost" type="number" step="0.01" min="0" value="${data?.cost_price ?? ''}" placeholder="0.00" /><div class="field-error" id="mf-cost-err"></div></div>
      <div class="form-group"><label>Retail Price *</label><input id="mf-price" type="number" step="0.01" min="0.01" value="${data?.price_per_unit ?? ''}" /><div class="field-error" id="mf-price-err"></div></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Wholesale Price</label><input id="mf-wprice" type="number" step="0.01" min="0" value="${data?.wholesale_price ? data.wholesale_price.toString() : ''}" placeholder="0.00 = same as retail" /><div class="helper" style="font-size:var(--fs-xs);color:var(--c-text-muted);margin-top:var(--space-1)">Leave 0 to use retail price</div></div>
      <div class="form-group"><label>Minimum Stock / Reorder Level</label><input id="mf-reorder" type="number" min="0" value="${data?.reorder_point ?? 10}" /><div class="field-error" id="mf-reorder-err"></div></div>
    </div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="mf-save-btn" onclick="${isEdit ? `updateMaterial('${data!.id}')` : 'createMaterial()'}">Save</button>
    </div>
  `, 'material-modal');
  const modal = document.getElementById('material-modal');
  const actions = modal?.querySelector('.modal-actions');
  if (modal && actions && !document.getElementById('mf-barcode')) actions.insertAdjacentHTML('beforebegin', '<div class="form-group"><label>Barcode / SKU <span>(optional)</span></label><input id="mf-barcode" maxlength="100" value="' + esc(data?.barcode || '') + '" placeholder="Scan or type product barcode" /><div class="helper">Use a USB or Bluetooth scanner, or enter a barcode manually.</div></div>');
}

export async function createMaterial() {
  ['mf-name','mf-unit','mf-price','mf-cost','mf-stock','mf-reorder'].forEach(id => clearErr(id + '-err'));
  const name = val('mf-name').trim(); const selectedUnit = val('mf-unit'); const unit = selectedUnit === '__custom__' ? val('mf-custom-unit').trim() : selectedUnit;
  const price = parseFloat(val('mf-price')); const cost = parseFloat(val('mf-cost'));
  const wpriceRaw = parseFloat(val('mf-wprice')); const wprice = isNaN(wpriceRaw) ? 0 : wpriceRaw;
  const stockRaw = val('mf-stock'); const reorderRaw = val('mf-reorder');
  const stock = parseInt(stockRaw) || 0; const reorder = parseInt(reorderRaw) || 0;
  const category = val('mf-category'); const supplier_id = val('mf-supplier') || null; const barcode = val('mf-barcode').trim();
  if (!name) { setErr('mf-name-err', 'Name is required'); return; }
  if (name.length < 2) { setErr('mf-name-err', 'Must be at least 2 characters'); return; }
  if (!unit) { setErr('mf-unit-err', 'Unit is required'); return; }
  if (stockRaw && (isNaN(parseInt(stockRaw)) || parseInt(stockRaw) < 0 || String(parseInt(stockRaw)) !== stockRaw)) { setErr('mf-stock-err', 'Must be a whole number ≥ 0'); return; }
  if (reorderRaw && (isNaN(parseInt(reorderRaw)) || parseInt(reorderRaw) < 0 || String(parseInt(reorderRaw)) !== reorderRaw)) { setErr('mf-reorder-err', 'Must be a whole number ≥ 0'); return; }
  if (isNaN(cost) || cost < 0) { setErr('mf-cost-err', 'Must be 0 or more'); return; }
  if (isNaN(price) || price <= 0) { setErr('mf-price-err', 'Must be > 0'); return; }
  disableBtn('mf-save-btn', true);
  try {
    await apiPost('/materials', { name, unit, stock, cost_price: cost, price_per_unit: price, wholesale_price: wprice, reorder_point: reorder, category, supplier_id, barcode: barcode || null });
    closeModal(); loadView('materials');
  } catch (e: any) { showToast(e.message); }
  finally { disableBtn('mf-save-btn', false); }
}

export async function updateMaterial(id: string) {
  ['mf-name','mf-unit','mf-price','mf-cost','mf-stock','mf-reorder'].forEach(i => clearErr(i + '-err'));
  const name = val('mf-name').trim(); const selectedUnit = val('mf-unit'); const unit = selectedUnit === '__custom__' ? val('mf-custom-unit').trim() : selectedUnit;
  const price = parseFloat(val('mf-price')); const cost = parseFloat(val('mf-cost'));
  const wpriceRaw = parseFloat(val('mf-wprice')); const wprice = isNaN(wpriceRaw) ? 0 : wpriceRaw;
  const stockRaw = val('mf-stock'); const reorderRaw = val('mf-reorder');
  const stock = parseInt(stockRaw) || 0; const reorder = parseInt(reorderRaw) || 0;
  const category = val('mf-category'); const supplier_id = val('mf-supplier') || null; const barcode = val('mf-barcode').trim();
  if (!name) { setErr('mf-name-err', 'Name is required'); return; }
  if (name.length < 2) { setErr('mf-name-err', 'Must be at least 2 characters'); return; }
  if (!unit) { setErr('mf-unit-err', 'Unit is required'); return; }
  if (stockRaw && (isNaN(parseInt(stockRaw)) || parseInt(stockRaw) < 0 || String(parseInt(stockRaw)) !== stockRaw)) { setErr('mf-stock-err', 'Must be a whole number ≥ 0'); return; }
  if (reorderRaw && (isNaN(parseInt(reorderRaw)) || parseInt(reorderRaw) < 0 || String(parseInt(reorderRaw)) !== reorderRaw)) { setErr('mf-reorder-err', 'Must be a whole number ≥ 0'); return; }
  if (isNaN(cost) || cost < 0) { setErr('mf-cost-err', 'Must be 0 or more'); return; }
  if (isNaN(price) || price <= 0) { setErr('mf-price-err', 'Must be > 0'); return; }
  disableBtn('mf-save-btn', true);
  try {
    await apiPut(`/materials/${id}`, { name, unit, stock, cost_price: cost, price_per_unit: price, wholesale_price: wprice, reorder_point: reorder, category, supplier_id, barcode: barcode || null });
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
            <td data-label="Date">${fmtDate(sm.created_at)}</td>
            <td data-label="Type"><span class="status-badge" style="background:${sm.type === 'sale' ? 'var(--c-danger-bg)' : sm.type === 'po' ? 'var(--c-success-bg)' : 'var(--c-primary-bg)'};color:${sm.type === 'sale' ? 'var(--c-danger)' : sm.type === 'po' ? 'var(--c-success)' : 'var(--c-primary)'}">${sm.type}</span></td>
            <td data-label="Qty" style="color:${sm.quantity < 0 ? 'var(--c-danger)' : 'var(--c-success)'};font-weight:600">${sm.quantity > 0 ? '+' : ''}${sm.quantity}</td>
            <td data-label="Reference">${esc(sm.reference_type || '-')}</td>
            <td data-label="Notes">${esc(sm.notes || '-')}</td>
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
  materialPage = 1;
  const cat = (document.getElementById('mat-cat-filter') as HTMLSelectElement)?.value ?? '';
  const search = (document.getElementById('mat-search') as HTMLInputElement)?.value.trim() ?? '';
  materialCategory = cat;
  materialSearch = search;
  const params = new URLSearchParams();
  if (cat) params.set('category', cat);
  if (search) params.set('search', search);
  const url = params.toString() ? `/materials?${params}` : '/materials';
  const response = await apiGet<Material[] | { data: Material[]; total: number }>(`${url}${url.includes('?') ? '&' : '?'}page=${materialPage}&pageSize=${MATERIAL_PAGE_SIZE}`);
  const materials = Array.isArray(response) ? response : response.data;
  const totalMaterials = Array.isArray(response) ? response.length : response.total;
  const tbody = document.querySelector('table tbody');
  if (!tbody) return;
  tbody.innerHTML = materials.length ? materials.slice((materialPage - 1) * MATERIAL_PAGE_SIZE, materialPage * MATERIAL_PAGE_SIZE).map((m: Material) => {
    const isLow = m.stock <= m.reorder_point;
    const profit = m.price_per_unit - (m.cost_price || 0);
    const margin = m.price_per_unit > 0 ? (profit / m.price_per_unit * 100) : 0;
    return `<tr class="material-row ${isLow ? 'low-stock' : ''}" data-material-row="${m.id}">
      <td data-label="Name" style="font-weight:600">${esc(m.name)}</td>
      <td class="material-secondary" data-label="Category"><span style="font-size:var(--fs-xs);color:var(--c-text-muted)">${esc(m.category || '-')}</span></td>
      <td class="material-secondary" data-label="Unit">${esc(m.unit)}</td>
      <td data-label="Stock">${m.stock}${isLow ? ' ⚠' : ''}</td>
      <td class="material-secondary" data-label="Cost">₱${(m.cost_price || 0).toFixed(2)}</td>
      <td data-label="Retail">₱${m.price_per_unit.toFixed(2)}</td>
      <td class="material-secondary" data-label="Profit" style="color:${profit > 0 ? 'var(--c-success)' : profit < 0 ? 'var(--c-danger)' : 'var(--c-text-muted)'}">₱${profit.toFixed(2)}</td>
      <td class="material-secondary" data-label="Margin" style="color:${margin > 0 ? 'var(--c-success)' : margin < 0 ? 'var(--c-danger)' : 'var(--c-text-muted)'}">${margin.toFixed(1)}%</td>
      <td data-label="" class="actions">
        <button class="btn btn-sm mobile-details-btn" onclick="toggleMobileDetails('${m.id}')">Details</button>
        <button class="btn btn-primary btn-sm" onclick="editMaterial('${m.id}')">Edit</button>
        <button class="btn btn-sm" onclick="showStockHistory('${m.id}')">History</button>
        <button class="btn btn-danger btn-sm" onclick="delMaterial('${m.id}')">Delete</button>
      </td>
    </tr>`;
  }).join('') : '<tr><td colspan="9" style="text-align:center;color:var(--c-text-muted);padding:2rem">No materials found</td></tr>';
  const pager = document.getElementById('materials-pagination');
  if (pager) pager.innerHTML = totalMaterials > MATERIAL_PAGE_SIZE ? paginationMarkup(totalMaterials) : '';
}

export function toggleMobileDetails(id: string) {
  document.querySelector(`[data-material-row="${id}"]`)?.classList.toggle('expanded');
}
