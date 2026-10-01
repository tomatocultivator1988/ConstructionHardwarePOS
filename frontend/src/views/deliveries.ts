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
  return `<div class="report-tabs delivery-status-tabs" role="tablist" aria-label="Delivery status">
    <button class="nav-btn ${deliveryStatus === 'all' ? 'active' : ''}" onclick="setDeliveryStatus('all')">All <span>${Number(result.total || 0)}</span></button>
    <button class="nav-btn ${deliveryStatus === 'unassigned' ? 'active' : ''}" onclick="setDeliveryStatus('unassigned')">Needs Assignment <span>${summary.unassigned || 0}</span></button>
    <button class="nav-btn ${deliveryStatus === 'assigned' ? 'active' : ''}" onclick="setDeliveryStatus('assigned')">Assigned <span>${summary.assigned || 0}</span></button>
    <button class="nav-btn ${deliveryStatus === 'out_for_delivery' ? 'active' : ''}" onclick="setDeliveryStatus('out_for_delivery')">Out for Delivery <span>${summary.out_for_delivery || 0}</span></button>
    <button class="nav-btn ${deliveryStatus === 'delivered' ? 'active' : ''}" onclick="setDeliveryStatus('delivered')">Delivered <span>${summary.delivered || 0}</span></button>
    <button class="nav-btn ${deliveryStatus === 'failed' ? 'active' : ''}" onclick="setDeliveryStatus('failed')">Failed <span>${summary.failed || 0}</span></button>
  </div>`;
}

