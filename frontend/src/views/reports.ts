import { apiGet } from '../lib/api';
import { esc, fmtDate, fmtPeso, businessDate, businessMonth } from '../lib/helpers';
import { showToast } from '../lib/helpers';
import { showExportPeriodModal, exportTable, type ExportPeriod } from '../lib/export';

let currentSubTab = 'daily';
let currentReportPeriod = 'month';
let monthlyReportData: any = null;
let pnlChart: any = null;
let comprehensiveCache: { key: string; data: any } | null = null;

function reportPeriodRange(period = currentReportPeriod): { from: string; to: string } {
  const today = businessDate();
  const [year, month, day] = today.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (period === 'year') return { from: `${year}-01-01`, to: `${year}-12-31` };
  if (period === 'week') {
    const mondayOffset = (date.getUTCDay() + 6) % 7;
    const monday = new Date(date); monday.setUTCDate(date.getUTCDate() - mondayOffset);
    const sunday = new Date(monday); sunday.setUTCDate(monday.getUTCDate() + 6);
    return { from: monday.toISOString().slice(0, 10), to: sunday.toISOString().slice(0, 10) };
  }
  if (period === 'quarter') {
    const quarter = Math.floor((month - 1) / 3); const start = new Date(Date.UTC(year, quarter * 3, 1)); const end = new Date(Date.UTC(year, quarter * 3 + 3, 0));
    return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
  }
  return { from: `${year}-${String(month).padStart(2, '0')}-01`, to: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10) };
}

function periodText() {
  const range = reportPeriodRange();
  return `${fmtDate(range.from)} – ${fmtDate(range.to)}`;
}

function reportPeriodControl() {
  if (currentSubTab === 'daily') {
    return `<div class="report-period-bar daily-period-bar"><div><strong>Daily sales date</strong><span>Choose the day to review</span></div><input id="rpt-daily-date" type="date" value="${reportPeriodRange().to}" onchange="reloadDaily()" /></div>`;
  }
  return `<div class="report-period-bar"><div><strong>Report period</strong><span id="report-period-range">${periodText()}</span></div><select id="report-period" onchange="applyReportPeriod(this.value)"><option value="week" ${currentReportPeriod === 'week' ? 'selected' : ''}>This week</option><option value="month" ${currentReportPeriod === 'month' ? 'selected' : ''}>This month</option><option value="quarter" ${currentReportPeriod === 'quarter' ? 'selected' : ''}>This quarter</option><option value="year" ${currentReportPeriod === 'year' ? 'selected' : ''}>This year</option></select></div>`;
}

