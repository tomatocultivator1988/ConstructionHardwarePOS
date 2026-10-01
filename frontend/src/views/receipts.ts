import { apiGet } from '../lib/api';
import { esc, fmtDate, fmtPeso, isAdmin } from '../lib/helpers';
import { loadView } from '../lib/router';
import { printReceipt, showReceiptPreview } from './receipt';
import { showInvoiceDetail, delInvoice, showReturnModal, showDeliveryModal, exportSalesHistory } from './invoices';

let salesPage = 1;
const PAGE_SIZE = 15;
let salesMop = 'all';
let salesStatus = 'all';
let salesSearch = '';
let salesFrom = '';
let salesTo = '';

export function formatMop(method: string): string {
  const m = (method || '').toLowerCase().trim();
  if (m === 'cash') return 'Cash';
  if (m === 'gcash' || m.includes('gcash')) return 'G-Cash';
  if (m === 'check' || m.includes('check')) return 'Check';
  if (m === 'bank' || m.includes('bank') || m.includes('transfer')) return 'Bank Transfer';
  if (m === 'credit' || m.includes('credit')) return 'Credit';
  if (m === 'card') return 'Card';
  return method ? method.toUpperCase() : 'Cash';
}

async function fetchSalesData() {
  const q = new URLSearchParams({
    page: String(salesPage),
    pageSize: String(PAGE_SIZE),
  });
  if (salesSearch) q.set('search', salesSearch);
  if (salesMop && salesMop !== 'all') q.set('mop', salesMop);
  if (salesStatus && salesStatus !== 'all') q.set('status', salesStatus);
  if (salesFrom) q.set('from', salesFrom);
  if (salesTo) q.set('to', salesTo);

  let result = await apiGet<any>(`/invoices?${q}`);
  const totalPages = Math.max(1, Number(result.totalPages || 1));
  if (salesPage > totalPages) {
    salesPage = totalPages;
    q.set('page', String(salesPage));
    result = await apiGet<any>(`/invoices?${q}`);
  }
  return result;
}

export async function renderReceipts(): Promise<string> {
  const result = await fetchSalesData();
  const rows = result.data || [];
  const total = Number(result.total || 0);

  return `
    <div class="page-header">
      <div>
        <div class="page-kicker">Sales</div>
        <h2>Sales History</h2>
        <p class="page-subtitle">Track and review sales transactions, filter by payment method, print receipts, and process returns.</p>
      </div>
      <div style="display:flex;gap:var(--space-2);align-items:center;flex-wrap:wrap">
        <button class="btn btn-outline" onclick="exportSalesHistory()">Export Sales</button>
        <button class="btn btn-primary" onclick="loadView('invoices')">+ New POS Sale</button>
      </div>
    </div>

    <div class="dashboard-card sales-toolbar" style="margin-bottom:var(--space-4)">
      <div style="display:flex;gap:var(--space-3);align-items:center;flex-wrap:wrap;margin-bottom:var(--space-3)">
        <div style="flex:2;min-width:220px;display:flex;gap:var(--space-2)">
          <input id="sales-search" type="search" placeholder="Search receipt # or customer name..." value="${esc(salesSearch)}" onkeydown="if(event.key==='Enter')filterSales()" />
          <button class="btn btn-primary" onclick="filterSales()">Search</button>
        </div>
        <div style="flex:2;min-width:280px;display:flex;gap:var(--space-2);align-items:center;flex-wrap:wrap">
          <label style="font-size:var(--fs-xs);color:var(--c-text-muted)">From</label>
          <input id="sales-from" type="date" value="${esc(salesFrom)}" style="min-width:125px" />
          <label style="font-size:var(--fs-xs);color:var(--c-text-muted)">To</label>
          <input id="sales-to" type="date" value="${esc(salesTo)}" style="min-width:125px" />
          <select id="sales-status-select" onchange="setSalesStatus(this.value)" style="min-width:110px">
            <option value="all" ${salesStatus === 'all' ? 'selected' : ''}>Status: All</option>
            <option value="paid" ${salesStatus === 'paid' ? 'selected' : ''}>Paid</option>
            <option value="unpaid" ${salesStatus === 'unpaid' ? 'selected' : ''}>Unpaid</option>
            <option value="partial" ${salesStatus === 'partial' ? 'selected' : ''}>Partial</option>
            <option value="returned" ${salesStatus === 'returned' ? 'selected' : ''}>Returned</option>
            <option value="voided" ${salesStatus === 'voided' ? 'selected' : ''}>Voided</option>
          </select>
          <button class="btn btn-sm btn-outline" onclick="filterSales()">Filter</button>
          ${(salesSearch || salesFrom || salesTo || salesMop !== 'all' || salesStatus !== 'all') ? `<button class="btn btn-sm" onclick="clearSalesFilter()">Reset</button>` : ''}
        </div>
      </div>

      <div class="report-tabs delivery-status-tabs" role="tablist" aria-label="Mode of payment">
        <button class="nav-btn ${salesMop === 'all' ? 'active' : ''}" onclick="setSalesMop('all')">ALL</button>
        <button class="nav-btn ${salesMop === 'cash' ? 'active' : ''}" onclick="setSalesMop('cash')">CASH</button>
        <button class="nav-btn ${salesMop === 'check' ? 'active' : ''}" onclick="setSalesMop('check')">CHECK</button>
        <button class="nav-btn ${salesMop === 'gcash' ? 'active' : ''}" onclick="setSalesMop('gcash')">G-CASH</button>
        <button class="nav-btn ${salesMop === 'bank' ? 'active' : ''}" onclick="setSalesMop('bank')">Bank Transfer</button>
        <button class="nav-btn ${salesMop === 'credit' ? 'active' : ''}" onclick="setSalesMop('credit')">Credit</button>
      </div>
    </div>

    <div class="dashboard-card sales-card">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Receipt No.</th>
              <th>Customer</th>
              <th>Date</th>
              <th>MOP</th>
              <th>Amount</th>
              <th>Status</th>
              <th class="actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${rows.length ? rows.map((inv: any) => {
              const currentTotal = Number(inv.adjusted_total ?? inv.total ?? 0);
              const mopLabel = formatMop(inv.payment_method);
              const deliveryAssigned = Boolean(inv.delivery_person);

              return `
                <tr>
                  <td data-label="Receipt No." style="font-weight:600">
                    ${esc(inv.invoice_number)}
                  </td>
                  <td data-label="Customer">
                    <strong>${esc(inv.customer_name)}</strong>
                    ${inv.buyer_address ? `<div style="font-size:var(--fs-xs);color:var(--c-text-muted);max-width:200px;white-space:normal;line-height:1.2;margin-top:2px">${esc(inv.buyer_address)}</div>` : ''}
                  </td>
                  <td data-label="Date">${fmtDate(inv.issued_date)}</td>
                  <td data-label="MOP">
                    <span class="status-badge" style="background:var(--c-surface-variant,#e2e8f0);color:var(--c-text);font-weight:600">${esc(mopLabel)}</span>
                    ${deliveryAssigned ? `<div style="font-size:var(--fs-xs);color:var(--c-text-muted);margin-top:2px" title="Delivery: ${esc(inv.delivery_person)}">🚚 ${esc(inv.delivery_person)}</div>` : ''}
                  </td>
                  <td data-label="Amount" class="money" style="font-weight:600">${fmtPeso(currentTotal)}</td>
                  <td data-label="Status">
                    <span class="status-badge ${inv.status}">${esc(inv.status)}</span>
                  </td>
                  <td data-label="Actions" class="actions" style="display:flex;gap:4px;flex-wrap:wrap">
                    <button class="btn btn-primary btn-sm" onclick="showInvoiceDetail('${inv.id}')" title="View details">VIEW</button>
                    <button class="btn btn-sm" onclick="printReceipt('${inv.id}')" title="Print receipt">PRINT</button>
                    ${isAdmin() && inv.status !== 'voided' ? `<button class="btn btn-warning btn-sm" onclick="showReturnModal('${inv.id}', 'sales')" title="Process Refund / Return">REFUND</button>` : ''}
                    ${isAdmin() ? `<button class="btn btn-danger btn-sm" onclick="delInvoice('${inv.id}')" title="Delete Sale">DELETE</button>` : ''}
                  </td>
                </tr>
              `;
            }).join('') : '<tr><td colspan="7" class="empty-state">No sales match the selected filters.</td></tr>'}
          </tbody>
        </table>
      </div>

      ${total > PAGE_SIZE ? `
        <div class="pagination">
          <span>Showing ${(salesPage - 1) * PAGE_SIZE + 1}–${Math.min(salesPage * PAGE_SIZE, total)} of ${total}</span>
          <button class="btn btn-sm" ${salesPage === 1 ? 'disabled' : ''} onclick="changeSalesPage(${salesPage - 1})">Previous</button>
          <strong>Page ${salesPage} of ${result.totalPages}</strong>
          <button class="btn btn-sm" ${salesPage >= result.totalPages ? 'disabled' : ''} onclick="changeSalesPage(${salesPage + 1})">Next</button>
        </div>
      ` : ''}
    </div>
  `;
}

