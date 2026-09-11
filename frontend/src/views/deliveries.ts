import { apiGet, apiPost, apiPut } from '../lib/api';
import { esc, fmtDate, fmtPeso, showModal, closeModal, showToast } from '../lib/helpers';
import { loadView } from '../lib/router';

let deliveryPage = 1;
let deliveryStatus = 'all';
let deliverySearch = '';
let deliverySection = 'assignments';
const PAGE_SIZE = 15;

async function fetchDeliveryResult() {
  let result = await apiGet<any>(`/invoices/deliveries?page=${deliveryPage}&pageSize=${PAGE_SIZE}&status=${deliveryStatus}&search=${encodeURIComponent(deliverySearch)}`);
  const totalPages = Math.max(1, Number(result.totalPages || 1));
  if (deliveryPage > totalPages) {
    deliveryPage = totalPages;
    result = await apiGet<any>(`/invoices/deliveries?page=${deliveryPage}&pageSize=${PAGE_SIZE}&status=${deliveryStatus}&search=${encodeURIComponent(deliverySearch)}`);
  }
  return result;
}

function renderStatusTabs(result: any, summary: any): string {
  return `<div class="report-tabs delivery-status-tabs" role="tablist" aria-label="Delivery status"><button class="nav-btn ${deliveryStatus === 'all' ? 'active' : ''}" onclick="setDeliveryStatus('all')">All <span>${Number(result.total || 0)}</span></button><button class="nav-btn ${deliveryStatus === 'unassigned' ? 'active' : ''}" onclick="setDeliveryStatus('unassigned')">Needs Assignment <span>${summary.unassigned}</span></button><button class="nav-btn ${deliveryStatus === 'assigned' ? 'active' : ''}" onclick="setDeliveryStatus('assigned')">Assigned <span>${summary.assigned}</span></button><button class="nav-btn ${deliveryStatus === 'delivered' ? 'active' : ''}" onclick="setDeliveryStatus('delivered')">Delivered <span>${summary.delivered}</span></button></div>`;
}

function renderAssignments(result: any): string {
  const rows = result.data || [];
  const summary = result.summary || { assigned: 0, delivered: 0, unassigned: 0 };
  return `<div class="dashboard-grid report-metrics report-metrics-4"><div class="dashboard-card card-info"><div class="card-label">Assigned deliveries</div><div class="card-value">${summary.assigned}</div><div class="card-sub">Waiting for delivery</div></div><div class="dashboard-card card-success"><div class="card-label">Delivered</div><div class="card-value">${summary.delivered}</div><div class="card-sub">Completed deliveries</div></div><div class="dashboard-card card-warning"><div class="card-label">Needs assignment</div><div class="card-value">${summary.unassigned}</div><div class="card-sub">Sales without a delivery person</div></div><div class="dashboard-card card-info"><div class="card-label">Showing</div><div class="card-value">${rows.length}</div><div class="card-sub">On this page</div></div></div>
    <div class="dashboard-card deliveries-toolbar"><input id="deliveries-search" type="search" placeholder="Search invoice or buyer..." value="${esc(deliverySearch)}" onkeydown="if(event.key==='Enter')filterDeliveries()" /><button class="btn btn-primary" onclick="filterDeliveries()">Search</button>${renderStatusTabs(result, summary)}</div>
    <div class="dashboard-card deliveries-card"><div class="section-heading"><div><h3>Delivery assignments</h3><p class="card-sub">Assign a delivery person after the sale when delivery details are confirmed. Mark it delivered only after the order reaches the buyer.</p></div></div><div class="table-wrap"><table><thead><tr><th>Invoice</th><th>Buyer</th><th>Sale Date</th><th>Current Total</th><th>Invoice Status</th><th>Delivery Status</th><th>Delivery Person</th><th class="actions">Actions</th></tr></thead><tbody>${rows.length ? rows.map((row: any) => { const deliveryStatusLabel = row.delivery_status === 'delivered' ? `Delivered${row.delivered_at ? ` · ${fmtDate(row.delivered_at)}` : ''}` : row.delivery_status === 'assigned' ? 'Assigned' : 'Not assigned'; const deliveryStatusClass = row.delivery_status === 'delivered' ? 'paid' : row.delivery_status === 'assigned' ? 'pending' : 'voided'; return `<tr><td data-label="Invoice" style="font-weight:600">${esc(row.invoice_number)}</td><td data-label="Buyer">${esc(row.customer_name)}</td><td data-label="Sale Date">${fmtDate(row.issued_date)}</td><td data-label="Current Total" class="money">${fmtPeso(row.adjusted_total ?? row.total)}</td><td data-label="Invoice Status"><span class="status-badge ${row.status}">${esc(row.status)}</span></td><td data-label="Delivery Status"><span class="status-badge ${deliveryStatusClass}">${esc(deliveryStatusLabel)}</span></td><td data-label="Delivery Person"><strong>${esc(row.delivery_person || 'Not assigned')}</strong></td><td data-label="" class="actions">${row.delivery_status === 'assigned' && row.delivery_person_id ? `<button class="btn btn-primary btn-sm" onclick="markDeliveryDelivered('${row.id}')">Mark as Delivered</button>` : ''}<button class="btn btn-success btn-sm" onclick="showDeliveryModal('${row.id}')">${row.delivery_person ? 'Edit' : 'Assign'}</button><button class="btn btn-sm" onclick="showInvoiceDetail('${row.id}')">View Sale</button></td></tr>`; }).join('') : '<tr><td colspan="8" class="empty-state">No sales match this delivery filter.</td></tr>'}</tbody></table></div>${result.total > PAGE_SIZE ? `<div class="pagination"><span>Showing ${(deliveryPage - 1) * PAGE_SIZE + 1}–${Math.min(deliveryPage * PAGE_SIZE, result.total)} of ${result.total}</span><button class="btn btn-sm" ${deliveryPage === 1 ? 'disabled' : ''} onclick="changeDeliveryPage(${deliveryPage - 1})">Previous</button><strong>Page ${deliveryPage} of ${result.totalPages}</strong><button class="btn btn-sm" ${deliveryPage >= result.totalPages ? 'disabled' : ''} onclick="changeDeliveryPage(${deliveryPage + 1})">Next</button></div>` : ''}</div>`;
}

