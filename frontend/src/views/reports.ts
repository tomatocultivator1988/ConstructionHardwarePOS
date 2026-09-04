import { apiGet } from '../lib/api';
import { esc, fmtDate, fmtPeso, businessDate, businessMonth } from '../lib/helpers';
import { showToast } from '../lib/helpers';

let currentSubTab = 'daily';

export async function renderReports(): Promise<string> {
  return `
    <div class="page-header">
      <h2>Reports</h2>
    </div>
    <div class="report-tabs" role="tablist" aria-label="Report types">
      <button class="nav-btn ${currentSubTab === 'daily' ? 'active' : ''}" onclick="switchReportTab('daily')" style="font-size:var(--fs-sm)">Daily Sales</button>
      <button class="nav-btn ${currentSubTab === 'monthly' ? 'active' : ''}" onclick="switchReportTab('monthly')" style="font-size:var(--fs-sm)">P&L</button>
      <button class="nav-btn ${currentSubTab === 'tax' ? 'active' : ''}" onclick="switchReportTab('tax')" style="font-size:var(--fs-sm)">Tax Summary</button>
      <button class="nav-btn ${currentSubTab === 'range' ? 'active' : ''}" onclick="switchReportTab('range')" style="font-size:var(--fs-sm)">Date Range</button>
      <button class="nav-btn ${currentSubTab === 'books' ? 'active' : ''}" onclick="switchReportTab('books')" style="font-size:var(--fs-sm)">Books</button>
      <button class="nav-btn ${currentSubTab === 'summary' ? 'active' : ''}" onclick="switchReportTab('summary')" style="font-size:var(--fs-sm)">Financial Summary</button>
    </div>
    <div id="report-content">
      ${await loadDailyReport()}
    </div>
  `;
}

export async function switchReportTab(tab: string) {
  currentSubTab = tab;
  const el = document.getElementById('report-content');
  if (!el) return;
  el.innerHTML = '<div class="loading-skeleton">${"<div class=\\"sk-item\\"></div>".repeat(4)}</div>';
  try {
    if (tab === 'daily') el.innerHTML = await loadDailyReport();
    else if (tab === 'monthly') el.innerHTML = await loadMonthlyReport();
    else if (tab === 'tax') el.innerHTML = await loadTaxReport();
    else if (tab === 'range') el.innerHTML = await loadRangeForm();
    else if (tab === 'books') el.innerHTML = await loadBooksReport();
    else if (tab === 'summary') el.innerHTML = await loadFinancialSummary();
    document.querySelectorAll('#report-content .nav-btn').forEach((b, i) => {
      b.classList.toggle('active', (['daily','monthly','tax','range','books','summary'][i] === tab));
    });
  } catch (e: any) { showToast(e.message); }
}

async function loadFinancialSummary(from?: string, to?: string) {
  const start = from || businessDate(); const end = to || start;
  const data = await apiGet<any>(`/reports/financial-summary?from=${start}&to=${end}`);
  const profitColor = data.net_profit >= 0 ? 'var(--c-success)' : 'var(--c-danger)';
  return `<div class="report-filters"><label>From</label><input id="rpt-summary-from" type="date" value="${start}" /><label>To</label><input id="rpt-summary-to" type="date" value="${end}" /><button class="btn btn-primary btn-sm" onclick="reloadFinancialSummary()">Load</button></div>
    <div class="dashboard-grid report-metrics report-metrics-4">
      <div class="dashboard-card card-success"><div class="card-label">Net Sales</div><div class="card-value">${fmtPeso(data.net_sales)}</div><div class="card-sub">Accrual basis</div></div>
      <div class="dashboard-card card-warning"><div class="card-label">COGS</div><div class="card-value">${fmtPeso(data.cogs)}</div></div>
      <div class="dashboard-card card-success"><div class="card-label">Gross Profit</div><div class="card-value">${fmtPeso(data.gross_profit)}</div></div>
      <div class="dashboard-card card-danger"><div class="card-label">Operating Expenses</div><div class="card-value">${fmtPeso(data.expenses)}</div></div>
    </div>
    <div class="chart-card" style="margin-top:var(--space-4);background:var(--c-surface);border:1px solid var(--c-border);border-radius:var(--radius-lg);padding:var(--space-5)">
      <div class="chart-title">Financial Reconciliation</div>
      <div class="summary-line"><span>Tax payable</span><b>${fmtPeso(data.tax_payable)}</b></div>
      <div class="summary-line"><span>Collections (payments less refunds)</span><b>${fmtPeso(data.collections - data.refunds)}</b></div>
      <div class="summary-line"><span>Accounts receivable</span><b>${fmtPeso(data.accounts_receivable)}</b></div>
      <div class="summary-line total"><span>Net Profit</span><b style="color:${profitColor}">${fmtPeso(data.net_profit)}</b></div>
    </div>`;
}