export function filterSales() {
  salesSearch = (document.getElementById('sales-search') as HTMLInputElement)?.value.trim() || '';
  salesFrom = (document.getElementById('sales-from') as HTMLInputElement)?.value || '';
  salesTo = (document.getElementById('sales-to') as HTMLInputElement)?.value || '';
  salesStatus = (document.getElementById('sales-status-select') as HTMLSelectElement)?.value || salesStatus;
  salesPage = 1;
  loadView('sales');
}

export function clearSalesFilter() {
  salesSearch = '';
  salesFrom = '';
  salesTo = '';
  salesMop = 'all';
  salesStatus = 'all';
  salesPage = 1;
  loadView('sales');
}

export function setSalesMop(mop: string) {
  salesMop = mop;
  salesPage = 1;
  loadView('sales');
}

export function setSalesStatus(status: string) {
  salesStatus = status;
  salesPage = 1;
  loadView('sales');
}

export function loadSalesWithMop(mop: string) {
  salesMop = mop;
  salesPage = 1;
  salesSearch = '';
  salesFrom = '';
  salesTo = '';
  salesStatus = 'all';
  loadView('sales');
}

export function loadSalesWithFilter(filter: string) {
  if (['credit', 'cash', 'check', 'gcash', 'bank'].includes(filter.toLowerCase())) {
    salesMop = filter.toLowerCase();
    salesStatus = 'all';
  } else if (filter === 'unpaid') {
    salesMop = 'credit';
    salesStatus = 'all';
  } else {
    salesStatus = filter;
    salesMop = 'all';
  }
  salesPage = 1;
  salesSearch = '';
  salesFrom = '';
  salesTo = '';
  loadView('sales');
}

export function changeSalesPage(next: number) {
  salesPage = Math.max(1, next);
  loadView('sales');
}

export async function viewReceipt(id: string) {
  showReceiptPreview(id);
}

// Aliases for backward compatibility
export const filterReceipts = filterSales;
export const changeReceiptPage = changeSalesPage;
export const renderSales = renderReceipts;