function renderPersonnel(people: any[]): string {
  return `<div class="dashboard-card delivery-people-card"><div class="section-heading"><div><h3>Delivery personnel</h3><p class="card-sub">Register delivery boys here before assigning them to a sale.</p></div><button class="btn btn-primary" onclick="showDeliveryPersonModal()">+ Add delivery boy</button></div><div class="table-wrap"><table><thead><tr><th>Name</th><th>Phone</th><th>Status</th><th class="actions">Actions</th></tr></thead><tbody>${people.length ? people.map((person: any) => `<tr><td data-label="Name"><strong>${esc(person.name)}</strong></td><td data-label="Phone">${esc(person.phone || '—')}</td><td data-label="Status"><span class="status-badge ${person.active ? 'paid' : 'pending'}">${person.active ? 'Active' : 'Inactive'}</span></td><td data-label="" class="actions"><button class="btn btn-sm" onclick="showDeliveryPersonModal('${person.id}')">Edit</button><button class="btn btn-sm" onclick="toggleDeliveryPerson('${person.id}', ${person.active ? 'false' : 'true'})">${person.active ? 'Deactivate' : 'Activate'}</button></td></tr>`).join('') : '<tr><td colspan="4" class="empty-state">No delivery personnel registered yet.</td></tr>'}</tbody></table></div></div>`;
}

export async function renderDeliveries(): Promise<string> {
  const [result, personnel] = await Promise.all([fetchDeliveryResult(), apiGet<any[]>('/delivery-personnel')]);
  return `<div class="page-header"><div><h2>Deliveries</h2><p class="page-subtitle">Assign and manage delivery persons for sales.</p></div></div><div class="po-subtabs delivery-subtabs" role="tablist" aria-label="Delivery sections"><button class="nav-btn ${deliverySection === 'assignments' ? 'active' : ''}" onclick="switchDeliverySection('assignments')">Assignments</button><button class="nav-btn ${deliverySection === 'personnel' ? 'active' : ''}" onclick="switchDeliverySection('personnel')">Delivery Personnel</button></div><div id="delivery-section-content">${deliverySection === 'personnel' ? renderPersonnel(personnel || []) : renderAssignments(result)}</div>`;
}