function renderAssignments(result: any): string {
  const rows = result.data || [];
  const summary = result.summary || { assigned: 0, out_for_delivery: 0, delivered: 0, failed: 0, unassigned: 0 };
  return `
    <div class="dashboard-grid report-metrics report-metrics-5">
      <div class="dashboard-card card-warning clickable" onclick="setDeliveryStatus('unassigned')" title="Click to filter Needs Assignment">
        <div class="card-label">Needs assignment</div>
        <div class="card-value">${summary.unassigned || 0}</div>
        <div class="card-sub">Pending driver assignment</div>
      </div>
      <div class="dashboard-card card-info clickable" onclick="setDeliveryStatus('assigned')" title="Click to filter Assigned">
        <div class="card-label">Assigned</div>
        <div class="card-value">${summary.assigned || 0}</div>
        <div class="card-sub">Driver assigned, ready</div>
      </div>
      <div class="dashboard-card card-purple clickable" onclick="setDeliveryStatus('out_for_delivery')" title="Click to filter Out for Delivery">
        <div class="card-label">Out for Delivery</div>
        <div class="card-value">${summary.out_for_delivery || 0}</div>
        <div class="card-sub">In transit / On the road</div>
      </div>
      <div class="dashboard-card card-success clickable" onclick="setDeliveryStatus('delivered')" title="Click to filter Delivered">
        <div class="card-label">Delivered</div>
        <div class="card-value">${summary.delivered || 0}</div>
        <div class="card-sub">Completed deliveries</div>
      </div>
      <div class="dashboard-card card-danger clickable" onclick="setDeliveryStatus('failed')" title="Click to filter Failed">
        <div class="card-label">Failed</div>
        <div class="card-value">${summary.failed || 0}</div>
        <div class="card-sub">Failed / needs retry</div>
      </div>
    </div>

    <div class="dashboard-card deliveries-toolbar">
      <input id="deliveries-search" type="search" placeholder="Search invoice or buyer..." value="${esc(deliverySearch)}" onkeydown="if(event.key==='Enter')filterDeliveries()" />
      <button class="btn btn-primary" onclick="filterDeliveries()">Search</button>
      ${renderStatusTabs(result, summary)}
    </div>

    <div class="dashboard-card deliveries-card">
      <div class="section-heading">
        <div>
          <h3>Delivery assignments</h3>
          <p class="card-sub">Assign a delivery person after sale, dispatch when on the road, and mark completed once received by the buyer.</p>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Invoice</th>
              <th>Buyer</th>
              <th>Sale Date</th>
              <th>Current Total</th>
              <th>Invoice Status</th>
              <th>Delivery Status</th>
              <th>Delivery Person</th>
              <th class="actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${rows.length ? rows.map((row: any) => {
              let deliveryStatusLabel = 'Needs Assignment';
              let deliveryStatusClass = 'unassigned';
              if (row.delivery_status === 'delivered') {
                deliveryStatusLabel = `Delivered${row.delivered_at ? ` · ${fmtDate(row.delivered_at)}` : ''}`;
                deliveryStatusClass = 'paid';
              } else if (row.delivery_status === 'out_for_delivery') {
                deliveryStatusLabel = 'Out for Delivery 🚚';
                deliveryStatusClass = 'out_for_delivery';
              } else if (row.delivery_status === 'assigned') {
                deliveryStatusLabel = 'Assigned';
                deliveryStatusClass = 'assigned';
              } else if (row.delivery_status === 'failed') {
                deliveryStatusLabel = 'Failed ❌';
                deliveryStatusClass = 'failed';
              }

              let actionButtons = '';
              if (row.delivery_status === 'assigned') {
                actionButtons = `
                  <button class="btn btn-primary btn-sm" onclick="dispatchDelivery('${row.id}')" title="Dispatch Out for Delivery">Out for Delivery 🚚</button>
                  <button class="btn btn-sm" onclick="showDeliveryModal('${row.id}')">Edit</button>
                `;
              } else if (row.delivery_status === 'out_for_delivery') {
                actionButtons = `
                  <button class="btn btn-success btn-sm" onclick="markDeliveryDelivered('${row.id}')" title="Mark as Delivered">Delivered ✅</button>
                  <button class="btn btn-danger btn-sm" onclick="failDelivery('${row.id}')" title="Mark as Failed">Failed ❌</button>
                  <button class="btn btn-sm" onclick="showDeliveryModal('${row.id}')">Edit</button>
                `;
              } else if (row.delivery_status === 'failed') {
                actionButtons = `
                  <button class="btn btn-warning btn-sm" onclick="retryDelivery('${row.id}')" title="Reset for Retry">Retry 🔄</button>
                  <button class="btn btn-sm" onclick="showDeliveryModal('${row.id}')">Edit</button>
                `;
              } else if (row.delivery_status === 'delivered') {
                actionButtons = `
                  <button class="btn btn-sm" onclick="showDeliveryModal('${row.id}')">Edit</button>
                `;
              } else {
                actionButtons = `
                  <button class="btn btn-warning btn-sm" onclick="showDeliveryModal('${row.id}')">Assign Driver</button>
                `;
              }

              return `
                <tr>
                  <td data-label="Invoice" style="font-weight:600">${esc(row.invoice_number)}</td>
                  <td data-label="Buyer">
                    ${esc(row.customer_name)}
                    ${row.buyer_address ? `<div style="font-size:var(--fs-xs);color:var(--c-text-muted);max-width:180px;white-space:normal;line-height:1.2;margin-top:2px;">${esc(row.buyer_address)}</div>` : ''}
                  </td>
                  <td data-label="Sale Date">${fmtDate(row.issued_date)}</td>
                  <td data-label="Current Total" class="money">${fmtPeso(row.adjusted_total ?? row.total)}</td>
                  <td data-label="Invoice Status"><span class="status-badge ${row.status}">${esc(row.status)}</span></td>
                  <td data-label="Delivery Status">
                    <span class="status-badge ${deliveryStatusClass}">${esc(deliveryStatusLabel)}</span>
                    ${row.delivery_notes ? `<div style="font-size:var(--fs-xs);color:${row.delivery_status === 'failed' ? 'var(--c-danger)' : 'var(--c-text-muted)'};max-width:180px;white-space:normal;line-height:1.2;margin-top:3px;">${esc(row.delivery_notes)}</div>` : ''}
                  </td>
                  <td data-label="Delivery Person"><strong>${esc(row.delivery_person || 'Not assigned')}</strong></td>
                  <td data-label="" class="actions">
                    ${actionButtons}
                    <button class="btn btn-sm" onclick="showInvoiceDetail('${row.id}')">View Sale</button>
                  </td>
                </tr>
              `;
            }).join('') : '<tr><td colspan="8" class="empty-state">No sales match this delivery filter.</td></tr>'}
          </tbody>
        </table>
      </div>
      ${result.total > PAGE_SIZE ? `
        <div class="pagination">
          <span>Showing ${(deliveryPage - 1) * PAGE_SIZE + 1}–${Math.min(deliveryPage * PAGE_SIZE, result.total)} of ${result.total}</span>
          <button class="btn btn-sm" ${deliveryPage === 1 ? 'disabled' : ''} onclick="changeDeliveryPage(${deliveryPage - 1})">Previous</button>
          <strong>Page ${deliveryPage} of ${result.totalPages}</strong>
          <button class="btn btn-sm" ${deliveryPage >= result.totalPages ? 'disabled' : ''} onclick="changeDeliveryPage(${deliveryPage + 1})">Next</button>
        </div>
      ` : ''}
    </div>
  `;
}

