import { apiGet, apiPost, apiPut, apiDel } from '../lib/api';
import { esc, val, setErr, clearErr, disableBtn, fmtDate, fmtPeso, isAdmin, formatAggregateBreakdown } from '../lib/helpers';
import { showModal, closeModal, showToast, showConfirmModal } from '../lib/helpers';
import { loadView } from '../lib/router';
import { startBarcodeCameraScan } from './invoices';
import { openCategoriesManager } from './settings';
import type { Material, StockMovement, Supplier } from '../lib/types';

let UNIT_OPTIONS = ['Each', 'Kilogram', 'Meter', 'Roll', 'Gallon', 'Pieces', 'Liter', 'Box', 'Set', 'Bag', 'Pair', 'Sack', 'Cubic', 'cu.m', 'Bottle', 'Pack'];

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

function catOptions(selected?: string, blankLabel = '- All Categories -') {
  return MAT_CATEGORIES.map(c => `<option value="${esc(c)}"${c === selected ? ' selected' : ''}>${esc(c) || blankLabel}</option>`).join('');
}

function renderStockDisplay(m: Material): string {
  const isLow = m.stock <= m.reorder_point;
  const factor = Number(m.conversion_factor || 0);
  if (m.has_secondary_unit && factor > 1 && m.secondary_unit) {
    const totalSacks = Math.round(m.stock * factor);
    const breakdown = formatAggregateBreakdown(m.stock, m.conversion_factor, m.unit, m.secondary_unit);
    return `<div style="line-height:1.25">
      <strong>${Number(m.stock.toFixed(2))} ${esc(m.unit)}</strong>${isLow ? ' <span style="color:var(--c-danger)">⚠</span>' : ''}
      <div style="font-size:var(--fs-xs);color:var(--c-primary);font-weight:600;margin-top:2px">${esc(breakdown)}</div>
      <div style="font-size:11px;color:var(--c-text-muted)">(${totalSacks} ${esc(m.secondary_unit)} total)</div>
    </div>`;
  }
  return `${m.stock}${isLow ? ' ⚠' : ''}`;
}

function renderPriceDisplay(m: Material): string {
  if (m.has_secondary_unit && Number(m.secondary_price) > 0 && m.secondary_unit) {
    return `<div>
      <strong>${fmtPeso(m.price_per_unit)}</strong> <span style="font-size:var(--fs-xs);color:var(--c-text-muted)">/${esc(m.unit)}</span>
      <div style="font-size:var(--fs-xs);color:var(--c-primary);font-weight:600">${fmtPeso(m.secondary_price)} / ${esc(m.secondary_unit)}</div>
    </div>`;
  }
  return fmtPeso(m.price_per_unit);
}

export function toggleDualUnitFields() {
  const checkbox = document.getElementById('mf-has-dual-unit') as HTMLInputElement | null;
  const container = document.getElementById('mf-dual-unit-container');
  if (!checkbox || !container) return;
  container.style.display = checkbox.checked ? 'block' : 'none';
  updateDualUnitPreview();
}