export async function reloadFinancialSummary() {
  const from = (document.getElementById('rpt-summary-from') as HTMLInputElement)?.value;
  const to = (document.getElementById('rpt-summary-to') as HTMLInputElement)?.value;
  const el = document.getElementById('report-content'); if (el) el.innerHTML = await loadFinancialSummary(from, to);
}

async function loadBooksReport(from?: string, to?: string) {
  const start = from || businessDate(); const end = to || start;
  const [data, cash] = await Promise.all([apiGet<any>(`/reports/books?from=${start}&to=${end}`), apiGet<any>(`/reports/cash-flow?from=${start}&to=${end}`)]);
  const rows = (items: any[], fields: string[]) => items.length ? items.map((r: any) => `<tr>${fields.map(f => `<td data-label="${esc(f)}">${esc(String(r[f] ?? ''))}</td>`).join('')}</tr>`).join('') : '<tr><td colspan="6">No entries</td></tr>';
  return `<div class="report-filters"><label>From</label><input id="rpt-books-from" type="date" value="${start}" /><label>To</label><input id="rpt-books-to" type="date" value="${end}" /><button class="btn btn-primary btn-sm" onclick="reloadBooks()">Load</button><button class="btn btn-primary btn-sm" onclick="printReport('books','${start} to ${end}')">Print</button></div>
    <h3>Sales Journal</h3><div class="table-wrap"><table><thead><tr><th>Invoice</th><th>Date</th><th>Buyer</th><th>Net Sales</th><th>Tax</th><th>Adjusted Total</th></tr></thead><tbody>${rows(data.sales,['invoice_number','issued_date','buyer','net_sales','adjusted_tax','adjusted_total'])}</tbody></table></div>
    <h3>Cash Receipts Journal</h3><div class="table-wrap"><table><thead><tr><th>Date</th><th>Invoice</th><th>Method</th><th>Amount</th></tr></thead><tbody>${rows(data.receipts,['payment_date','invoice_number','method','amount'])}</tbody></table></div>
    <h3>Expenses / Purchases</h3><div class="table-wrap"><table><thead><tr><th>Date</th><th>Category</th><th>Vendor</th><th>Payment</th><th>Description</th><th>Amount</th></tr></thead><tbody>${rows(data.expenses,['expense_date','category','vendor','payment_method','description','amount'])}</tbody></table></div>
    <h3>Accounts Receivable</h3><div class="table-wrap"><table><thead><tr><th>Invoice</th><th>Buyer</th><th>Total</th><th>Paid</th><th>Balance</th></tr></thead><tbody>${rows(data.receivables,['invoice_number','buyer','total','paid','balance'])}</tbody></table></div>
    <h3>Cash Flow Summary</h3><div class="summary-line"><span>Cash receipts</span><b>${fmtPeso(cash.cash_receipts)}</b></div><div class="summary-line"><span>Cash refunds</span><b>${fmtPeso(cash.cash_refunds)}</b></div><div class="summary-line"><span>Cash expenses</span><b>${fmtPeso(cash.cash_expenses)}</b></div><div class="summary-line total"><span>Net cash change</span><b>${fmtPeso(cash.net_cash_change)}</b></div>`;
}

export async function reloadBooks() {
  const from = (document.getElementById('rpt-books-from') as HTMLInputElement)?.value;
  const to = (document.getElementById('rpt-books-to') as HTMLInputElement)?.value;
  const el = document.getElementById('report-content'); if (el) el.innerHTML = await loadBooksReport(from, to);
}

