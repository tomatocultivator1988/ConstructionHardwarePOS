import { apiGet } from '../lib/api';
import { esc, fmtDate, fmtPeso } from '../lib/helpers';
import { showToast } from '../lib/helpers';

let currentSubTab = 'daily';

export async function renderReports(): Promise<string> {
  return `
    <div class="page-header">
      <h2>Reports</h2>
    </div>
    <div style="display:flex;gap:2px;background:var(--c-bg);padding:3px;border-radius:var(--radius-md);margin-bottom:var(--space-5);width:fit-content">
      <button class="nav-btn ${currentSubTab === 'daily' ? 'active' : ''}" onclick="switchReportTab('daily')" style="font-size:var(--fs-sm)">Daily Sales</button>
      <button class="nav-btn ${currentSubTab === 'monthly' ? 'active' : ''}" onclick="switchReportTab('monthly')" style="font-size:var(--fs-sm)">P&L</button>
      <button class="nav-btn ${currentSubTab === 'tax' ? 'active' : ''}" onclick="switchReportTab('tax')" style="font-size:var(--fs-sm)">Tax Summary</button>
      <button class="nav-btn ${currentSubTab === 'range' ? 'active' : ''}" onclick="switchReportTab('range')" style="font-size:var(--fs-sm)">Date Range</button>
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
    document.querySelectorAll('#report-content .nav-btn').forEach((b, i) => {
      b.classList.toggle('active', (['daily','monthly','tax','range'][i] === tab));
    });
  } catch (e: any) { showToast(e.message); }
}

async function loadDailyReport(date?: string) {
  const d = date || new Date().toISOString().slice(0, 10);
  const data = await apiGet<any>(`/reports/daily?date=${d}`);
  return `
    <div style="display:flex;gap:var(--space-4);margin-bottom:var(--space-5);align-items:center">
      <input type="date" id="rpt-daily-date" value="${d}" onchange="reloadDaily()" style="min-height:36px;background:var(--c-surface-elevated);color:var(--c-text);border:1px solid var(--c-border);border-radius:var(--radius-md);padding:0 var(--space-3);font-size:var(--fs-sm)" />
      <button class="btn btn-primary btn-sm" onclick="printReport('daily', '${d}')">Print</button>
    </div>
    <div class="dashboard-grid" style="grid-template-columns:repeat(4,1fr)">
      <div class="dashboard-card card-success"><div class="card-label">Gross Sales</div><div class="card-value">${fmtPeso(data.totals.gross_sales)}</div></div>
      <div class="dashboard-card card-success"><div class="card-label">Profit</div><div class="card-value">${fmtPeso(data.totals.profit)}</div></div>
      <div class="dashboard-card card-info"><div class="card-label">Tax Collected</div><div class="card-value">${fmtPeso(data.totals.tax_collected)}</div></div>
      <div class="dashboard-card card-info"><div class="card-label">Invoices</div><div class="card-value" style="font-size:var(--fs-2xl)">${data.totals.invoice_count}</div></div>
    </div>
    ${data.paymentMethods?.length ? `
    <div style="display:flex;gap:var(--space-6);margin-bottom:var(--space-4);padding:var(--space-3) var(--space-4);background:var(--c-surface);border-radius:var(--radius-md);border:1px solid var(--c-border)">
      <span style="font-weight:600;color:var(--c-text-muted);font-size:var(--fs-xs)">PAYMENT METHODS:</span>
      ${data.paymentMethods.map((m: any) => `<span style="font-size:var(--fs-sm)"><strong>${esc(m.method)}</strong> ${fmtPeso(m.total)}</span>`).join(' | ')}
    </div>` : ''}
    <div class="table-wrap">
      <table>
        <thead><tr><th>Invoice #</th><th>Customer</th><th>Total</th><th>Status</th><th>Paid</th></tr></thead>
        <tbody>
          ${data.invoices.length ? data.invoices.map((inv: any) => `
            <tr>
              <td style="font-weight:600">${esc(inv.invoice_number)}</td>
              <td>${esc(inv.customer_name)}</td>
              <td>${fmtPeso(inv.total)}</td>
              <td><span class="status-badge ${inv.status}">${inv.status}</span></td>
              <td>${fmtPeso(inv.paid)}</td>
            </tr>
          `).join('') : '<tr><td colspan="5" style="text-align:center;color:var(--c-text-muted);padding:2rem">No transactions for this date</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

async function loadMonthlyReport(month?: string) {
  const m = month || new Date().toISOString().slice(0, 7);
  const data = await apiGet<any>(`/reports/monthly?month=${m}`);
  const netColor = data.net_profit >= 0 ? 'var(--c-success)' : 'var(--c-danger)';
  const momColor = data.mom_change >= 0 ? 'var(--c-success)' : 'var(--c-danger)';
  return `
    <div style="display:flex;gap:var(--space-4);margin-bottom:var(--space-5);align-items:center">
      <input type="month" id="rpt-month" value="${m}" onchange="reloadMonthly()" style="min-height:36px;background:var(--c-surface-elevated);color:var(--c-text);border:1px solid var(--c-border);border-radius:var(--radius-md);padding:0 var(--space-3);font-size:var(--fs-sm)" />
      <button class="btn btn-primary btn-sm" onclick="printReport('monthly', '${m}')">Print</button>
    </div>
    <div class="dashboard-grid" style="grid-template-columns:repeat(5,1fr)">
      <div class="dashboard-card card-success"><div class="card-label">Revenue</div><div class="card-value">${fmtPeso(data.revenue)}</div></div>
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
      <div class="summary-line"><span>Revenue</span><span>${fmtPeso(data.revenue)}</span></div>
      <div class="summary-line"><span>Cost of Goods Sold</span><span>${fmtPeso(data.cogs)}</span></div>
      <div class="summary-line"><span>Gross Profit</span><span style="color:var(--c-success)">${fmtPeso(data.gross_profit)}</span></div>
      <div class="summary-line"><span>Operating Expenses</span><span style="color:var(--c-danger)">${fmtPeso(data.expenses)}</span></div>
      <div class="summary-line total"><span>Net Profit</span><span style="color:${netColor}">${fmtPeso(data.net_profit)}</span></div>
    </div>
  `;
}

async function loadTaxReport(month?: string) {
  const m = month || new Date().toISOString().slice(0, 7);
  const data = await apiGet<any>(`/reports/tax?month=${m}`);
  return `
    <div style="display:flex;gap:var(--space-4);margin-bottom:var(--space-5);align-items:center">
      <input type="month" id="rpt-tax-month" value="${m}" onchange="reloadTax()" style="min-height:36px;background:var(--c-surface-elevated);color:var(--c-text);border:1px solid var(--c-border);border-radius:var(--radius-md);padding:0 var(--space-3);font-size:var(--fs-sm)" />
      <button class="btn btn-primary btn-sm" onclick="printReport('tax', '${m}')">Print</button>
    </div>
    <div class="dashboard-grid" style="grid-template-columns:repeat(4,1fr)">
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
              <td style="font-weight:600">${(r.tax_rate * 100).toFixed(0)}%</td>
              <td>${r.count}</td>
              <td>${fmtPeso(r.subtotal)}</td>
              <td>${fmtPeso(r.tax)}</td>
            </tr>
          `).join('') : '<tr><td colspan="4" style="text-align:center;color:var(--c-text-muted);padding:2rem">No data</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

async function loadRangeForm() {
  const from = new Date().toISOString().slice(0, 10);
  const to = new Date().toISOString().slice(0, 10);
  return `
    <div style="display:flex;gap:var(--space-4);margin-bottom:var(--space-5);align-items:center;flex-wrap:wrap">
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
      <div class="dashboard-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:var(--space-4)">
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
                <td style="font-weight:600">${esc(inv.invoice_number)}</td>
                <td>${esc(inv.customer_name)}</td>
                <td>${fmtPeso(inv.total)}</td>
                <td><span class="status-badge ${inv.status}">${inv.status}</span></td>
                <td>${fmtDate(inv.issued_date)}</td>
              </tr>
            `).join('') : '<tr><td colspan="5" style="text-align:center;padding:2rem;color:var(--c-text-muted)">No data for this range</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
  } else {
    const netColor = data.net_profit >= 0 ? 'var(--c-success)' : 'var(--c-danger)';
    el.innerHTML = `
      <div class="dashboard-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:var(--space-4)">
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
  w.document.write(`
    <html><head><title>Report — ${date}</title>
    <style>body{font-family:sans-serif;padding:2rem;color:#111}</style></head><body>
    ${document.getElementById('report-content')?.innerHTML || ''}
    <script>window.onload=function(){window.print();window.close()}</script>
    </body></html>
  `);
  w.document.close();
}