export function updateDualUnitPreview() {
  const checkbox = document.getElementById('mf-has-dual-unit') as HTMLInputElement | null;
  const previewBox = document.getElementById('mf-dual-unit-preview');
  const conversionLabel = document.getElementById('mf-conversion-label');
  const conversionHelper = document.getElementById('mf-conversion-helper');
  const secondaryPriceLabel = document.getElementById('mf-secondary-price-label');
  const secondaryPriceHelper = document.getElementById('mf-secondary-price-helper');
  const priceLabel = document.getElementById('mf-price-label');
  const costLabel = document.getElementById('mf-cost-label');

  const selectedUnit = val('mf-unit');
  const mainUnit = (selectedUnit === '__custom__' ? val('mf-custom-unit').trim() : selectedUnit) || 'Bulk Unit';
  const secUnit = val('mf-secondary-unit').trim() || 'Sack';
  const factor = parseFloat(val('mf-conversion-factor')) || 0;
  const mainPrice = parseFloat(val('mf-price')) || 0;
  const secPrice = parseFloat(val('mf-secondary-price')) || 0;
  const stock = parseFloat(val('mf-stock')) || 0;

  if (priceLabel) priceLabel.textContent = `Retail Price (per ${mainUnit}) *`;
  if (costLabel) costLabel.textContent = `Cost Price (per ${mainUnit})`;
  if (conversionLabel) conversionLabel.innerHTML = `How many <strong>${esc(secUnit)}</strong> in 1 <strong>${esc(mainUnit)}</strong>? *`;
  if (conversionHelper) conversionHelper.textContent = `e.g. ${factor > 1 ? factor : 26} ${secUnit} per 1 ${mainUnit}`;
  if (secondaryPriceLabel) secondaryPriceLabel.innerHTML = `Retail Price per <strong>${esc(secUnit)}</strong> (₱) *`;
  if (secondaryPriceHelper) secondaryPriceHelper.textContent = `Selling price in POS when customer buys per ${secUnit}`;

  if (!previewBox) return;
  if (!checkbox?.checked) {
    previewBox.style.display = 'none';
    previewBox.innerHTML = '';
    return;
  }
  previewBox.style.display = 'block';

  const isInverse = (mainUnit.toLowerCase().includes('sack') || mainUnit.toLowerCase().includes('bag') || mainUnit.toLowerCase().includes('pc') || mainUnit.toLowerCase().includes('piece')) && (secUnit.toLowerCase().includes('cub') || secUnit.toLowerCase().includes('cu.m') || secUnit.toLowerCase().includes('box') || secUnit.toLowerCase().includes('bundle'));
  const inverseWarningHTML = isInverse ? `
    <div style="background:#fff3cd;color:#856404;border:1px solid #ffeeba;border-radius:var(--radius-sm);padding:var(--space-2) var(--space-3);font-size:var(--fs-xs);margin-bottom:var(--space-2);line-height:1.4">
      ⚠️ <strong>Paalala: Baligtad po ang units!</strong><br>
      Ang <strong>${esc(secUnit)}</strong> ay mas malaki kaysa sa <strong>${esc(mainUnit)}</strong>.<br>
      Dapat po ang <strong>Main / Stock Unit</strong> sa itaas ay <strong>${esc(secUnit)}</strong> (bulto), at ang <strong>Smaller / Tingi Unit</strong> dito sa ilalim ay <strong>${esc(mainUnit)}</strong> (tingi).
    </div>
  ` : '';

  if (factor > 1 && !isInverse) {
    const fullUnits = Math.floor(stock);
    const rem = stock - fullUnits;
    const remainingSacks = Math.round(rem * factor);
    const totalSacks = Math.round(stock * factor);
    const stockBreakdown = remainingSacks > 0
      ? `${fullUnits} ${mainUnit} and ${remainingSacks} ${secUnit}`
      : `${fullUnits} ${mainUnit}`;

    previewBox.innerHTML = `
      ${inverseWarningHTML}
      <div style="background:var(--c-surface);border:1px solid var(--c-primary);border-radius:var(--radius-sm);padding:var(--space-2) var(--space-3);font-size:var(--fs-xs);color:var(--c-text);box-shadow:var(--shadow-sm)">
        <div style="font-weight:700;color:var(--c-primary);margin-bottom:6px">
          💡 Live POS & Stock Preview:
        </div>
        <div style="display:grid;grid-template-columns:1fr;gap:4px;line-height:1.4">
          <div>• <strong>Bulk Sale:</strong> 1 ${esc(mainUnit)} = <strong>₱${mainPrice > 0 ? mainPrice.toLocaleString('en-PH', {minimumFractionDigits: 2}) : '0.00'}</strong> (deducts 1.0 ${esc(mainUnit)} from stock)</div>
          <div>• <strong>Tingi Sale:</strong> 1 ${esc(secUnit)} = <strong>₱${secPrice > 0 ? secPrice.toLocaleString('en-PH', {minimumFractionDigits: 2}) : '0.00'}</strong> (deducts 1/${factor} ${esc(mainUnit)} from stock)</div>
          <div>• <strong>Current Inventory (${stock} ${esc(mainUnit)}):</strong> Equals <strong>${stockBreakdown}</strong> (or total ~${totalSacks} ${esc(secUnit)})</div>
        </div>
      </div>
    `;
  } else {
    previewBox.innerHTML = `
      ${inverseWarningHTML}
      <div style="background:var(--c-surface);border:1px dashed var(--c-border);border-radius:var(--radius-sm);padding:var(--space-2) var(--space-3);font-size:var(--fs-xs);color:var(--c-text-muted)">
        ℹ️ Enter how many <strong>${esc(secUnit)}</strong> are in 1 <strong>${esc(mainUnit)}</strong> (e.g. 26 sacks per 1 cubic) to see live calculation preview.
      </div>
    `;
  }
}