async function loadDailyReport(date?: string) {
  const d = date || businessDate();
  const data = await apiGet<any>(`/reports/daily?date=${d}`);
  return `
    <div class="report-filters">
      <input type="date" id="rpt-daily-date" value="${d}" onchange="reloadDaily()" style="min-height:36px;background:var(--c-surface-elevated);color:var(--c-text);border:1px solid var(--c-border);border-radius:var(--radius-md);padding:0 var(--space-3);font-size:var(--fs-sm)" />
      <button class="btn btn-primary btn-sm" onclick="printReport('daily', '${d}')">Print</button>
    </div>
    <div class="dashboard-grid report-metrics report-metrics-4">
      <div class="dashboard-card card-success"><div class="card-label">Gross Sales</div><div class="card-value">${fmtPeso(data.totals.gross_sales)}</div></div>
      <div class="dashboard-card card-success"><div class="card-label">Profit</div><div class="card-value">${fmtPeso(data.totals.profit)}</div></div>
      <div class="dashboard-card card-info"><div class="card-label">Tax Collected</div><div class="card-value">${fmtPeso(data.totals.tax_collected)}</div></div>
      <div class="dashboard-card card-info"><div class="card-label">Invoices</div><div class="card-value" style="font-size:var(--fs-2xl)">${data.totals.invoice_count}</div></div>
    </div>
    ${data.paymentMethods?.length ? `
    <div class="report-payment-methods">
      <span style="font-weight:600;color:var(--c-text-muted);font-size:var(--fs-xs)">PAYMENT METHODS:</span>
      ${data.paymentMethods.map((m: any) => `<span style="font-size:var(--fs-sm)"><strong>${esc(m.method)}</strong> ${fmtPeso(m.total)}</span>`).join(' | ')}
    </div>` : ''}
    <div class="table-wrap">
      <table>
        <thead><tr><th>Invoice #</th><th>Customer</th><th>Total</th><th>Status</th><th>Paid</th></tr></thead>
        <tbody>
          ${data.invoices.length ? data.invoices.map((inv: any) => `
            <tr>
              <td data-label="Invoice #" style="font-weight:600">${esc(inv.invoice_number)}</td>
              <td data-label="Customer">${esc(inv.customer_name)}</td>
              <td data-label="Total" style="font-family:var(--ff-mono);font-weight:600">${fmtPeso(inv.total)}</td>
              <td data-label="Status"><span class="status-badge ${inv.status}">${inv.status}</span></td>
              <td data-label="Paid" style="font-family:var(--ff-mono);font-weight:600;color:var(--c-success)">${fmtPeso(inv.paid)}</td>
            </tr>
          `).join('') : '<tr><td colspan="5" style="text-align:center;color:var(--c-text-muted);padding:2rem">No transactions for this date</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

async function loadMonthlyReport(month?: string) {
  const m = month || businessMonth();
  const data = await apiGet<any>(`/reports/monthly?month=${m}`);
  const netColor = data.net_profit >= 0 ? 'var(--c-success)' : 'var(--c-danger)';
  const momColor = data.mom_change >= 0 ? 'var(--c-success)' : 'var(--c-danger)';
  return `
    <div class="report-filters">
      <input type="month" id="rpt-month" value="${m}" onchange="reloadMonthly()" style="min-height:36px;background:var(--c-surface-elevated);color:var(--c-text);border:1px solid var(--c-border);border-radius:var(--radius-md);padding:0 var(--space-3);font-size:var(--fs-sm)" />
      <button class="btn btn-primary btn-sm" onclick="printReport('monthly', '${m}')">Print</button>
    </div>
    <div class="dashboard-grid report-metrics report-metrics-5">
      <div class="dashboard-card card-success"><div class="card-label">Net Sales</div><div class="card-value">${fmtPeso(data.revenue)}</div><div class="card-sub">Accrual basis</div></div>
      <div class="dashboard-card card-warning"><div class="card-label">COGS</div><div class="card-value">${fmtPeso(data.cogs)}</div></div>
      <div class="dashboard-card card-success"><div class="card-label">Gross Profit</div><div class="card-value">${fmtPeso(data.gross_profit)}</div></div>
      <div class="dashboard-card card-danger"><div class="card-label">Expenses</div><div class="card-value">${fmtPeso(data.expenses)}</div></div>
      <div class="dashboard-card card-info"><div class="card-label">Net Profit</div><div class="card-value" style="color:${netColor}">${fmtPeso(data.net_profit)}</div><div class="card-sub">${data.mom_change >= 0 ? '↑' : '↓'} ${Math.abs(data.mom_change).toFixed(1)}% vs last month</div></div>
    </div>
    ${data.expense_by_category?.length ? `
    <div class="chart-card" style="margin-bottom:var(--space-4)">
      <div class="chart-title">Expenses by Category</div>
      <div style="display:flex;flex-direction:column;gap:var(--space-2);padding:var(--space-3) 0">
        ${data.expense_by_category.map((e: any) => {
          const pct = data.expenses > 0 ? (e.total / data.expenses * 100) : 0;
          return `<div class="tc-item">
            <span class="tc-name" style="width:140px">${esc(e.category)}</span>
            <span class="tc-bar-wrap"><span class="tc-bar" style="width:${Math.min(100, pct)}%;background:var(--c-danger)"></span></span>
            <span class="tc-amount">${fmtPeso(e.total)}</span>
          </div>`;
        }).join('')}
      </div>
    </div>` : ''}
    <div class="chart-card" style="background:var(--c-surface);border:1px solid var(--c-border);border-radius:var(--radius-lg);padding:var(--space-5)">
      <div class="chart-title">Summary</div>
      <div class="summary-line"><span>Net Sales (accrual)</span><span>${fmtPeso(data.revenue)}</span></div>
      <div class="summary-line"><span>Cost of Goods Sold</span><span>${fmtPeso(data.cogs)}</span></div>
      <div class="summary-line"><span>Gross Profit</span><span style="color:var(--c-success)">${fmtPeso(data.gross_profit)}</span></div>
      <div class="summary-line"><span>Operating Expenses</span><span style="color:var(--c-danger)">${fmtPeso(data.expenses)}</span></div>
      <div class="summary-line total"><span>Net Profit</span><span style="color:${netColor}">${fmtPeso(data.net_profit)}</span></div>
    </div>
  `;
}

async function loadTaxReport(month?: string) {
  const m = month || businessMonth();
  const data = await apiGet<any>(`/reports/tax?month=${m}`);
  return `
    <div class="report-filters">
      <input type="month" id="rpt-tax-month" value="${m}" onchange="reloadTax()" style="min-height:36px;background:var(--c-surface-elevated);color:var(--c-text);border:1px solid var(--c-border);border-radius:var(--radius-md);padding:0 var(--space-3);font-size:var(--fs-sm)" />
      <button class="btn btn-primary btn-sm" onclick="printReport('tax', '${m}')">Print</button>
    </div>
    <div class="dashboard-grid report-metrics report-metrics-4">
      <div class="dashboard-card card-info"><div class="card-label">Total Invoices</div><div class="card-value">${data.invoice_count}</div></div>
      <div class="dashboard-card card-success"><div class="card-label">VATable Sales</div><div class="card-value">${fmtPeso(data.vatable_sales)}</div></div>
      <div class="dashboard-card card-warning"><div class="card-label">VAT Collected</div><div class="card-value">${fmtPeso(data.vat_collected)}</div></div>
      <div class="dashboard-card card-info"><div class="card-label">Exempt Sales</div><div class="card-value">${fmtPeso(data.exempt_sales)}</div></div>
    </div>
    <div class="chart-card" style="background:var(--c-surface);border:1px solid var(--c-border);border-radius:var(--radius-lg);padding:var(--space-5)">
      <div class="chart-title">Tax Rate Breakdown</div>
      <table style="margin-top:var(--space-2)">
        <thead><tr><th>Tax Rate</th><th>Count</th><th>Taxable Amount</th><th>Tax</th></tr></thead>
        <tbody>
          ${data.by_rate?.length ? data.by_rate.map((r: any) => `
            <tr>
              <td data-label="Tax Rate" style="font-weight:600">${(r.tax_rate * 100).toFixed(0)}%</td>
              <td data-label="Count">${r.count}</td>
              <td data-label="Taxable Amount" style="font-family:var(--ff-mono)">${fmtPeso(r.subtotal)}</td>
              <td data-label="Tax" style="font-family:var(--ff-mono);font-weight:600">${fmtPeso(r.tax)}</td>
            </tr>
          `).join('') : '<tr><td colspan="4" style="text-align:center;color:var(--c-text-muted);padding:2rem">No data</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

async function loadRangeForm() {
  const from = businessDate();
  const to = businessDate();
  return `
    <div class="report-filters">
      <label style="font-size:var(--fs-sm);color:var(--c-text-secondary)">From</label>
      <input type="date" id="rpt-from" value="${from}" style="min-height:36px;background:var(--c-surface-elevated);color:var(--c-text);border:1px solid var(--c-border);border-radius:var(--radius-md);padding:0 var(--space-3);font-size:var(--fs-sm)" />
      <label style="font-size:var(--fs-sm);color:var(--c-text-secondary)">To</label>
      <input type="date" id="rpt-to" value="${to}" style="min-height:36px;background:var(--c-surface-elevated);color:var(--c-text);border:1px solid var(--c-border);border-radius:var(--radius-md);padding:0 var(--space-3);font-size:var(--fs-sm)" />
      <select id="rpt-type" style="min-height:36px;background:var(--c-surface-elevated);color:var(--c-text);border:1px solid var(--c-border);border-radius:var(--radius-md);padding:0 var(--space-3);font-size:var(--fs-sm)">
        <option value="sales">Sales</option>
        <option value="profit">Profit</option>
      </select>
      <button class="btn btn-primary" onclick="loadRangeReport()">Generate</button>
    </div>
    <div id="range-result"><p style="color:var(--c-text-muted);text-align:center;padding:2rem">Select a date range and click Generate</p></div>
  `;
}

export async function loadRangeReport() {
  const from = (document.getElementById('rpt-from') as HTMLInputElement)?.value || '';
  const to = (document.getElementById('rpt-to') as HTMLInputElement)?.value || '';
  const type = (document.getElementById('rpt-type') as HTMLSelectElement)?.value || 'sales';
  if (!from || !to) { showToast('Select both dates'); return; }

  const data = await apiGet<any>(`/reports/range?from=${from}&to=${to}&type=${type}`);
  const el = document.getElementById('range-result');
  if (!el) return;

  if (type === 'sales') {
    el.innerHTML = `
      <div class="dashboard-grid report-metrics report-metrics-4" style="margin-bottom:var(--space-4)">
        <div class="dashboard-card card-success"><div class="card-label">Gross Sales</div><div class="card-value">${fmtPeso(data.totals.gross_sales)}</div></div>
        <div class="dashboard-card card-success"><div class="card-label">Profit</div><div class="card-value">${fmtPeso(data.totals.profit)}</div></div>
        <div class="dashboard-card card-info"><div class="card-label">Tax Collected</div><div class="card-value">${fmtPeso(data.totals.tax_collected)}</div></div>
        <div class="dashboard-card card-info"><div class="card-label">Invoices</div><div class="card-value" style="font-size:var(--fs-2xl)">${data.totals.invoice_count}</div></div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Invoice #</th><th>Customer</th><th>Total</th><th>Status</th><th>Date</th></tr></thead>
          <tbody>
            ${data.invoices?.length ? data.invoices.map((inv: any) => `
              <tr>
              <td data-label="Invoice #" style="font-weight:600">${esc(inv.invoice_number)}</td>
              <td data-label="Customer">${esc(inv.customer_name)}</td>
              <td data-label="Total" style="font-family:var(--ff-mono);font-weight:600">${fmtPeso(inv.total)}</td>
              <td data-label="Status"><span class="status-badge ${inv.status}">${inv.status}</span></td>
              <td data-label="Date">${fmtDate(inv.issued_date)}</td>
              </tr>
            `).join('') : '<tr><td colspan="5" style="text-align:center;padding:2rem;color:var(--c-text-muted)">No data for this range</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
  } else {
    const netColor = data.net_profit >= 0 ? 'var(--c-success)' : 'var(--c-danger)';
    el.innerHTML = `
      <div class="dashboard-grid report-metrics report-metrics-4" style="margin-bottom:var(--space-4)">
        <div class="dashboard-card card-success"><div class="card-label">Revenue</div><div class="card-value">${fmtPeso(data.revenue)}</div></div>
        <div class="dashboard-card card-warning"><div class="card-label">COGS</div><div class="card-value">${fmtPeso(data.cogs)}</div></div>
        <div class="dashboard-card card-success"><div class="card-label">Gross Profit</div><div class="card-value">${fmtPeso(data.gross_profit)}</div></div>
        <div class="dashboard-card card-info"><div class="card-label">Net Profit</div><div class="card-value" style="color:${netColor}">${fmtPeso(data.net_profit)}</div></div>
      </div>
    `;
  }
}

export async function reloadDaily() {
  const d = (document.getElementById('rpt-daily-date') as HTMLInputElement)?.value;
  const el = document.getElementById('report-content');
  if (!el) return;
  el.innerHTML = await loadDailyReport(d);
}

export async function reloadMonthly() {
  const m = (document.getElementById('rpt-month') as HTMLInputElement)?.value;
  const el = document.getElementById('report-content');
  if (!el) return;
  el.innerHTML = await loadMonthlyReport(m);
}

export async function reloadTax() {
  const m = (document.getElementById('rpt-tax-month') as HTMLInputElement)?.value;
  const el = document.getElementById('report-content');
  if (!el) return;
  el.innerHTML = await loadTaxReport(m);
}

export function printReport(type: string, date: string) {
  const w = window.open('', '_blank', 'width=800,height=700');
  if (!w) return;
  const content = document.getElementById('report-content')?.innerHTML || '';
  w.document.write(`
    <html><head><title>BuildPro Report — ${date}</title>
    <style>
      @page { size: A4; margin: 16mm; }
      * { box-sizing: border-box; }
      body { font-family: Arial, sans-serif; color: #17202a; background: #fff; margin: 0; font-size: 10pt; }
      body:before { content: 'BUILDPRO CONSTRUCTION SUPPLY'; display: block; font-size: 18pt; font-weight: 800; letter-spacing: .03em; margin-bottom: 3px; }
      body:after { content: 'Generated ${date}'; display: block; margin-top: 18px; padding-top: 8px; border-top: 1px solid #cbd5e1; color: #64748b; font-size: 8pt; }
      #report-content, .report-content { display: block !important; }
      h2 { font-size: 15pt; margin: 0 0 14px; }
      h3, h4 { color: #334155; margin: 14px 0 7px; }
      .dashboard-grid { display: grid !important; grid-template-columns: repeat(4, 1fr) !important; gap: 8px !important; margin: 0 0 14px !important; }
      .dashboard-card, .chart-card { background: #fff !important; border: 1px solid #cbd5e1 !important; border-radius: 4px !important; padding: 9px !important; box-shadow: none !important; }
      .card-label { color: #64748b !important; font-size: 8pt !important; text-transform: uppercase; }
      .card-value { color: #0f172a !important; font-size: 13pt !important; }
      .card-sub, .tc-name, .tc-amount { color: #475569 !important; }
      table { width: 100%; border-collapse: collapse; margin: 8px 0 14px; }
      th { background: #e2e8f0; color: #1e293b; font-weight: 700; text-align: left; }
      th, td { border: 1px solid #cbd5e1; padding: 6px 7px; font-size: 8.5pt; }
      .status-badge { border: 0 !important; background: transparent !important; color: #334155 !important; padding: 0 !important; }
      input, select, button, .nav-btn, .no-print { display: none !important; }
      .table-wrap { overflow: visible !important; }
      .summary-line { display: flex; justify-content: space-between; border-bottom: 1px solid #e2e8f0; padding: 6px 0; }
      .summary-line.total { font-weight: 800; border-top: 2px solid #334155; border-bottom: 0; }
    </style></head><body><div id="report-content">${content}</div>
    <script>window.onload=function(){window.print()}</script>
    </body></html>
  `);
  w.document.close();
}
