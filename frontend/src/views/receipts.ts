import { apiGet } from '../lib/api';
import { esc, fmtDate, fmtPeso, isAdmin } from '../lib/helpers';
import { loadView } from '../lib/router';
import { printReceipt, showReceiptPreview } from './receipt';
import { showInvoiceDetail, delInvoice, showReturnModal, showDeliveryModal, exportSalesHistory } from './invoices';

let salesPage = 1;
const PAGE_SIZE = 15;
let salesStatus = 'all';
let salesSearch = '';
let salesFrom = '';
let salesTo = '';

async function fetchSalesData() {
  const q = new URLSearchParams({
    page: String(salesPage),
    pageSize: String(PAGE_SIZE),
  });
  if (salesSearch) q.set('search', salesSearch);
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
        <div class="page-kicker">Transaction Hub</div>
        <h2>Sales</h2>
        <p class="page-subtitle">View sales history, print receipts, and manage deliveries or returns.</p>
      </div>
      <div style="display:flex;gap:var(--space-2);align-items:center;flex-wrap:wrap">
        <button class="btn btn-outline" onclick="exportSalesHistory()">Export Sales</button>
        <button class="btn btn-primary" onclick="loadView('invoices')">+ New POS Sale</button>
      </div>
    </div>

    <div class="dashboard-card sales-toolbar" style="margin-bottom:var(--space-4)">
      <div style="display:flex;gap:var(--space-3);align-items:center;flex-wrap:wrap;margin-bottom:var(--space-3)">
        <div style="flex:2;min-width:220px;display:flex;gap:var(--space-2)">
          <input id="sales-search" type="search" placeholder="Search invoice # or buyer name..." value="${esc(salesSearch)}" onkeydown="if(event.key==='Enter')filterSales()" />
          <button class="btn btn-primary" onclick="filterSales()">Search</button>
        </div>
        <div style="flex:2;min-width:280px;display:flex;gap:var(--space-2);align-items:center">
          <label style="font-size:var(--fs-xs);color:var(--c-text-muted)">From</label>
          <input id="sales-from" type="date" value="${esc(salesFrom)}" style="min-width:125px" />
          <label style="font-size:var(--fs-xs);color:var(--c-text-muted)">To</label>
          <input id="sales-to" type="date" value="${esc(salesTo)}" style="min-width:125px" />
          <button class="btn btn-sm btn-outline" onclick="filterSales()">Filter</button>
          ${(salesSearch || salesFrom || salesTo || salesStatus !== 'all') ? `<button class="btn btn-sm" onclick="clearSalesFilter()">Reset</button>` : ''}
        </div>
      </div>

      <div class="report-tabs delivery-status-tabs" role="tablist" aria-label="Sales status">
        <button class="nav-btn ${salesStatus === 'all' ? 'active' : ''}" onclick="setSalesStatus('all')">All Sales</button>
        <button class="nav-btn ${salesStatus === 'paid' ? 'active' : ''}" onclick="setSalesStatus('paid')">Paid</button>
        <button class="nav-btn ${salesStatus === 'unpaid' ? 'active' : ''}" onclick="setSalesStatus('unpaid')">Credit / Unpaid</button>
        <button class="nav-btn ${salesStatus === 'partial' ? 'active' : ''}" onclick="setSalesStatus('partial')">Partial</button>
        <button class="nav-btn ${salesStatus === 'returned' ? 'active' : ''}" onclick="setSalesStatus('returned')">Returned</button>
        <button class="nav-btn ${salesStatus === 'voided' ? 'active' : ''}" onclick="setSalesStatus('voided')">Voided</button>
      </div>
    </div>

    <div class="dashboard-card sales-card">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Invoice #</th>
              <th>Buyer</th>
              <th>Date</th>
              <th>Total</th>
              <th>Payment</th>
              <th>Status</th>
              <th>Delivery</th>
              <th class="actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${rows.length ? rows.map((inv: any) => {
              const currentTotal = Number(inv.adjusted_total ?? inv.total ?? 0);
              const netPaid = Number(inv.net_paid ?? 0);
              const balance = Math.max(0, currentTotal - netPaid);

              let paymentDisplay = '';
              if (inv.status === 'voided') {
                paymentDisplay = '<span style="color:var(--c-text-muted)">Voided</span>';
              } else if (inv.status === 'paid' || balance <= 0.005) {
                paymentDisplay = `<span style="color:var(--c-success);font-weight:600">Paid (${fmtPeso(netPaid)})</span>`;
              } else if (netPaid > 0) {
                paymentDisplay = `<span style="color:var(--c-warning);font-weight:600">Bal: ${fmtPeso(balance)}</span>`;
              } else {
                paymentDisplay = `<span style="color:var(--c-danger);font-weight:600">Unpaid (${fmtPeso(currentTotal)})</span>`;
              }

              const deliveryText = inv.delivery_person || 'Not assigned';

              return `
                <tr>
                  <td data-label="Invoice #" style="font-weight:600">
                    ${esc(inv.invoice_number)}
                  </td>
                  <td data-label="Buyer">
                    <strong>${esc(inv.customer_name)}</strong>
                    ${inv.buyer_address ? `<div style="font-size:var(--fs-xs);color:var(--c-text-muted);max-width:180px;white-space:normal;line-height:1.2;margin-top:2px">${esc(inv.buyer_address)}</div>` : ''}
                  </td>
                  <td data-label="Date">${fmtDate(inv.issued_date)}</td>
                  <td data-label="Total" class="money" style="font-weight:600">${fmtPeso(currentTotal)}</td>
                  <td data-label="Payment">${paymentDisplay}</td>
                  <td data-label="Status"><span class="status-badge ${inv.status}">${esc(inv.status)}</span></td>
                  <td data-label="Delivery">
                    <span class="delivery-value" style="font-size:var(--fs-sm)">${esc(deliveryText)}</span>
                    <button class="btn btn-sm delivery-edit-btn" onclick="showDeliveryModal('${inv.id}')" title="Assign / Edit delivery">${inv.delivery_person ? 'Edit' : 'Assign'}</button>
                  </td>
                  <td data-label="" class="actions">
                    <button class="btn btn-primary btn-sm" onclick="showInvoiceDetail('${inv.id}')" title="View Sale Details">View</button>
                    <button class="btn btn-sm" onclick="viewReceipt('${inv.id}')" title="Receipt Preview">Receipt</button>
                    <button class="btn btn-sm" onclick="printReceipt('${inv.id}')" title="Direct Bluetooth Print">Print 🖨️</button>
                    ${isAdmin() && inv.status !== 'voided' ? `<button class="btn btn-warning btn-sm" onclick="showReturnModal('${inv.id}', 'sales')" title="Process Return">Return</button>` : ''}
                    ${isAdmin() ? `<button class="btn btn-danger btn-sm" onclick="delInvoice('${inv.id}')" title="Delete Sale">Delete</button>` : ''}
                  </td>
                </tr>
              `;
            }).join('') : '<tr><td colspan="8" class="empty-state">No sales match the selected filters.</td></tr>'}
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
  salesPage = 1;
  loadView('sales');
}

export function clearSalesFilter() {
  salesSearch = '';
  salesFrom = '';
  salesTo = '';
  salesStatus = 'all';
  salesPage = 1;
  loadView('sales');
}

export function setSalesStatus(status: string) {
  salesStatus = status;
  salesPage = 1;
  loadView('sales');
}

export function loadSalesWithFilter(status: string) {
  salesStatus = status;
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