function renderMaterialRow(m: Material): string {
  const isLow = m.stock <= m.reorder_point;
  const profit = m.price_per_unit - (m.cost_price || 0);
  const margin = m.price_per_unit > 0 ? (profit / m.price_per_unit * 100) : 0;
  return `<tr class="material-row ${isLow ? 'low-stock' : ''}" data-material-row="${m.id}">
    <td data-label="Name" style="font-weight:600">${esc(m.name)}</td>
    <td class="material-secondary" data-label="Category"><span style="font-size:var(--fs-xs);color:var(--c-text-muted)">${esc(m.category || '-')}</span></td>
    <td class="material-secondary" data-label="Unit">${esc(m.unit)}${m.has_secondary_unit && m.secondary_unit ? ` <span style="font-size:11px;color:var(--c-primary)">(${esc(m.secondary_unit)})</span>` : ''}</td>
    <td data-label="Stock">${renderStockDisplay(m)}</td>
    <td class="material-secondary" data-label="Cost">${fmtPeso(m.cost_price || 0)}</td>
    <td data-label="Retail">${renderPriceDisplay(m)}</td>
    <td class="material-secondary" data-label="Profit" style="color:${profit > 0 ? 'var(--c-success)' : profit < 0 ? 'var(--c-danger)' : 'var(--c-text-muted)'}">${fmtPeso(profit)}</td>
    <td class="material-secondary" data-label="Margin" style="color:${margin > 0 ? 'var(--c-success)' : margin < 0 ? 'var(--c-danger)' : 'var(--c-text-muted)'}">${margin.toFixed(1)}%</td>
    <td data-label="" class="actions">
      <button class="btn btn-sm mobile-details-btn" onclick="toggleMobileDetails('${m.id}')">Details</button>
      <button class="btn btn-primary btn-sm" onclick="editMaterial('${m.id}')">Edit</button>
      <button class="btn btn-sm" onclick="showStockHistory('${m.id}')">History</button>
      <button class="btn btn-danger btn-sm" onclick="delMaterial('${m.id}')">Delete</button>
    </td>
  </tr>`;
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
  if (Array.isArray(catalog.category)) MAT_CATEGORIES = ['', ...catalog.category];
  if (Array.isArray(catalog.unit)) UNIT_OPTIONS = catalog.unit;
  (window as any).__materialSuppliers = suppliers;
  const materials = Array.isArray(response) ? response : response.data;
  const totalMaterials = Array.isArray(response) ? response.length : response.total;
  (window as any).__materialNames = Object.fromEntries(materials.map((m: Material) => [m.id, m.name]));
  return `
    <div class="page-header">
      <h2>Products</h2>
      <div class="material-toolbar" style="display:flex;gap:var(--space-3);align-items:center;flex-wrap:wrap">
        <input id="mat-search" type="search" placeholder="Search materials..." value="${esc(materialSearch)}" oninput="filterMaterials(true)" onkeydown="if(event.key==='Enter')filterMaterials(false)" style="min-height:36px;min-width:220px;background:var(--c-surface-elevated);color:var(--c-text);border:1px solid var(--c-border);border-radius:var(--radius-md);padding:0 var(--space-3);font-size:var(--fs-sm)" />
        <select id="mat-cat-filter" onchange="filterMaterials(false)" style="min-height:36px;background:var(--c-surface-elevated);color:var(--c-text);border:1px solid var(--c-border);border-radius:var(--radius-md);padding:0 var(--space-3);font-size:var(--fs-sm)">
          ${catOptions(materialCategory)}
        </select>
        ${isAdmin() ? `<button class="btn btn-sm" onclick="openCategoriesManager('category')" title="Manage categories in Settings">Manage Categories</button>` : ''}
        <button class="btn btn-primary" onclick="showMaterialModal()">+ Add Product</button>
      </div>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Name</th><th>Category</th><th>Unit</th><th>Stock</th><th>Cost</th><th>Retail</th><th>Profit</th><th>Margin</th><th class="actions">Actions</th></tr></thead>
        <tbody>
          ${materials.length ? materials.map(renderMaterialRow).join('') : '<tr><td colspan="9" style="text-align:center;color:var(--c-text-muted);padding:2rem">No materials yet</td></tr>'}
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

export function changeMaterialPage(page: number) { materialPage = Math.max(1, page); executeFilterMaterials(); }

export function showMaterialModal(data?: Material) {
  const isEdit = !!data;
  const suppliers: Supplier[] = (window as any).__materialSuppliers || [];
  showModal(`
    <h3>${isEdit ? 'Edit' : 'Add'} Product</h3>
    <div class="form-row">
      <div class="form-group"><label>Name *</label><input id="mf-name" maxlength="100" value="${esc(data?.name || '')}" /><div class="field-error" id="mf-name-err"></div></div>
      <div class="form-group"><label>Category</label>
        <div class="catalog-field">
          <select id="mf-category">${catOptions(data?.category || '', '- None / Select Category -')}</select>
          <button type="button" class="btn btn-sm" onclick="addProductCatalogOption('category')">+ Add</button>
          ${isAdmin() ? `<button type="button" class="btn btn-sm" onclick="closeModal();openCategoriesManager('category')" title="Manage categories in Settings">Manage</button>` : ''}
        </div>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group"><label id="mf-unit-label">Main / Stock Unit *</label>
        <div class="catalog-field">
          <select id="mf-unit" onchange="toggleCustomUnit(); updateDualUnitPreview()"><option value="">Select unit...</option>${unitOptions(data?.unit)}</select>
          <button type="button" class="btn btn-sm" onclick="addProductCatalogOption('unit')">+ Add</button>
          ${isAdmin() ? `<button type="button" class="btn btn-sm" onclick="closeModal();openCategoriesManager('unit')" title="Manage units in Settings">Manage</button>` : ''}
        </div>
        <input id="mf-custom-unit" maxlength="30" value="${data?.unit && !UNIT_OPTIONS.includes(data.unit) ? esc(data.unit) : ''}" placeholder="e.g. Bundle, Sheet, Truckload" oninput="updateDualUnitPreview()" style="margin-top:6px;display:${data?.unit && !UNIT_OPTIONS.includes(data.unit) ? '' : 'none'}" />
        <div class="helper" style="font-size:var(--fs-xs);color:var(--c-text-muted);margin-top:2px">The bulk unit you count stock in (e.g. Cubic, Box, Roll)</div>
        <div class="field-error" id="mf-unit-err"></div>
      </div>
      <div class="form-group"><label id="mf-stock-label">Stock Quantity</label><input id="mf-stock" type="number" step="any" min="0" value="${data?.stock ?? 0}" oninput="updateDualUnitPreview()" /><div class="field-error" id="mf-stock-err"></div></div>
    </div>
    <div class="form-group"><label>Supplier (optional)</label><select id="mf-supplier"><option value="">No supplier selected</option>${suppliers.map(s => `<option value="${s.id}"${s.id === (data as any)?.supplier_id ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
    <div class="form-row">
      <div class="form-group"><label id="mf-cost-label">Cost Price (per main unit)</label><input id="mf-cost" type="number" step="0.01" min="0" value="${data?.cost_price ?? ''}" placeholder="0.00" oninput="updateDualUnitPreview()" /><div class="field-error" id="mf-cost-err"></div></div>
      <div class="form-group"><label id="mf-price-label">Retail Price (per main unit) *</label><input id="mf-price" type="number" step="0.01" min="0.01" value="${data?.price_per_unit ?? ''}" oninput="updateDualUnitPreview()" /><div class="field-error" id="mf-price-err"></div></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Wholesale Price</label><input id="mf-wprice" type="number" step="0.01" min="0" value="${data?.wholesale_price ? data.wholesale_price.toString() : ''}" placeholder="0.00 = same as retail" /><div class="helper" style="font-size:var(--fs-xs);color:var(--c-text-muted);margin-top:var(--space-1)">Leave 0 to use retail price</div></div>
      <div class="form-group"><label>Minimum Stock / Reorder Level</label><input id="mf-reorder" type="number" step="any" min="0" value="${data?.reorder_point ?? 10}" /><div class="field-error" id="mf-reorder-err"></div></div>
    </div>
    <div style="background:var(--c-surface-elevated);border:1px solid var(--c-border);border-radius:var(--radius-md);padding:var(--space-3);margin-top:var(--space-2);margin-bottom:var(--space-3)">
      <div style="display:flex;align-items:center;gap:var(--space-2);cursor:pointer">
        <input type="checkbox" id="mf-has-dual-unit" ${data?.has_secondary_unit ? 'checked' : ''} onchange="toggleDualUnitFields()" style="width:18px;height:18px;cursor:pointer" />
        <label for="mf-has-dual-unit" style="font-weight:600;cursor:pointer;margin:0">Enable Smaller / Tingi Unit (e.g. Sacks, Pieces, Packs)</label>
      </div>
      <p class="modal-help" style="margin:4px 0 0 26px;font-size:var(--fs-xs);color:var(--c-text-muted)">
        For bulk materials like Sand, Gravel, and Gravita. Allows selling either in bulk (per cubic) or tingi (per sack) from one shared stock pool.
      </p>
      <div id="mf-dual-unit-container" style="display:${data?.has_secondary_unit ? 'block' : 'none'};margin-top:var(--space-3);padding-top:var(--space-3);border-top:1px dashed var(--c-border)">
        <div class="form-row">
          <div class="form-group">
            <label>Smaller / Tingi Unit Name *</label>
            <input id="mf-secondary-unit" maxlength="30" value="${esc(data?.secondary_unit || 'Sack')}" placeholder="e.g. Sack" oninput="updateDualUnitPreview()" />
            <div class="helper" style="font-size:var(--fs-xs);color:var(--c-text-muted);margin-top:2px">e.g. Sack, Piece, Pack</div>
            <div class="field-error" id="mf-secondary-unit-err"></div>
          </div>
          <div class="form-group">
            <label id="mf-conversion-label">How many [sacks] in 1 [unit]? *</label>
            <input id="mf-conversion-factor" type="number" step="any" min="1.0001" value="${data?.conversion_factor || 26}" placeholder="e.g. 26" oninput="updateDualUnitPreview()" />
            <div class="helper" id="mf-conversion-helper" style="font-size:var(--fs-xs);color:var(--c-text-muted);margin-top:2px">e.g. 26 sacks per 1 cubic</div>
            <div class="field-error" id="mf-conversion-factor-err"></div>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label id="mf-secondary-price-label">Retail Price per [sack] (₱) *</label>
            <input id="mf-secondary-price" type="number" step="0.01" min="0.01" value="${data?.secondary_price ?? ''}" placeholder="e.g. 65.00" oninput="updateDualUnitPreview()" />
            <div class="helper" id="mf-secondary-price-helper" style="font-size:var(--fs-xs);color:var(--c-text-muted);margin-top:2px">Selling price in POS when customer buys per sack</div>
            <div class="field-error" id="mf-secondary-price-err"></div>
          </div>
        </div>
        <div id="mf-dual-unit-preview" style="margin-top:var(--space-2)"></div>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="mf-save-btn" onclick="${isEdit ? `updateMaterial('${data!.id}')` : 'createMaterial()'}">Save</button>
    </div>
  `, 'material-modal');
  const modal = document.getElementById('material-modal');
  const actions = modal?.querySelector('.modal-actions');
  if (modal && actions && !document.getElementById('mf-barcode')) actions.insertAdjacentHTML('beforebegin', '<div class="form-group"><label>Barcode / SKU <span>(optional)</span></label><div class="barcode-entry"><input id="mf-barcode" maxlength="100" value="' + esc(data?.barcode || '') + '" placeholder="Scan or type product barcode" /><button type="button" class="btn btn-sm" onclick="startMaterialBarcodeCamera()">Scan</button></div><div class="helper">Use a USB/Bluetooth scanner, phone camera, or type it manually.</div></div>');
  setTimeout(() => updateDualUnitPreview(), 0);
}

export async function startMaterialBarcodeCamera() {
  await startBarcodeCameraScan((code) => { const input = document.getElementById('mf-barcode') as HTMLInputElement | null; if (input) { input.value = code; input.focus(); showToast('Barcode captured. Save the product to keep it.'); } });
}

export async function createMaterial() {
  ['mf-name','mf-unit','mf-price','mf-cost','mf-stock','mf-reorder','mf-secondary-unit','mf-conversion-factor','mf-secondary-price'].forEach(id => clearErr(id + '-err'));
  const name = val('mf-name').trim(); const selectedUnit = val('mf-unit'); const unit = selectedUnit === '__custom__' ? val('mf-custom-unit').trim() : selectedUnit;
  const price = parseFloat(val('mf-price')); const cost = parseFloat(val('mf-cost'));
  const wpriceRaw = parseFloat(val('mf-wprice')); const wprice = isNaN(wpriceRaw) ? 0 : wpriceRaw;
  const stockRaw = val('mf-stock'); const reorderRaw = val('mf-reorder');
  const stock = parseFloat(stockRaw) || 0; const reorder = parseFloat(reorderRaw) || 0;
  const category = val('mf-category'); const supplier_id = val('mf-supplier') || null; const barcode = val('mf-barcode').trim();
  const hasDualUnit = (document.getElementById('mf-has-dual-unit') as HTMLInputElement)?.checked ? 1 : 0;
  const secondaryUnit = val('mf-secondary-unit').trim();
  const conversionFactorRaw = parseFloat(val('mf-conversion-factor'));
  const conversionFactor = isNaN(conversionFactorRaw) || conversionFactorRaw <= 0 ? 1 : conversionFactorRaw;
  const secondaryPriceRaw = parseFloat(val('mf-secondary-price'));
  const secondaryPrice = isNaN(secondaryPriceRaw) || secondaryPriceRaw < 0 ? 0 : secondaryPriceRaw;

  if (!name) { setErr('mf-name-err', 'Name is required'); return; }
  if (name.length < 2) { setErr('mf-name-err', 'Must be at least 2 characters'); return; }
  if (!unit) { setErr('mf-unit-err', 'Unit is required'); return; }
  if (stockRaw && (isNaN(parseFloat(stockRaw)) || parseFloat(stockRaw) < 0)) { setErr('mf-stock-err', 'Must be a number ≥ 0'); return; }
  if (reorderRaw && (isNaN(parseFloat(reorderRaw)) || parseFloat(reorderRaw) < 0)) { setErr('mf-reorder-err', 'Must be a number ≥ 0'); return; }
  if (isNaN(cost) || cost < 0) { setErr('mf-cost-err', 'Must be 0 or more'); return; }
  if (isNaN(price) || price <= 0) { setErr('mf-price-err', 'Must be > 0'); return; }

  if (hasDualUnit) {
    if (!secondaryUnit) { setErr('mf-secondary-unit-err', 'Please enter a smaller unit name (e.g. sack)'); return; }
    if (unit.toLowerCase() === secondaryUnit.toLowerCase()) { setErr('mf-secondary-unit-err', 'Smaller unit name must be different from the main unit'); return; }
    if (conversionFactor <= 1) { setErr('mf-conversion-factor-err', 'Conversion must be greater than 1 (e.g. 26 sacks per cubic)'); return; }
    if (secondaryPrice <= 0) { setErr('mf-secondary-price-err', 'Please enter a retail price for the smaller unit'); return; }
  }

  disableBtn('mf-save-btn', true);
  try {
    await apiPost('/materials', {
      name, unit, stock, cost_price: cost, price_per_unit: price, wholesale_price: wprice, reorder_point: reorder, category, supplier_id, barcode: barcode || null,
      has_secondary_unit: hasDualUnit,
      secondary_unit: hasDualUnit ? secondaryUnit : null,
      conversion_factor: hasDualUnit ? conversionFactor : 1,
      secondary_price: hasDualUnit ? secondaryPrice : 0
    });
    closeModal(); loadView('materials');
  } catch (e: any) { showToast(e.message); }
  finally { disableBtn('mf-save-btn', false); }
}

export async function updateMaterial(id: string) {
  ['mf-name','mf-unit','mf-price','mf-cost','mf-stock','mf-reorder','mf-secondary-unit','mf-conversion-factor','mf-secondary-price'].forEach(i => clearErr(i + '-err'));
  const name = val('mf-name').trim(); const selectedUnit = val('mf-unit'); const unit = selectedUnit === '__custom__' ? val('mf-custom-unit').trim() : selectedUnit;
  const price = parseFloat(val('mf-price')); const cost = parseFloat(val('mf-cost'));
  const wpriceRaw = parseFloat(val('mf-wprice')); const wprice = isNaN(wpriceRaw) ? 0 : wpriceRaw;
  const stockRaw = val('mf-stock'); const reorderRaw = val('mf-reorder');
  const stock = parseFloat(stockRaw) || 0; const reorder = parseFloat(reorderRaw) || 0;
  const category = val('mf-category'); const supplier_id = val('mf-supplier') || null; const barcode = val('mf-barcode').trim();
  const hasDualUnit = (document.getElementById('mf-has-dual-unit') as HTMLInputElement)?.checked ? 1 : 0;
  const secondaryUnit = val('mf-secondary-unit').trim();
  const conversionFactorRaw = parseFloat(val('mf-conversion-factor'));
  const conversionFactor = isNaN(conversionFactorRaw) || conversionFactorRaw <= 0 ? 1 : conversionFactorRaw;
  const secondaryPriceRaw = parseFloat(val('mf-secondary-price'));
  const secondaryPrice = isNaN(secondaryPriceRaw) || secondaryPriceRaw < 0 ? 0 : secondaryPriceRaw;

  if (!name) { setErr('mf-name-err', 'Name is required'); return; }
  if (name.length < 2) { setErr('mf-name-err', 'Must be at least 2 characters'); return; }
  if (!unit) { setErr('mf-unit-err', 'Unit is required'); return; }
  if (stockRaw && (isNaN(parseFloat(stockRaw)) || parseFloat(stockRaw) < 0)) { setErr('mf-stock-err', 'Must be a number ≥ 0'); return; }
  if (reorderRaw && (isNaN(parseFloat(reorderRaw)) || parseFloat(reorderRaw) < 0)) { setErr('mf-reorder-err', 'Must be a number ≥ 0'); return; }
  if (isNaN(cost) || cost < 0) { setErr('mf-cost-err', 'Must be 0 or more'); return; }
  if (isNaN(price) || price <= 0) { setErr('mf-price-err', 'Must be > 0'); return; }

  if (hasDualUnit) {
    if (!secondaryUnit) { setErr('mf-secondary-unit-err', 'Please enter a smaller unit name (e.g. sack)'); return; }
    if (unit.toLowerCase() === secondaryUnit.toLowerCase()) { setErr('mf-secondary-unit-err', 'Smaller unit name must be different from the main unit'); return; }
    if (conversionFactor <= 1) { setErr('mf-conversion-factor-err', 'Conversion must be greater than 1 (e.g. 26 sacks per cubic)'); return; }
    if (secondaryPrice <= 0) { setErr('mf-secondary-price-err', 'Please enter a retail price for the smaller unit'); return; }
  }

  disableBtn('mf-save-btn', true);
  try {
    await apiPut(`/materials/${id}`, {
      name, unit, stock, cost_price: cost, price_per_unit: price, wholesale_price: wprice, reorder_point: reorder, category, supplier_id, barcode: barcode || null,
      has_secondary_unit: hasDualUnit,
      secondary_unit: hasDualUnit ? secondaryUnit : null,
      conversion_factor: hasDualUnit ? conversionFactor : 1,
      secondary_price: hasDualUnit ? secondaryPrice : 0
    });
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

let filterTimer: any = null;
let materialRequestSeq = 0;

export function filterMaterials(debounce = false) {
  clearTimeout(filterTimer);
  if (debounce) {
    filterTimer = setTimeout(() => {
      materialPage = 1;
      executeFilterMaterials();
    }, 250);
  } else {
    materialPage = 1;
    executeFilterMaterials();
  }
}

async function executeFilterMaterials() {
  const reqSeq = ++materialRequestSeq;
  const cat = (document.getElementById('mat-cat-filter') as HTMLSelectElement)?.value ?? materialCategory;
  const search = (document.getElementById('mat-search') as HTMLInputElement)?.value.trim() ?? materialSearch;
  materialCategory = cat;
  materialSearch = search;
  const params = new URLSearchParams({ page: String(materialPage), pageSize: String(MATERIAL_PAGE_SIZE) });
  if (cat) params.set('category', cat);
  if (search) params.set('search', search);

  const tbody = document.querySelector('table tbody') as HTMLElement | null;
  if (tbody) tbody.style.opacity = '0.5';

  try {
    const response = await apiGet<Material[] | { data: Material[]; total: number }>(`/materials?${params}`);
    if (reqSeq !== materialRequestSeq) return;

    const materials = Array.isArray(response) ? response : response.data;
    const totalMaterials = Array.isArray(response) ? response.length : response.total;
    (window as any).__materialNames = Object.fromEntries(materials.map((m: Material) => [m.id, m.name]));

    if (tbody) {
      tbody.style.opacity = '1';
      tbody.innerHTML = materials.length ? materials.map(renderMaterialRow).join('') : '<tr><td colspan="9" style="text-align:center;color:var(--c-text-muted);padding:2rem">No materials found</td></tr>';
    }
    const pager = document.getElementById('materials-pagination');
    if (pager) pager.innerHTML = totalMaterials > MATERIAL_PAGE_SIZE ? paginationMarkup(totalMaterials) : '';
  } catch (err: any) {
    if (reqSeq !== materialRequestSeq) return;
    if (tbody) tbody.style.opacity = '1';
    showToast(err.message || 'Failed to filter materials');
  }
}

export function toggleMobileDetails(id: string) {
  document.querySelector(`[data-material-row="${id}"]`)?.classList.toggle('expanded');
}