export async function renderReports(): Promise<string> {
  return `
    <div class="page-header">
      <h2>Reports</h2>
      <button class="btn" onclick="exportReports()">Export Report</button>
    </div>
    <div id="report-period-control">${reportPeriodControl()}</div>
    <div class="report-tabs" role="tablist" aria-label="Report types">
      <button class="nav-btn ${currentSubTab === 'daily' ? 'active' : ''}" onclick="switchReportTab('daily')" style="font-size:var(--fs-sm)">Daily Sales</button>
      <button class="nav-btn ${currentSubTab === 'monthly' ? 'active' : ''}" onclick="switchReportTab('monthly')" style="font-size:var(--fs-sm)">P&L</button>
      <button class="nav-btn ${currentSubTab === 'books' ? 'active' : ''}" onclick="switchReportTab('books')" style="font-size:var(--fs-sm)">Books</button>
      <button class="nav-btn ${currentSubTab === 'inventory' ? 'active' : ''}" onclick="switchReportTab('inventory')" style="font-size:var(--fs-sm)">Inventory</button>
      <button class="nav-btn ${currentSubTab === 'product-sales' ? 'active' : ''}" onclick="switchReportTab('product-sales')" style="font-size:var(--fs-sm)">Products</button>
      <button class="nav-btn ${currentSubTab === 'payments' ? 'active' : ''}" onclick="switchReportTab('payments')" style="font-size:var(--fs-sm)">Payments</button>
      <button class="nav-btn ${currentSubTab === 'z-reading' ? 'active' : ''}" onclick="switchReportTab('z-reading')" style="font-size:var(--fs-sm)">Z-Reading</button>
      <button class="nav-btn ${currentSubTab === 'returns' ? 'active' : ''}" onclick="switchReportTab('returns')" style="font-size:var(--fs-sm)">Returns</button>
      <button class="nav-btn ${currentSubTab === 'aging' ? 'active' : ''}" onclick="switchReportTab('aging')" style="font-size:var(--fs-sm)">A/R Aging</button>
      <button class="nav-btn ${currentSubTab === 'expenses' ? 'active' : ''}" onclick="switchReportTab('expenses')" style="font-size:var(--fs-sm)">Expenses</button>
      <button class="nav-btn ${currentSubTab === 'purchases' ? 'active' : ''}" onclick="switchReportTab('purchases')" style="font-size:var(--fs-sm)">Purchases</button>
      <button class="nav-btn ${currentSubTab === 'deliveries' ? 'active' : ''}" onclick="switchReportTab('deliveries')" style="font-size:var(--fs-sm)">Deliveries</button>
      <button class="nav-btn ${currentSubTab === 'staff' ? 'active' : ''}" onclick="switchReportTab('staff')" style="font-size:var(--fs-sm)">Staff</button>
    </div>
    <div id="report-content">
      ${await loadDailyReport()}
    </div>
  `;
}

export async function switchReportTab(tab: string) {
  currentSubTab = tab;
  const periodControl = document.getElementById('report-period-control');
  if (periodControl) periodControl.innerHTML = reportPeriodControl();
  const el = document.getElementById('report-content');
  if (!el) return;
  el.innerHTML = `<div class="loading-skeleton">${'<div class="sk-item"></div>'.repeat(4)}</div>`;
  try {
    if (tab === 'daily') el.innerHTML = await loadDailyReport();
    else if (tab === 'monthly') { el.innerHTML = await loadMonthlyReport(); drawPnlChart(); }
    else if (tab === 'tax') el.innerHTML = await loadTaxReport();
    else if (tab === 'range') el.innerHTML = await loadRangeForm();
    else if (tab === 'books') el.innerHTML = await loadBooksReport();
    else if (['inventory','product-sales','payments','z-reading','returns','aging','expenses','purchases','deliveries','staff'].includes(tab)) el.innerHTML = await loadComprehensiveReport(tab);
    else if (tab === 'summary') el.innerHTML = await loadFinancialSummary();
    document.querySelectorAll('.report-tabs .nav-btn').forEach(b => b.classList.remove('active'));
  } catch (e: any) { showToast(e.message); }
}