async function refreshDeliveryAssignments() {
  const content = document.getElementById('delivery-section-content');
  if (!content) { loadView('deliveries'); return; }
  content.innerHTML = '<div class="loading-skeleton">' + '<div class="sk-item"></div>'.repeat(4) + '</div>';
  try { content.innerHTML = renderAssignments(await fetchDeliveryResult()); }
  catch (e: any) { content.innerHTML = `<div class="empty-state view-error"><h3>Unable to load deliveries</h3><p>${esc(e.message || 'Please try again.')}</p></div>`; }
}

export async function switchDeliverySection(section: string) {
  deliverySection = section === 'personnel' ? 'personnel' : 'assignments';
  const content = document.getElementById('delivery-section-content');
  if (!content) { loadView('deliveries'); return; }
  document.querySelectorAll('.delivery-subtabs .nav-btn').forEach(btn => btn.classList.toggle('active', (btn as HTMLElement).textContent?.trim() === (deliverySection === 'personnel' ? 'Delivery Personnel' : 'Assignments')));
  content.innerHTML = '<div class="loading-skeleton">' + '<div class="sk-item"></div>'.repeat(3) + '</div>';
  try { content.innerHTML = deliverySection === 'personnel' ? renderPersonnel(await apiGet<any[]>('/delivery-personnel')) : renderAssignments(await fetchDeliveryResult()); }
  catch (e: any) { content.innerHTML = `<div class="empty-state view-error"><h3>Unable to load deliveries</h3><p>${esc(e.message || 'Please try again.')}</p></div>`; }
}

export function filterDeliveries() { deliverySearch = (document.getElementById('deliveries-search') as HTMLInputElement)?.value.trim() || ''; deliveryPage = 1; refreshDeliveryAssignments(); }
export function setDeliveryStatus(status: string) { deliveryStatus = ['all', 'assigned', 'unassigned', 'delivered'].includes(status) ? status : 'all'; deliveryPage = 1; refreshDeliveryAssignments(); }
export function changeDeliveryPage(page: number) { deliveryPage = Math.max(1, page); refreshDeliveryAssignments(); }

export async function markDeliveryDelivered(invoiceId: string) {
  if (!window.confirm('Mark this sale as delivered?')) return;
  try { await apiPost(`/invoices/${invoiceId}/delivery/complete`, {}); showToast('Delivery marked as delivered', 'success'); refreshDeliveryAssignments(); }
  catch (e: any) { showToast(e.message || 'Unable to mark delivery as delivered'); }
}

export async function showDeliveryPersonModal(id = '') {
  let person: any = null;
  if (id) person = (await apiGet<any[]>('/delivery-personnel')).find(row => row.id === id);
  showModal(`<h3>${id ? 'Edit Delivery Boy' : 'Add Delivery Boy'}</h3><p class="modal-help">Only registered active personnel can be assigned to deliveries.</p><div class="form-group"><label for="delivery-person-name">Name *</label><input id="delivery-person-name" maxlength="120" value="${esc(person?.name || '')}" placeholder="Enter full name" /></div><div class="form-group"><label for="delivery-person-phone">Phone <span>(optional)</span></label><input id="delivery-person-phone" maxlength="40" value="${esc(person?.phone || '')}" placeholder="09..." /></div><div class="modal-actions"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveDeliveryPersonRecord('${id}')">Save</button></div>`, 'delivery-person-modal');
}

export async function saveDeliveryPersonRecord(id = '') {
  const name = (document.getElementById('delivery-person-name') as HTMLInputElement)?.value.trim() || '';
  const phone = (document.getElementById('delivery-person-phone') as HTMLInputElement)?.value.trim() || null;
  try { if (id) await apiPut(`/delivery-personnel/${id}`, { name, phone }); else await apiPost('/delivery-personnel', { name, phone }); closeModal(); showToast(id ? 'Delivery personnel updated' : 'Delivery boy registered', 'success'); switchDeliverySection('personnel'); }
  catch (e: any) { showToast(e.message || 'Unable to save delivery personnel'); }
}

export async function toggleDeliveryPerson(id: string, active: boolean) {
  try { await apiPut(`/delivery-personnel/${id}`, { active }); showToast(active ? 'Delivery boy activated' : 'Delivery boy deactivated', 'success'); switchDeliverySection('personnel'); }
  catch (e: any) { showToast(e.message || 'Unable to update delivery personnel'); }
}
