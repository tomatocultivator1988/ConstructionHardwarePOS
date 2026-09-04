import { apiGet } from '../lib/api';
import { esc, fmtDate, fmtPeso, businessDate } from '../lib/helpers';
import { getChartInstances } from '../lib/router';
import type { Invoice, Analytics, PaySummary } from '../lib/types';

export async function renderDashboard(): Promise<string> {
  const [invoices, materials, paySummary, analytics] = await Promise.all([
    apiGet<Invoice[]>('/invoices'),
    apiGet<any[]>('/materials'),
    apiGet<PaySummary>('/payments/summary'),
    apiGet<Analytics>('/analytics/dashboard'),
  ]);

  const now = new Date();
  const today = businessDate();

  const todaySales = paySummary.todayTotal || 0;
  const last7: { date: string; label: string; total: number; profit: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const ds = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore' }).format(d);
    const dayData = (paySummary.daily || []).find((dd: any) => dd.date === ds);
    const profitData = (analytics.profitTrend || []).find((dd: any) => dd.date === ds);
    last7.push({
      date: ds,
      label: d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
      total: dayData ? dayData.total : 0,
      profit: profitData ? profitData.profit : 0,
    });
  }

  const outstanding = invoices
    .filter((i: Invoice) => i.status === 'pending' || i.status === 'partial')
    .reduce((s: number, i: Invoice) => s + Number((i as any).adjusted_total ?? i.total ?? 0), 0);

  const lowStockMats = materials.filter((m: any) => m.stock <= m.reorder_point);

  const avgMargin = materials.length > 0
    ? materials.reduce((sum: number, m: any) => {
        const margin = m.price_per_unit > 0 ? ((m.price_per_unit - (m.cost_price || 0)) / m.price_per_unit) * 100 : 0;
        return sum + margin;
      }, 0) / materials.length
    : 0;

  const pendingCount = invoices.filter((i: Invoice) => i.status === 'pending').length;
  const partialCount = invoices.filter((i: Invoice) => i.status === 'partial').length;
  const paidCount = invoices.filter((i: Invoice) => i.status === 'paid').length;

  const recentInvoices = invoices.slice(0, 5);

  const sv = analytics.stockValue || { total_cost: 0, total_retail: 0 };
  const topMats = analytics.topMaterials || [];
  const margins = analytics.materialMargins || [];
  const topCust = analytics.topCustomers || [];
  const mRev = analytics.monthRevenue || { revenue: 0, profit: 0 };
  const lmRev = analytics.lastMonthRevenue || { revenue: 0, profit: 0 };
  const yRev = analytics.yearRevenue || { revenue: 0, profit: 0 };
  const oRev = analytics.overallRevenue || { revenue: 0, profit: 0 };
  const monthChange = lmRev.revenue > 0 ? ((mRev.revenue - lmRev.revenue) / lmRev.revenue * 100) : 0;

  const revLabels = JSON.stringify(last7.map(d => d.label));
  const revData = JSON.stringify(last7.map(d => d.total));
  const profitData = JSON.stringify(last7.map(d => d.profit));

  const topMatLabels = JSON.stringify(topMats.map((m: any) => m.name.length > 14 ? m.name.slice(0, 12) + '...' : m.name));
  const topMatRevenue = JSON.stringify(topMats.map((m: any) => m.total_revenue));
  const topMatProfit = JSON.stringify(topMats.map((m: any) => m.profit));

  const marginLabels = JSON.stringify(margins.filter((m: any) => m.price_per_unit > 0).map((m: any) => m.name.length > 16 ? m.name.slice(0, 14) + '...' : m.name).reverse());
  const marginData = JSON.stringify(margins.filter((m: any) => m.price_per_unit > 0).map((m: any) => m.margin_pct).reverse());

  const lowNames = JSON.stringify(lowStockMats.map((m: any) => m.name.length > 18 ? m.name.slice(0, 15) + '...' : m.name));
  const lowStockData = JSON.stringify(lowStockMats.map((m: any) => m.stock));
  const lowReorderData = JSON.stringify(lowStockMats.map((m: any) => m.reorder_point));

  setTimeout(() => {
    const chartInstances = getChartInstances();

    const ctx1 = (document.getElementById('chart-revenue') as HTMLCanvasElement)?.getContext('2d');
    if (ctx1) {
      const g = ctx1.createLinearGradient(0, 0, 0, 200);
      g.addColorStop(0, 'rgba(240, 180, 41, 0.3)');
      g.addColorStop(1, 'rgba(240, 180, 41, 0)');
      const g2 = ctx1.createLinearGradient(0, 200, 0, 0);
      g2.addColorStop(0, 'rgba(34, 197, 94, 0.25)');
      g2.addColorStop(1, 'rgba(34, 197, 94, 0)');
      chartInstances.push(new (window as any).Chart(ctx1, {
        type: 'bar',
        data: {
          labels: JSON.parse(revLabels),
          datasets: [
            { label: 'Revenue', data: JSON.parse(revData), backgroundColor: g, borderColor: '#f0b429', borderWidth: 2, borderRadius: 4, borderSkipped: false, order: 2 },
            { label: 'Profit', data: JSON.parse(profitData), type: 'line', fill: true, backgroundColor: g2, borderColor: '#22c55e', borderWidth: 2.5, pointBackgroundColor: '#22c55e', pointBorderColor: '#1a1b1e', pointBorderWidth: 2, pointRadius: 4, pointHoverRadius: 6, tension: 0.3, order: 1 },
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          interaction: { intersect: false, mode: 'index' },
          plugins: { legend: { position: 'top', align: 'end', labels: { color: '#a09e9a', padding: 16, font: { size: 10, weight: '600' }, usePointStyle: true, pointStyle: 'circle' } } },
          scales: { y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#6b6a66', font: { size: 10 }, callback: (v: any) => '₱' + v.toFixed(0) } }, x: { grid: { display: false }, ticks: { color: '#6b6a66', font: { size: 9 } } } }
        }
      }));
    }

    const ctx2 = (document.getElementById('chart-status') as HTMLCanvasElement)?.getContext('2d');
    if (ctx2) {
      chartInstances.push(new (window as any).Chart(ctx2, {
        type: 'doughnut',
        data: { labels: ['Pending', 'Partial', 'Paid'], datasets: [{ data: [pendingCount, partialCount, paidCount], backgroundColor: ['#ef4444', '#f0b429', '#22c55e'], borderColor: '#1a1b1e', borderWidth: 3, hoverOffset: 8 }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: '65%', plugins: { legend: { position: 'bottom', labels: { color: '#a09e9a', padding: 16, font: { size: 11 }, usePointStyle: true, pointStyle: 'circle' } } } }
      }));
    }

    const ctx3 = (document.getElementById('chart-topmats') as HTMLCanvasElement)?.getContext('2d');
    if (ctx3 && topMats.length) {
      chartInstances.push(new (window as any).Chart(ctx3, {
        type: 'bar',
        data: { labels: JSON.parse(topMatLabels), datasets: [
          { label: 'Revenue', data: JSON.parse(topMatRevenue), backgroundColor: 'rgba(240, 180, 41, 0.7)', borderColor: '#f0b429', borderWidth: 1, borderRadius: 3 },
          { label: 'Profit', data: JSON.parse(topMatProfit), backgroundColor: 'rgba(34, 197, 94, 0.7)', borderColor: '#22c55e', borderWidth: 1, borderRadius: 3 },
        ]},
        options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top', align: 'end', labels: { color: '#a09e9a', padding: 12, font: { size: 10 }, usePointStyle: true, pointStyle: 'rectRounded' } } }, scales: { x: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#6b6a66', font: { size: 9 }, callback: (v: any) => '₱' + v.toFixed(0) } }, y: { grid: { display: false }, ticks: { color: '#a09e9a', font: { size: 10 } } } } }
      }));
    }

    const ctx4 = (document.getElementById('chart-margins') as HTMLCanvasElement)?.getContext('2d');
    if (ctx4 && margins.length) {
      const barColors = JSON.parse(marginData).map((v: number) => v >= 40 ? 'rgba(34, 197, 94, 0.7)' : v >= 20 ? 'rgba(240, 180, 41, 0.7)' : 'rgba(239, 68, 68, 0.7)');
      chartInstances.push(new (window as any).Chart(ctx4, {
        type: 'bar',
        data: { labels: JSON.parse(marginLabels), datasets: [{ label: 'Margin %', data: JSON.parse(marginData), backgroundColor: barColors, borderColor: barColors.map((c: string) => c.replace('0.7', '1')), borderWidth: 1, borderRadius: 3 }] },
        options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, max: 100, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#6b6a66', font: { size: 9 }, callback: (v: any) => v + '%' } }, y: { grid: { display: false }, ticks: { color: '#a09e9a', font: { size: 10 } } } } }
      }));
    }

    const ctx5 = (document.getElementById('chart-lowstock') as HTMLCanvasElement)?.getContext('2d');
    if (ctx5 && lowStockMats.length) {
      chartInstances.push(new (window as any).Chart(ctx5, {
        type: 'bar',
        data: { labels: JSON.parse(lowNames), datasets: [
          { label: 'Current Stock', data: JSON.parse(lowStockData), backgroundColor: 'rgba(245, 158, 11, 0.7)', borderColor: '#f59e0b', borderWidth: 1, borderRadius: 3 },
          { label: 'Reorder Point', data: JSON.parse(lowReorderData), backgroundColor: 'rgba(239, 68, 68, 0.5)', borderColor: '#ef4444', borderWidth: 1, borderRadius: 3 },
        ]},
        options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: '#a09e9a', padding: 16, font: { size: 11 }, usePointStyle: true, pointStyle: 'rectRounded' } } }, scales: { x: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#6b6a66', font: { size: 10 } } }, y: { grid: { display: false }, ticks: { color: '#a09e9a', font: { size: 10 } } } } }
      }));
    }
  }, 50);

  return `
    <div class="dashboard-grid dashboard-summary-grid">
      <div class="dashboard-card card-success">
        <div class="card-label">Today's Collections</div>
        <div class="card-value">${fmtPeso(todaySales)}</div>
        <div class="card-sub">${today}</div>
      </div>
      <div class="dashboard-card card-success">
        <div class="card-label">Today's Profit</div>
        <div class="card-value">${fmtPeso(analytics.todayProfit || 0)}</div>
        <div class="card-sub">Estimated gross profit</div>
      </div>
      <div class="dashboard-card card-danger">
        <div class="card-label">Outstanding</div>
        <div class="card-value">${fmtPeso(outstanding)}</div>
        <div class="card-sub">${invoices.filter((i: Invoice) => i.status === 'pending' || i.status === 'partial').length} unpaid</div>
      </div>
      <div class="dashboard-card card-warning clickable" onclick="document.querySelector('[data-view=materials]')?.click()">
        <div class="card-label">Low Stock Items</div>
        <div class="card-value">${lowStockMats.length}</div>
        <div class="card-sub">Click to view materials</div>
      </div>
      <div class="dashboard-card card-info">
        <div class="card-label">Stock Value</div>
        <div class="card-value" style="font-size:var(--fs-xl)">${fmtPeso(sv.total_cost)}</div>
        <div class="card-sub">Cost: ${fmtPeso(sv.total_cost)} / Retail: ${fmtPeso(sv.total_retail)}</div>
      </div>
      <div class="dashboard-card card-info">
        <div class="card-label">Avg. Margin</div>
        <div class="card-value">${avgMargin.toFixed(1)}%</div>
        <div class="card-sub">${analytics.weekRevenue ? 'Week revenue: ' + fmtPeso(analytics.weekRevenue) : 'Across all materials'}</div>
      </div>
    </div>

    <div class="period-bar">
      <div class="period-item">
        <span class="period-label">This Month</span>
        <span class="period-value">${fmtPeso(mRev.revenue)}</span>
        <span class="period-sub" style="color:${monthChange >= 0 ? 'var(--c-success)' : 'var(--c-danger)'}">${monthChange >= 0 ? '↑' : '↓'} ${Math.abs(monthChange).toFixed(1)}% vs last mo.</span>
      </div>
      <div class="period-divider"></div>
      <div class="period-item">
        <span class="period-label">This Year</span>
        <span class="period-value">${fmtPeso(yRev.revenue)}</span>
        <span class="period-sub">Profit: ${fmtPeso(yRev.profit)}</span>
      </div>
      <div class="period-divider"></div>
      <div class="period-item">
        <span class="period-label">All Time</span>
        <span class="period-value">${fmtPeso(oRev.revenue)}</span>
        <span class="period-sub">Profit: ${fmtPeso(oRev.profit)}</span>
      </div>
      <div class="period-divider"></div>
      <div class="period-item">
        <span class="period-label">Total Invoices</span>
        <span class="period-value">${invoices.length}</span>
        <span class="period-sub">${paidCount} paid, ${pendingCount} pending</span>
      </div>
    </div>

    ${topCust.length ? `
    <div class="top-customers-bar">
      <div style="font-size:var(--fs-sm);font-weight:600;color:var(--c-text-secondary);margin-bottom:var(--space-3)">Top Customers</div>
      ${topCust.map((c: any, i: number) => `
        <div class="tc-item">
          <span class="tc-rank">#${i + 1}</span>
          <span class="tc-name">${esc(c.name)}</span>
          <span class="tc-bar-wrap"><span class="tc-bar" style="width:${Math.min(100, (c.total_paid / Math.max(...topCust.map((x: any) => x.total_paid))) * 100)}%"></span></span>
          <span class="tc-amount">${fmtPeso(c.total_paid)}</span>
        </div>
      `).join('')}
    </div>
    ` : ''}

    <div class="chart-grid">
      <div class="chart-card">
        <div class="chart-title">Revenue & Profit Trend — Last 7 Days</div>
        <canvas id="chart-revenue" height="200"></canvas>
      </div>
      <div class="chart-card">
        <div class="chart-title">Invoice Status</div>
        <canvas id="chart-status" height="200"></canvas>
      </div>
    </div>

    <div class="chart-grid">
      <div class="chart-card">
        <div class="chart-title">Top Selling Materials</div>
        <canvas id="chart-topmats" height="200"></canvas>
      </div>
      <div class="chart-card">
        <div class="chart-title">Margin by Material</div>
        <canvas id="chart-margins" height="200"></canvas>
      </div>
    </div>

    ${lowStockMats.length ? `
    <div class="chart-card full" style="background:var(--c-surface);border:1px solid var(--c-border);border-radius:var(--radius-lg);padding:var(--space-5);margin-bottom:var(--space-6)">
      <div class="chart-title">Low Stock Materials ⚠</div>
      <canvas id="chart-lowstock" height="180"></canvas>
    </div>
    ` : ''}

    <div class="section-heading">Recent Invoices</div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>#</th><th>Customer</th><th>Total</th><th>Status</th><th>Date</th></tr></thead>
        <tbody>
          ${recentInvoices.length ? recentInvoices.map((inv: Invoice) => `
            <tr>
              <td data-label="#" style="font-weight:600">${esc(inv.invoice_number)}</td>
              <td data-label="Customer">${esc(inv.customer_name)}</td>
              <td data-label="Total" style="font-family:var(--ff-mono);font-weight:600">${fmtPeso(Number((inv as any).adjusted_total ?? inv.total))}</td>
              <td data-label="Status"><span class="status-badge ${inv.status}">${inv.status}</span></td>
              <td data-label="Date">${fmtDate(inv.issued_date)}</td>
            </tr>
          `).join('') : '<tr><td colspan="5" style="text-align:center;color:var(--c-text-muted);padding:2rem">No invoices yet — create one to see data here</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}