const comprehensiveLabels: Record<string, { title: string; key: string; headers: string[]; fields: string[] }> = {
  inventory: { title: 'Inventory Status', key: 'inventory', headers: ['Product','Category','Stock','Reorder Point','Cost','Selling Price','Stock Value','Qty Sold'], fields: ['name','category','stock','reorder_point','cost_price','price_per_unit','stock_value','quantity_sold'] },
  'product-sales': { title: 'Product Sales and Profit', key: 'product_sales', headers: ['Product','Category','Qty Sold','Net Sales','COGS','Gross Profit','Margin %'], fields: ['product','category','quantity_sold','net_sales','cogs','gross_profit','margin'] },
  payments: { title: 'Payments by Method', key: 'payments', headers: ['Method','Transactions','Gross Payments','Refunds','Net Collections'], fields: ['method','transaction_count','gross_payments','refunds','net_collections'] },
  'z-reading': { title: 'Z-Reading / Daily Close', key: 'z_daily', headers: ['Business Date','Shifts','Opening Cash','Cash Sales','Refunds','Cash In','Cash Out','Expected','Counted','Variance'], fields: ['report_date','shift_count','opening_cash','cash_sales','cash_refunds','cash_in','cash_out','expected_cash','counted_cash','variance'] },
  returns: { title: 'Returns, Refunds, Credit Memos and Voids', key: 'returns', headers: ['Type','Date','Invoice','Product','Qty','Amount','Method'], fields: ['event_type','event_date','invoice_number','product','quantity','amount','method'] },
  aging: { title: 'Receivables Aging', key: 'receivables_aging', headers: ['Invoice','Buyer','Issued','Total','Paid','Balance','Days Outstanding','Aging Bucket'], fields: ['invoice_number','buyer','issued_date','total','paid','balance','days_outstanding','aging_bucket'] },
  expenses: { title: 'Expenses by Category', key: 'expenses', headers: ['Date','Category','Vendor','Payment Method','Description','Amount'], fields: ['expense_date','category','vendor','payment_method','description','amount'] },
  purchases: { title: 'Purchases and Suppliers', key: 'purchases', headers: ['PO','Order Date','Received Date','Supplier','Status','Total'], fields: ['po_number','order_date','received_date','supplier','status','total'] },
  deliveries: { title: 'Delivery Operations', key: 'deliveries', headers: ['Invoice','Date','Buyer','Status','Delivery Person','Address'], fields: ['invoice_number','issued_date','buyer','delivery_status','delivery_person','buyer_address'] },
  staff: { title: 'Staff and Cashier Performance', key: 'staff', headers: ['Staff','Invoices','Net Sales','Collections','Refunds','Days Present'], fields: ['username','invoices','net_sales','collections','refunds','days_present'] },
};