function renderPersonnel(people: any[]): string {
  return `
    <div class="dashboard-card delivery-people-card">
      <div class="section-heading">
        <div>
          <h3>Delivery personnel</h3>
          <p class="card-sub">Register delivery boys here before assigning them to a sale.</p>
        </div>
        <button class="btn btn-primary" onclick="showDeliveryPersonModal()">+ Add delivery boy</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Phone</th>
              <th>Status</th>
              <th class="actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${people.length ? people.map((person: any) => `
              <tr>
                <td data-label="Name"><strong>${esc(person.name)}</strong></td>
                <td data-label="Phone">${esc(person.phone || '—')}</td>
                <td data-label="Status"><span class="status-badge ${person.active ? 'paid' : 'pending'}">${person.active ? 'Active' : 'Inactive'}</span></td>
                <td data-label="" class="actions">
                  <button class="btn btn-sm" onclick="showDeliveryPersonModal('${person.id}')">Edit</button>
                  <button class="btn btn-sm" onclick="toggleDeliveryPerson('${person.id}', ${person.active ? 'false' : 'true'})">${person.active ? 'Deactivate' : 'Activate'}</button>
                </td>
              </tr>
            `).join('') : '<tr><td colspan="4" class="empty-state">No delivery personnel registered yet.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

export async function renderDeliveries(): Promise<string> {
  const [result, personnel] = await Promise.all([fetchDeliveryResult(), apiGet<any[]>('/delivery-personnel')]);
  return `
    <div class="page-header">
      <div>
        <h2>Deliveries</h2>
        <p class="page-subtitle">Assign, dispatch, and track order deliveries.</p>
      </div>
    </div>
    <div class="po-subtabs delivery-subtabs" role="tablist" aria-label="Delivery sections">
      <button class="nav-btn ${deliverySection === 'assignments' ? 'active' : ''}" onclick="switchDeliverySection('assignments')">Assignments</button>
      <button class="nav-btn ${deliverySection === 'personnel' ? 'active' : ''}" onclick="switchDeliverySection('personnel')">Delivery Personnel</button>
    </div>
    <div id="delivery-section-content">
      ${deliverySection === 'personnel' ? renderPersonnel(personnel || []) : renderAssignments(result)}
    </div>
  `;
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

export function filterDeliveries() {
  deliverySearch = (document.getElementById('deliveries-search') as HTMLInputElement)?.value.trim() || '';
  deliveryPage = 1;
  refreshDeliveryAssignments();
}

export function setDeliveryStatus(status: string) {
  deliveryStatus = ['all', 'assigned', 'unassigned', 'out_for_delivery', 'delivered', 'failed'].includes(status) ? status : 'all';
  deliveryPage = 1;
  refreshDeliveryAssignments();
}

export function openDeliveriesWithStatus(status: string) {
  deliveryStatus = ['all', 'assigned', 'unassigned', 'out_for_delivery', 'delivered', 'failed'].includes(status) ? status : 'all';
  deliveryPage = 1;
  deliverySection = 'assignments';
  loadView('deliveries');
}

export function changeDeliveryPage(page: number) {
  deliveryPage = Math.max(1, page);
  refreshDeliveryAssignments();
}

export async function dispatchDelivery(invoiceId: string) {
  if (!window.confirm('Dispatch this delivery as Out for Delivery 🚚?')) return;
  try {
    await apiPost(`/invoices/${invoiceId}/delivery/dispatch`, {});
    showToast('Delivery marked as Out for Delivery 🚚', 'success');
    refreshDeliveryAssignments();
  } catch (e: any) {
    showToast(e.message || 'Unable to dispatch delivery');
  }
}

export async function markDeliveryDelivered(invoiceId: string) {
  if (!window.confirm('Mark this sale as delivered?')) return;
  try {
    await apiPost(`/invoices/${invoiceId}/delivery/complete`, {});
    showToast('Delivery marked as completed ✅', 'success');
    refreshDeliveryAssignments();
  } catch (e: any) {
    showToast(e.message || 'Unable to mark delivery as delivered');
  }
}

export async function failDelivery(invoiceId: string) {
  const reason = window.prompt('Enter reason for delivery failure (optional):', 'Customer unreachable / wrong address');
  if (reason === null) return;
  try {
    await apiPost(`/invoices/${invoiceId}/delivery/fail`, { reason: reason.trim() });
    showToast('Delivery marked as failed ❌', 'warning');
    refreshDeliveryAssignments();
  } catch (e: any) {
    showToast(e.message || 'Unable to mark delivery as failed');
  }
}

export async function retryDelivery(invoiceId: string) {
  if (!window.confirm('Reset this delivery for retry?')) return;
  try {
    await apiPost(`/invoices/${invoiceId}/delivery/retry`, {});
    showToast('Delivery reset for retry 🔄', 'success');
    refreshDeliveryAssignments();
  } catch (e: any) {
    showToast(e.message || 'Unable to reset delivery');
  }
}

export async function showDeliveryPersonModal(id = '') {
  let person: any = null;
  if (id) person = (await apiGet<any[]>('/delivery-personnel')).find(row => row.id === id);
  showModal(`
    <h3>${id ? 'Edit Delivery Boy' : 'Add Delivery Boy'}</h3>
    <p class="modal-help">Only registered active personnel can be assigned to deliveries.</p>
    <div class="form-group">
      <label for="delivery-person-name">Name *</label>
      <input id="delivery-person-name" maxlength="120" value="${esc(person?.name || '')}" placeholder="Enter full name" />
    </div>
    <div class="form-group">
      <label for="delivery-person-phone">Phone <span>(optional)</span></label>
      <input id="delivery-person-phone" maxlength="40" value="${esc(person?.phone || '')}" placeholder="09..." />
    </div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveDeliveryPersonRecord('${id}')">Save</button>
    </div>
  `, 'delivery-person-modal');
}

export async function saveDeliveryPersonRecord(id = '') {
  const name = (document.getElementById('delivery-person-name') as HTMLInputElement)?.value.trim() || '';
  const phone = (document.getElementById('delivery-person-phone') as HTMLInputElement)?.value.trim() || null;
  try {
    if (id) await apiPut(`/delivery-personnel/${id}`, { name, phone });
    else await apiPost('/delivery-personnel', { name, phone });
    closeModal();
    showToast(id ? 'Delivery personnel updated' : 'Delivery boy registered', 'success');
    switchDeliverySection('personnel');
  } catch (e: any) {
    showToast(e.message || 'Unable to save delivery personnel');
  }
}

export async function toggleDeliveryPerson(id: string, active: boolean) {
  try {
    await apiPut(`/delivery-personnel/${id}`, { active });
    showToast(active ? 'Delivery boy activated' : 'Delivery boy deactivated', 'success');
    switchDeliverySection('personnel');
  } catch (e: any) {
    showToast(e.message || 'Unable to update delivery personnel');
  }
}