async function loadComprehensiveReport(section: string) {
  const range = reportPeriodRange();
  const cacheKey = `${range.from}:${range.to}`;
  const data = comprehensiveCache?.key === cacheKey
    ? comprehensiveCache.data
    : await apiGet<any>(`/reports/comprehensive?from=${range.from}&to=${range.to}`).then((result: any) => { comprehensiveCache = { key: cacheKey, data: result }; return result; });
  const config = comprehensiveLabels[section];
  const items = (data[config.key] || []).map((item: any) => {
    if (section === 'product-sales') { item.gross_profit = Number(item.net_sales || 0) - Number(item.cogs || 0); item.margin = Number(item.net_sales || 0) ? (item.gross_profit / Number(item.net_sales)) * 100 : 0; }
    return item;
  });
  const moneyFields = new Set(['cost_price','price_per_unit','stock_value','net_sales','cogs','gross_profit','amount','opening_cash','cash_sales','cash_refunds','cash_in','cash_out','expected_cash','closing_cash','variance','total','paid','balance','collections','refunds']);
  const rows = items.length ? items.map((item: any) => `<tr>${config.fields.map(field => { const value = item[field]; const display = value === null || value === undefined || value === '' ? '—' : moneyFields.has(field) ? fmtPeso(Number(value)) : field === 'margin' ? `${Number(value).toFixed(1)}%` : String(value); return `<td data-label="${esc(field)}">${esc(display)}</td>`; }).join('')}</tr>`).join('') : `<tr><td colspan="${config.headers.length}" style="text-align:center;padding:2rem;color:var(--c-text-muted)">No data for this period</td></tr>`;
  return `<div class="report-section-heading"><h3>${config.title}</h3><span>${fmtDate(range.from)} – ${fmtDate(range.to)}</span></div><div class="table-wrap"><table><thead><tr>${config.headers.map(header => `<th>${header}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

export function applyReportPeriod(period: string) {
  if (!['week', 'month', 'quarter', 'year'].includes(period)) return;
  currentReportPeriod = period;
  (window as any).loadView?.('reports');
}

export function exportReports() {
  showExportPeriodModal('Reports', async (period: ExportPeriod, format) => {
    if (format === 'xlsx') {
      await exportDetailedWorkbook(period);
      return;
    }
    if (currentSubTab === 'monthly') {
      const data = await apiGet<any>(`/reports/range?type=profit&from=${period.from}&to=${period.to}`);
      exportTable('Profit and Loss Report', period, ['Metric', 'Amount'], [['Revenue', fmtPeso(data.revenue)], ['COGS', fmtPeso(data.cogs)], ['Gross Profit', fmtPeso(data.gross_profit)], ['Expenses', fmtPeso(data.expenses)], ['Net Profit', fmtPeso(data.net_profit)]], format, `Period: ${period.label}`);
      return;
    }
    const data = await apiGet<any>(`/reports/range?type=sales&from=${period.from}&to=${period.to}`);
    const rows = (data.invoices || []).map((row: any) => [row.invoice_number, row.customer_name, fmtDate(row.issued_date), row.status, fmtPeso(row.total), fmtPeso(row.paid)]);
    exportTable('Sales Report', period, ['Invoice', 'Buyer', 'Issued', 'Status', 'Total', 'Paid'], rows, format, `Gross sales: ${fmtPeso(data.totals?.gross_sales || 0)} · Profit: ${fmtPeso(data.totals?.profit || 0)} · ${rows.length} invoice${rows.length === 1 ? '' : 's'}`);
  });
}

function money(value: unknown) { return Number(value || 0); }

async function exportDetailedWorkbook(period: ExportPeriod) {
  const XLSX = await import('xlsx-js-style');
  const query = `from=${encodeURIComponent(period.from)}&to=${encodeURIComponent(period.to)}`;
  const [sales, profit, books, cash, comprehensive] = await Promise.all([
    apiGet<any>(`/reports/range?type=sales&${query}`),
    apiGet<any>(`/reports/range?type=profit&${query}`),
    apiGet<any>(`/reports/books?${query}`),
    apiGet<any>(`/reports/cash-flow?${query}`),
    apiGet<any>(`/reports/comprehensive?${query}`),
  ]);

  const wb = XLSX.utils.book_new();
  const addSheet = (name: string, title: string, headers: string[], rows: unknown[][], summary: unknown[][] = []) => {
    const aoa = [[title], [`Period: ${period.from} to ${period.to}`], [], ...summary, headers, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const headerRow = summary.length + 4;
    const lastRow = headerRow + rows.length;
    const lastColumn = XLSX.utils.encode_col(Math.max(headers.length - 1, 0));
    const navy = '0B2945';
    const orange = 'F7931E';
    const paleBlue = 'EAF2F8';
    const lightOrange = 'FFF1DF';
    const white = 'FFFFFF';
    const border = { style: 'thin', color: 'D8E1EA' };
    const solid = (rgb: string) => ({ patternType: 'solid', fgColor: { rgb } });
    const titleStyle = { font: { name: 'Aptos', sz: 16, bold: true, color: white }, fill: solid(navy), alignment: { vertical: 'center' } };
    const subtitleStyle = { font: { name: 'Aptos', sz: 10, italic: true, color: '3F5366' }, fill: solid('F5F8FA') };
    const headerStyle = { font: { name: 'Aptos', sz: 10, bold: true, color: white }, fill: solid(navy), alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border: { top: border, bottom: border } };
    const summaryLabelStyle = { font: { name: 'Aptos', sz: 10, bold: true, color: navy }, fill: solid(lightOrange) };
    const summaryValueStyle = { font: { name: 'Aptos', sz: 10, bold: true, color: navy }, fill: solid(lightOrange), alignment: { horizontal: 'right' } };
    const applyRowStyle = (row: number, style: any) => { for (let col = 0; col < headers.length; col++) { const ref = XLSX.utils.encode_cell({ r: row - 1, c: col }); if (ws[ref]) ws[ref].s = style; } };
    for (let col = 0; col < headers.length; col++) {
      const titleRef = XLSX.utils.encode_cell({ r: 0, c: col });
      const subtitleRef = XLSX.utils.encode_cell({ r: 1, c: col });
      if (!ws[titleRef]) ws[titleRef] = { v: '', t: 's' };
      if (!ws[subtitleRef]) ws[subtitleRef] = { v: '', t: 's' };
      ws[titleRef].s = titleStyle;
      ws[subtitleRef].s = subtitleStyle;
    }
    if (headers.length > 1) { ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: headers.length - 1 } }]; }
    for (let row = 4; row < headerRow; row++) { const label = ws[`A${row}`]; const value = ws[`B${row}`]; if (label) label.s = summaryLabelStyle; if (value) { value.s = summaryValueStyle; value.z = headers.length > 1 ? '₱#,##0.00' : '0'; } }
    applyRowStyle(headerRow, headerStyle);
    for (let row = headerRow + 1; row <= lastRow; row++) {
      for (let col = 0; col < headers.length; col++) {
        const ref = XLSX.utils.encode_cell({ r: row - 1, c: col });
        const cell = ws[ref]; if (!cell) continue;
        cell.s = { font: { name: 'Aptos', sz: 10, color: '243447' }, fill: solid(row % 2 === 0 ? 'FFFFFF' : 'F7FAFC'), border: { bottom: border }, alignment: { vertical: 'center', horizontal: typeof cell.v === 'number' ? 'right' : 'left' } };
        if (/amount|total|paid|balance|tax|profit|sales|cost|price|cash/i.test(headers[col])) cell.z = '₱#,##0.00;[Red]-₱#,##0.00';
        if (/count|quantity|stock/i.test(headers[col])) cell.z = '#,##0.##';
        if (/margin|percentage|%/i.test(headers[col])) cell.z = '0.0%';
      }
    }
    ws['!freeze'] = { xSplit: 0, ySplit: headerRow };
    ws['!autofilter'] = { ref: `A${headerRow}:${lastColumn}${lastRow}` };
    ws['!rows'] = [{ hpt: 30 }, { hpt: 20 }, { hpt: 10 }, ...summary.map(() => ({ hpt: 20 })), { hpt: 28 }];
    ws['!cols'] = headers.map((header, index) => {
      const contentWidth = Math.max(header.length + 4, ...rows.map(row => String(row[index] ?? '').length + 3), 14);
      const descriptionColumn = /description|address|buyer|product|supplier|vendor|bucket/i.test(header);
      return { wch: Math.min(descriptionColumn ? 42 : 24, descriptionColumn ? Math.max(contentWidth, 22) : contentWidth) };
    });
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  };

  const salesRows = (sales.invoices || []).map((r: any) => [r.invoice_number, r.customer_name, r.issued_date, r.status, money(r.total), money(r.paid), Math.max(0, money(r.total) - money(r.paid))]);
  addSheet('Daily Sales', 'Daily Sales Transactions', ['Invoice', 'Buyer', 'Issued', 'Status', 'Total', 'Paid', 'Balance'], salesRows, [['Gross Sales', money(sales.totals?.gross_sales)], ['Profit', money(sales.totals?.profit)], ['Invoice Count', money(sales.totals?.invoice_count)]]);

  addSheet('P&L', 'Profit and Loss', ['Metric', 'Amount'], [['Revenue', money(profit.revenue)], ['COGS', money(profit.cogs)], ['Gross Profit', money(profit.revenue) - money(profit.cogs)], ['Expenses', money(profit.expenses)], ['Net Profit', money(profit.revenue) - money(profit.cogs) - money(profit.expenses)]], [['Report', 'Profit and Loss']]);

  const paymentRows = (comprehensive.payments || []).map((r: any) => [r.method, r.transaction_count, money(r.gross_payments), money(r.refunds), money(r.net_collections)]);
  addSheet('Payments', 'Payment Methods Summary', ['Method', 'Transactions', 'Gross Payments', 'Refunds', 'Net Collections'], paymentRows, [['Net Collections', paymentRows.reduce((sum, row) => sum + money(row[4]), 0)]]);

  const expenseRows = (comprehensive.expenses || []).map((r: any) => [r.expense_date, r.category, r.vendor, r.payment_method, r.description, money(r.amount)]);
  addSheet('Expenses', 'Expenses and Purchases', ['Date', 'Category', 'Vendor', 'Payment Method', 'Description', 'Amount'], expenseRows, [['Total Expenses', expenseRows.reduce((sum, row) => sum + money(row[5]), 0)]]);

  const receivableRows = (comprehensive.receivables_aging || []).map((r: any) => [r.invoice_number, r.buyer, r.issued_date, money(r.total), money(r.paid), money(r.balance), r.days_outstanding, r.aging_bucket]);
  addSheet('Receivables', 'Receivables Aging', ['Invoice', 'Buyer', 'Issued', 'Total', 'Paid', 'Balance', 'Days Outstanding', 'Aging Bucket'], receivableRows, [['Open Invoice Count', receivableRows.length], ['Open Balance', receivableRows.reduce((sum, row) => sum + money(row[5]), 0)]]);

  addSheet('Cash Flow', 'Cash Flow Summary', ['Metric', 'Amount'], [['Cash Receipts', money(cash.cash_receipts)], ['Cash Refunds', money(cash.cash_refunds)], ['Cash Expenses', money(cash.cash_expenses)], ['Net Cash Change', money(cash.net_cash_change)]], [['Period', period.label]]);

  const inventoryRows = (comprehensive.inventory || []).map((r: any) => [r.name, r.category, r.unit, money(r.stock), money(r.reorder_point), money(r.cost_price), money(r.price_per_unit), money(r.stock_value), money(r.quantity_sold)]);
  addSheet('Inventory', 'Inventory Status', ['Product', 'Category', 'Unit', 'Stock', 'Reorder Point', 'Cost', 'Selling Price', 'Stock Value', 'Qty Sold'], inventoryRows, [['Current Stock Value', inventoryRows.reduce((sum, row) => sum + money(row[7]), 0)]]);

  const productRows = (comprehensive.product_sales || []).map((r: any) => { const salesValue = money(r.net_sales); const cogsValue = money(r.cogs); const profitValue = salesValue - cogsValue; return [r.product, r.category, money(r.quantity_sold), salesValue, cogsValue, profitValue, salesValue ? profitValue / salesValue : 0]; });
  addSheet('Product Sales', 'Product Sales and Profit', ['Product', 'Category', 'Qty Sold', 'Net Sales', 'COGS', 'Gross Profit', 'Margin'], productRows, [['Net Sales', productRows.reduce((sum, row) => sum + money(row[3]), 0)], ['Gross Profit', productRows.reduce((sum, row) => sum + money(row[5]), 0)]]);

  const zRows = (comprehensive.z_daily || []).map((r: any) => [r.report_date, money(r.shift_count), money(r.opening_cash), money(r.cash_sales), money(r.cash_refunds), money(r.cash_in), money(r.cash_out), money(r.expected_cash), money(r.counted_cash), money(r.variance)]);
  addSheet('Z-Reading', 'Daily Z-Reading', ['Business Date', 'Shifts', 'Opening Cash', 'Cash Sales', 'Refunds', 'Cash In', 'Cash Out', 'Expected Cash', 'Counted Cash', 'Variance'], zRows);

  const returnRows = (comprehensive.returns || []).map((r: any) => [r.event_type, r.event_date, r.invoice_number, r.product, r.quantity, money(r.amount), r.method]);
  addSheet('Returns', 'Returns, Refunds, Credit Memos and Voids', ['Type', 'Date', 'Invoice', 'Product', 'Qty', 'Amount', 'Method'], returnRows);

  const purchaseRows = (comprehensive.purchases || []).map((r: any) => [r.po_number, r.order_date, r.received_date, r.supplier, r.status, money(r.total)]);
  addSheet('Purchases', 'Purchases and Suppliers', ['PO', 'Order Date', 'Received Date', 'Supplier', 'Status', 'Total'], purchaseRows);

  const deliveryRows = (comprehensive.deliveries || []).map((r: any) => [r.invoice_number, r.issued_date, r.buyer, r.delivery_status, r.delivery_person, r.buyer_address]);
  addSheet('Deliveries', 'Delivery Operations', ['Invoice', 'Date', 'Buyer', 'Status', 'Delivery Person', 'Address'], deliveryRows);

  const staffRows = (comprehensive.staff || []).map((r: any) => [r.username, money(r.invoices), money(r.net_sales), money(r.collections), money(r.refunds), money(r.days_present)]);
  addSheet('Staff', 'Staff and Cashier Performance', ['Staff', 'Invoices', 'Net Sales', 'Collections', 'Refunds', 'Days Present'], staffRows);

  const filename = `jeg-enterprises-reports-${period.from}-to-${period.to}.xlsx`;
  XLSX.writeFile(wb, filename);
  showToast(`Excel workbook exported: ${filename}`);
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
  const period = reportPeriodRange();
  const start = from || period.from; const end = to || period.to;
  const [data, cash] = await Promise.all([apiGet<any>(`/reports/books?from=${start}&to=${end}`), apiGet<any>(`/reports/cash-flow?from=${start}&to=${end}`)]);
  const rows = (items: any[], fields: string[]) => items.length ? items.map((r: any) => `<tr>${fields.map(f => `<td data-label="${esc(f)}">${esc(String(r[f] ?? ''))}</td>`).join('')}</tr>`).join('') : '<tr><td colspan="6">No entries</td></tr>';
  return `<div class="report-filters"><label>From</label><input id="rpt-books-from" type="date" value="${start}" /><label>To</label><input id="rpt-books-to" type="date" value="${end}" /><button class="btn btn-primary btn-sm" onclick="reloadBooks()">Load</button><button class="btn btn-primary btn-sm" onclick="printReport('books','${start} to ${end}')">Export</button></div>
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
  const d = date || reportPeriodRange().to;
  const data = await apiGet<any>(`/reports/daily?date=${d}`);
  return `
    <div class="report-filters">
      <button class="btn btn-primary btn-sm" onclick="printReport('daily', '${d}')">Export</button>
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
  const m = month || reportPeriodRange().to.slice(0, 7) || businessMonth();
  const monthStart = `${m}-01`;
  const monthEnd = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const [data, cash, financial] = await Promise.all([
    apiGet<any>(`/reports/monthly?month=${m}`),
    apiGet<any>(`/reports/cash-flow?from=${monthStart}&to=${monthEnd}`),
    apiGet<any>(`/reports/financial-summary?from=${monthStart}&to=${monthEnd}`),
  ]);
  monthlyReportData = data;
  const netColor = data.net_profit >= 0 ? 'var(--c-success)' : 'var(--c-danger)';
  const momColor = data.mom_change >= 0 ? 'var(--c-success)' : 'var(--c-danger)';
  return `
    <div class="report-filters">
      <input type="month" id="rpt-month" value="${m}" onchange="reloadMonthly()" style="min-height:36px;background:var(--c-surface-elevated);color:var(--c-text);border:1px solid var(--c-border);border-radius:var(--radius-md);padding:0 var(--space-3);font-size:var(--fs-sm)" />
      <button class="btn btn-primary btn-sm" onclick="printReport('monthly', '${m}')">Export</button>
    </div>
    <div class="dashboard-grid report-metrics report-metrics-5">
      <div class="dashboard-card card-success"><div class="card-label">Net Sales</div><div class="card-value">${fmtPeso(data.revenue)}</div><div class="card-sub">Accrual basis</div></div>
      <div class="dashboard-card card-warning"><div class="card-label">COGS</div><div class="card-value">${fmtPeso(data.cogs)}</div></div>
      <div class="dashboard-card card-success"><div class="card-label">Gross Profit</div><div class="card-value">${fmtPeso(data.gross_profit)}</div></div>
      <div class="dashboard-card card-danger"><div class="card-label">Expenses</div><div class="card-value">${fmtPeso(data.expenses)}</div></div>
      <div class="dashboard-card card-info"><div class="card-label">Net Profit</div><div class="card-value" style="color:${netColor}">${fmtPeso(data.net_profit)}</div><div class="card-sub">${data.mom_change >= 0 ? '↑' : '↓'} ${Math.abs(data.mom_change).toFixed(1)}% vs last month</div></div>
    </div>
    <div class="pnl-cash-snapshot"><div class="pnl-cash-heading"><strong>Cash Flow &amp; Credit Snapshot</strong><span>${fmtDate(monthStart)} – ${fmtDate(monthEnd)}</span></div><div class="pnl-cash-grid"><div><span>Cash Collections</span><b>${fmtPeso(cash.cash_receipts)}</b></div><div><span>Cash Refunds</span><b class="negative">${fmtPeso(cash.cash_refunds)}</b></div><div><span>Cash Expenses</span><b class="negative">${fmtPeso(cash.cash_expenses)}</b></div><div><span>Net Cash Change</span><b class="${cash.net_cash_change >= 0 ? 'positive' : 'negative'}">${fmtPeso(cash.net_cash_change)}</b></div><div><span>Credit / Receivables</span><b class="warning-value">${fmtPeso(financial.accounts_receivable)}</b></div></div></div>
    <div class="chart-card pnl-chart-card"><div class="chart-title">P&amp;L Breakdown</div><p class="card-sub">How the selected month’s sales are allocated to costs, expenses, and profit.</p><div class="pnl-chart-wrap"><canvas id="pnl-report-chart"></canvas></div></div>
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
      <button class="btn btn-primary btn-sm" onclick="printReport('tax', '${m}')">Export</button>
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
  drawPnlChart();
}

function drawPnlChart() {
  const canvas = document.getElementById('pnl-report-chart') as HTMLCanvasElement | null;
  const ChartCtor = (window as any).Chart;
  if (!canvas || !ChartCtor || !monthlyReportData) return;
  if (pnlChart) { try { pnlChart.destroy(); } catch {} }
  const d = monthlyReportData;
  const netValue = Math.abs(Number(d.net_profit || 0));
  const labels = ['COGS', 'Operating Expenses', d.net_profit >= 0 ? 'Net Profit' : 'Net Loss'];
  const values = [Number(d.cogs || 0), Number(d.expenses || 0), netValue];
  const total = values.reduce((sum, value) => sum + Math.max(0, value), 0);
  if (total <= 0) return;
  const colors = ['#637d95', '#ef654a', d.net_profit >= 0 ? '#22c55e' : '#ef4444'];
  pnlChart = new ChartCtor(canvas, {
    type: 'pie',
    data: { labels, datasets: [{ data: values, backgroundColor: colors, borderColor: '#ffffff', borderWidth: 3, hoverOffset: 5 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { color: '#385671', usePointStyle: true, padding: 14, generateLabels: (chart: any) => chart.data.labels.map((label: string, index: number) => ({ text: `${label} · ${((Number(chart.data.datasets[0].data[index]) / total) * 100).toFixed(1)}%`, fillStyle: colors[index], strokeStyle: colors[index], index })) } }, tooltip: { callbacks: { label: (context: any) => ` ${context.label}: ₱${Number(context.raw || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${((Number(context.raw || 0) / total) * 100).toFixed(1)}%)` } } } }
  });
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
    <html><head><title>Jeg Enterprises Report — ${date}</title>
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
