const API = '/api';

const VIEWS: Record<string, () => Promise<string>> = {
  dashboard: renderDashboard,
  customers: renderCustomers,
  materials: renderMaterials,
  invoices: renderInvoices,
  settings: renderSettings,
};

let chartInstances: any[] = [];

function destroyCharts() {
  chartInstances.forEach(c => { try { c.destroy(); } catch {} });
  chartInstances = [];
}

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    loadView((btn as HTMLElement).dataset.view!);
  });
});

async function loadView(view: string) {
  destroyCharts();
  const el = document.getElementById('main-content')!;
  el.innerHTML = `<div class="loading-skeleton">${'<div class="sk-item"></div>'.repeat(6)}</div>`;
  try {
    el.innerHTML = await VIEWS[view]();
  } catch (err: any) {
    el.innerHTML = '<div class="loading-skeleton"></div>';
    showToast(err.message || String(err));
  }
}

// ─────────── HELPERS ───────────

function showToast(msg: string, type: 'error' | 'success' = 'error') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

function showModal(html: string, id: string) {
  document.getElementById(id)?.remove();
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.id = id;
  modal.innerHTML = `<div class="modal-content">${html}</div>`;
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
  document.body.appendChild(modal);
}
function closeModal() { document.querySelectorAll('.modal').forEach(m => m.remove()); }
(window as any).closeModal = closeModal;

function showConfirmModal(html: string): Promise<boolean> {
  return new Promise(resolve => {
    const id = 'confirm-modal';
    document.getElementById(id)?.remove();
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = id;
    modal.innerHTML = `<div class="modal-content">
      ${html}
      <div class="modal-actions">
        <button class="btn" id="confirm-no">Cancel</button>
        <button class="btn btn-primary" id="confirm-yes">Yes</button>
      </div>
    </div>`;
    const cleanup = (r: boolean) => { modal.remove(); resolve(r); };
    modal.addEventListener('click', e => { if (e.target === modal) cleanup(false); });
    document.body.appendChild(modal);
    requestAnimationFrame(() => {
      document.getElementById('confirm-yes')?.addEventListener('click', () => cleanup(true));
      document.getElementById('confirm-no')?.addEventListener('click', () => cleanup(false));
    });
  });
}

function val(id: string) { return (document.getElementById(id) as HTMLInputElement)?.value ?? ''; }

function esc(s: string) {
  if (typeof s !== 'string') s = String(s);
  const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
}

function fmtDate(d: string) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function fmtPeso(n: number) { const v = Number(n); return '₱' + (isNaN(v) ? '0.00' : v.toFixed(2)); }

function setErr(id: string, msg: string) {
  const el = document.getElementById(id);
  if (el) el.textContent = msg;
}
function clearErr(id: string) { setErr(id, ''); }

function disableBtn(id: string, disabled: boolean) {
  const btn = document.getElementById(id) as HTMLButtonElement | null;
  if (btn) btn.disabled = disabled;
}

async function apiGet(path: string) {
  const res = await fetch(API + path);
  if (!res.ok) throw new Error((await res.json()).error || await res.text());
  return res.json();
}
async function apiPost(path: string, body: any) {
  const res = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error((await res.json()).error || await res.text());
  return res.json();
}
async function apiPut(path: string, body: any) {
  const res = await fetch(API + path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error((await res.json()).error || await res.text());
  return res.json();
}
async function apiDel(path: string) {
  const res = await fetch(API + path, { method: 'DELETE' });
  if (!res.ok) throw new Error((await res.json()).error || await res.text());
}

// ─────────── DASHBOARD ───────────

async function renderDashboard(): Promise<string> {
  const [invoices, materials, paySummary, analytics] = await Promise.all([
    apiGet('/invoices'),
    apiGet('/materials'),
    apiGet('/payments/summary'),
    apiGet('/analytics/dashboard'),
  ]);

  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  const todaySales = paySummary.todayTotal || 0;
  const last7: { date: string; label: string; total: number; profit: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const ds = d.toISOString().slice(0, 10);
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
    .filter((i: any) => i.status === 'pending' || i.status === 'partial')
    .reduce((s: number, i: any) => s + (i.total || 0), 0);

  const lowStockMats = materials.filter((m: any) => m.stock <= m.reorder_point);

  const avgMargin = materials.length > 0
    ? materials.reduce((sum: number, m: any) => {
        const margin = m.price_per_unit > 0 ? ((m.price_per_unit - (m.cost_price || 0)) / m.price_per_unit) * 100 : 0;
        return sum + margin;
      }, 0) / materials.length
    : 0;

  const pendingCount = invoices.filter((i: any) => i.status === 'pending').length;
  const partialCount = invoices.filter((i: any) => i.status === 'partial').length;
  const paidCount = invoices.filter((i: any) => i.status === 'paid').length;

  const recentInvoices = invoices.slice(0, 5);

  const sv = analytics.stockValue || { total_cost: 0, total_retail: 0 };
  const topMats = analytics.topMaterials || [];
  const margins = analytics.materialMargins || [];
  const topCust = analytics.topCustomers || [];

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
            {
              label: 'Revenue',
              data: JSON.parse(revData),
              backgroundColor: g,
              borderColor: '#f0b429',
              borderWidth: 2,
              borderRadius: 4,
              borderSkipped: false,
              order: 2,
            },
            {
              label: 'Profit',
              data: JSON.parse(profitData),
              type: 'line',
              fill: true,
              backgroundColor: g2,
              borderColor: '#22c55e',
              borderWidth: 2.5,
              pointBackgroundColor: '#22c55e',
              pointBorderColor: '#1a1b1e',
              pointBorderWidth: 2,
              pointRadius: 4,
              pointHoverRadius: 6,
              tension: 0.3,
              order: 1,
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { intersect: false, mode: 'index' },
          plugins: {
            legend: {
              position: 'top',
              align: 'end',
              labels: { color: '#a09e9a', padding: 16, font: { size: 10, weight: '600' }, usePointStyle: true, pointStyle: 'circle' }
            }
          },
          scales: {
            y: {
              beginAtZero: true,
              grid: { color: 'rgba(255,255,255,0.05)' },
              ticks: { color: '#6b6a66', font: { size: 10 }, callback: (v: any) => '₱' + v.toFixed(0) }
            },
            x: { grid: { display: false }, ticks: { color: '#6b6a66', font: { size: 9 } } }
          }
        }
      }));
    }

    const ctx2 = (document.getElementById('chart-status') as HTMLCanvasElement)?.getContext('2d');
    if (ctx2) {
      chartInstances.push(new (window as any).Chart(ctx2, {
        type: 'doughnut',
        data: {
          labels: ['Pending', 'Partial', 'Paid'],
          datasets: [{
            data: [pendingCount, partialCount, paidCount],
            backgroundColor: ['#ef4444', '#f0b429', '#22c55e'],
            borderColor: '#1a1b1e',
            borderWidth: 3,
            hoverOffset: 8,
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '65%',
          plugins: {
            legend: {
              position: 'bottom',
              labels: { color: '#a09e9a', padding: 16, font: { size: 11 }, usePointStyle: true, pointStyle: 'circle' }
            }
          }
        }
      }));
    }

    const ctx3 = (document.getElementById('chart-topmats') as HTMLCanvasElement)?.getContext('2d');
    if (ctx3 && topMats.length) {
      chartInstances.push(new (window as any).Chart(ctx3, {
        type: 'bar',
        data: {
          labels: JSON.parse(topMatLabels),
          datasets: [
            {
              label: 'Revenue',
              data: JSON.parse(topMatRevenue),
              backgroundColor: 'rgba(240, 180, 41, 0.7)',
              borderColor: '#f0b429',
              borderWidth: 1,
              borderRadius: 3,
            },
            {
              label: 'Profit',
              data: JSON.parse(topMatProfit),
              backgroundColor: 'rgba(34, 197, 94, 0.7)',
              borderColor: '#22c55e',
              borderWidth: 1,
              borderRadius: 3,
            }
          ]
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'top',
              align: 'end',
              labels: { color: '#a09e9a', padding: 12, font: { size: 10 }, usePointStyle: true, pointStyle: 'rectRounded' }
            }
          },
          scales: {
            x: {
              beginAtZero: true,
              grid: { color: 'rgba(255,255,255,0.05)' },
              ticks: { color: '#6b6a66', font: { size: 9 }, callback: (v: any) => '₱' + v.toFixed(0) }
            },
            y: { grid: { display: false }, ticks: { color: '#a09e9a', font: { size: 10 } } }
          }
        }
      }));
    }

    const ctx4 = (document.getElementById('chart-margins') as HTMLCanvasElement)?.getContext('2d');
    if (ctx4 && margins.length) {
      const barColors = JSON.parse(marginData).map((v: number) =>
        v >= 40 ? 'rgba(34, 197, 94, 0.7)' :
        v >= 20 ? 'rgba(240, 180, 41, 0.7)' :
        'rgba(239, 68, 68, 0.7)'
      );
      chartInstances.push(new (window as any).Chart(ctx4, {
        type: 'bar',
        data: {
          labels: JSON.parse(marginLabels),
          datasets: [{
            label: 'Margin %',
            data: JSON.parse(marginData),
            backgroundColor: barColors,
            borderColor: barColors.map((c: string) => c.replace('0.7', '1')),
            borderWidth: 1,
            borderRadius: 3,
          }]
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
          },
          scales: {
            x: {
              beginAtZero: true,
              max: 100,
              grid: { color: 'rgba(255,255,255,0.05)' },
              ticks: { color: '#6b6a66', font: { size: 9 }, callback: (v: any) => v + '%' }
            },
            y: { grid: { display: false }, ticks: { color: '#a09e9a', font: { size: 10 } } }
          }
        }
      }));
    }

    const ctx5 = (document.getElementById('chart-lowstock') as HTMLCanvasElement)?.getContext('2d');
    if (ctx5 && lowStockMats.length) {
      chartInstances.push(new (window as any).Chart(ctx5, {
        type: 'bar',
        data: {
          labels: JSON.parse(lowNames),
          datasets: [
            {
              label: 'Current Stock',
              data: JSON.parse(lowStockData),
              backgroundColor: 'rgba(245, 158, 11, 0.7)',
              borderColor: '#f59e0b',
              borderWidth: 1,
              borderRadius: 3,
            },
            {
              label: 'Reorder Point',
              data: JSON.parse(lowReorderData),
              backgroundColor: 'rgba(239, 68, 68, 0.5)',
              borderColor: '#ef4444',
              borderWidth: 1,
              borderRadius: 3,
            }
          ]
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'bottom',
              labels: { color: '#a09e9a', padding: 16, font: { size: 11 }, usePointStyle: true, pointStyle: 'rectRounded' }
            }
          },
          scales: {
            x: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#6b6a66', font: { size: 10 } } },
            y: { grid: { display: false }, ticks: { color: '#a09e9a', font: { size: 10 } } }
          }
        }
      }));
    }
  }, 50);

  return `
    <div class="dashboard-grid">
      <div class="dashboard-card card-success">
        <div class="card-label">Today's Sales</div>
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
        <div class="card-sub">${invoices.filter((i: any) => i.status === 'pending' || i.status === 'partial').length} unpaid</div>
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

    ${topCust.length ? `
    <div class="top-customers-bar">
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
          ${recentInvoices.length ? recentInvoices.map((inv: any) => `
            <tr>
              <td style="font-weight:600">${esc(inv.invoice_number)}</td>
              <td>${esc(inv.customer_name)}</td>
              <td>${fmtPeso(inv.total)}</td>
              <td><span class="status-badge ${inv.status}">${inv.status}</span></td>
              <td>${fmtDate(inv.issued_date)}</td>
            </tr>
          `).join('') : '<tr><td colspan="5" style="text-align:center;color:var(--c-text-muted);padding:2rem">No invoices yet — create one to see data here</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

// ─────────── CUSTOMERS ───────────

async function renderCustomers(): Promise<string> {
  const customers = await apiGet('/customers');
  (window as any).__customerNames = Object.fromEntries(customers.map((c: any) => [c.id, c.name]));
  return `
    <div class="page-header">
      <h2>Customers</h2>
      <button class="btn btn-primary" onclick="showCustomerModal()">+ Add Customer</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Address</th><th class="actions">Actions</th></tr></thead>
        <tbody>
          ${customers.length ? customers.map((c: any) => `
            <tr>
              <td style="font-weight:600">${esc(c.name)}</td>
              <td>${esc(c.phone || '—')}</td>
              <td>${esc(c.email || '—')}</td>
              <td>${esc(c.address || '—')}</td>
              <td class="actions">
                <button class="btn btn-primary btn-sm" onclick="editCustomer('${c.id}')">Edit</button>
                <button class="btn btn-danger btn-sm" onclick="delCustomer('${c.id}')">Delete</button>
              </td>
            </tr>
          `).join('') : '<tr><td colspan="5" style="text-align:center;color:var(--c-text-muted);padding:2rem">No customers yet</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

(window as any).showCustomerModal = function (data?: any) {
  const isEdit = !!data;
  showModal(`
    <h3>${isEdit ? 'Edit' : 'Add'} Customer</h3>
    <div class="form-group"><label>Name *</label><input id="cf-name" value="${esc(data?.name || '')}" /><div class="field-error" id="cf-name-err"></div></div>
    <div class="form-group"><label>Phone</label><input id="cf-phone" value="${esc(data?.phone || '')}" /></div>
    <div class="form-group"><label>Email</label><input id="cf-email" type="email" value="${esc(data?.email || '')}" /><div class="field-error" id="cf-email-err"></div></div>
    <div class="form-group"><label>Address</label><input id="cf-address" value="${esc(data?.address || '')}" /></div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="cf-save-btn" onclick="${isEdit ? `updateCustomer('${data.id}')` : 'saveCustomer()'}">Save</button>
    </div>
  `, 'customer-modal');
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

(window as any).saveCustomer = async function () {
  clearErr('cf-name-err'); clearErr('cf-email-err');
  const name = val('cf-name');
  const email = val('cf-email');
  if (!name) { setErr('cf-name-err', 'Name is required'); return; }
  if (email && !EMAIL_RE.test(email)) { setErr('cf-email-err', 'Invalid email format'); return; }
  disableBtn('cf-save-btn', true);
  try {
    await apiPost('/customers', { name, phone: val('cf-phone'), email, address: val('cf-address') });
    closeModal();
    loadView('customers');
  } catch (e: any) { showToast(e.message); }
  finally { disableBtn('cf-save-btn', false); }
};

(window as any).delCustomer = async function (id: string) {
  const name = (window as any).__customerNames?.[id] || 'this customer';
  const ok = await showConfirmModal(`<h3>Delete Customer</h3><p style="color:var(--c-text-secondary)">Are you sure you want to delete <strong>${esc(name)}</strong>?</p>`);
  if (!ok) return;
  try { await apiDel(`/customers/${id}`); loadView('customers'); }
  catch (e: any) { showToast(e.message); }
};

(window as any).editCustomer = async function (id: string) {
  const customers = await apiGet('/customers');
  (window as any).showCustomerModal(customers.find((x: any) => x.id === id));
};

(window as any).updateCustomer = async function (id: string) {
  clearErr('cf-name-err'); clearErr('cf-email-err');
  const name = val('cf-name');
  const email = val('cf-email');
  if (!name) { setErr('cf-name-err', 'Name is required'); return; }
  if (email && !EMAIL_RE.test(email)) { setErr('cf-email-err', 'Invalid email format'); return; }
  disableBtn('cf-save-btn', true);
  try {
    await apiPut(`/customers/${id}`, { name, phone: val('cf-phone'), email, address: val('cf-address') });
    closeModal();
    loadView('customers');
  } catch (e: any) { showToast(e.message); }
  finally { disableBtn('cf-save-btn', false); }
};

// ─────────── MATERIALS ───────────

async function renderMaterials(): Promise<string> {
  const materials = await apiGet('/materials');
  (window as any).__materialNames = Object.fromEntries(materials.map((m: any) => [m.id, m.name]));
  return `
    <div class="page-header">
      <h2>Materials</h2>
      <button class="btn btn-primary" onclick="showMaterialModal()">+ Add Material</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Name</th><th>Unit</th><th>Stock</th><th>Cost</th><th>Retail</th><th>Profit</th><th>Margin</th><th class="actions">Actions</th></tr></thead>
        <tbody>
          ${materials.length ? materials.map((m: any) => {
            const isLow = m.stock <= m.reorder_point;
            const profit = m.price_per_unit - (m.cost_price || 0);
            const margin = m.price_per_unit > 0 ? (profit / m.price_per_unit * 100) : 0;
            return `<tr class="${isLow ? 'low-stock' : ''}">
              <td style="font-weight:600">${esc(m.name)}</td>
              <td>${esc(m.unit)}</td>
              <td>${m.stock}${isLow ? ' ⚠' : ''}</td>
              <td>${fmtPeso(m.cost_price || 0)}</td>
              <td>${fmtPeso(m.price_per_unit)}</td>
              <td style="color:${profit > 0 ? 'var(--c-success)' : profit < 0 ? 'var(--c-danger)' : 'var(--c-text-muted)'}">${fmtPeso(profit)}</td>
              <td style="color:${margin > 0 ? 'var(--c-success)' : margin < 0 ? 'var(--c-danger)' : 'var(--c-text-muted)'}">${margin.toFixed(1)}%</td>
              <td class="actions">
                <button class="btn btn-primary btn-sm" onclick="editMaterial('${m.id}')">Edit</button>
                <button class="btn btn-danger btn-sm" onclick="delMaterial('${m.id}')">Delete</button>
              </td>
            </tr>`;
          }).join('') : '<tr><td colspan="8" style="text-align:center;color:var(--c-text-muted);padding:2rem">No materials yet</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

const UNIT_OPTIONS = ['Each', 'Kilogram', 'Meter', 'Roll', 'Gallon', 'Pieces', 'Liter', 'Box', 'Set', 'Bag', 'Pair', 'Sack', 'Bottle', 'Pack'];

function unitOptions(selected?: string) {
  const all = selected && !UNIT_OPTIONS.includes(selected) ? [selected, ...UNIT_OPTIONS] : UNIT_OPTIONS;
  return all.map(u => `<option value="${esc(u)}"${u === selected ? ' selected' : ''}>${esc(u)}</option>`).join('');
}

(window as any).showMaterialModal = function (data?: any) {
  const isEdit = !!data;
  showModal(`
    <h3>${isEdit ? 'Edit' : 'Add'} Material</h3>
    <div class="form-group"><label>Name *</label><input id="mf-name" value="${esc(data?.name || '')}" /><div class="field-error" id="mf-name-err"></div></div>
    <div class="form-row">
      <div class="form-group"><label>Unit *</label>
        <select id="mf-unit"><option value="">Select unit...</option>${unitOptions(data?.unit)}</select>
        <div class="field-error" id="mf-unit-err"></div>
      </div>
      <div class="form-group"><label>Stock</label><input id="mf-stock" type="number" min="0" value="${data?.stock ?? 0}" /><div class="field-error" id="mf-stock-err"></div></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Cost Price</label><input id="mf-cost" type="number" step="0.01" min="0" value="${data?.cost_price ?? ''}" placeholder="0.00" /><div class="field-error" id="mf-cost-err"></div></div>
      <div class="form-group"><label>Retail Price *</label><input id="mf-price" type="number" step="0.01" min="0.01" value="${data?.price_per_unit ?? ''}" /><div class="field-error" id="mf-price-err"></div></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Reorder Point</label><input id="mf-reorder" type="number" min="0" value="${data?.reorder_point ?? 10}" /><div class="field-error" id="mf-reorder-err"></div></div>
    </div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="mf-save-btn" onclick="${isEdit ? `updateMaterial('${data.id}')` : 'createMaterial()'}">Save</button>
    </div>
  `, 'material-modal');
};

(window as any).createMaterial = async function () {
  ['mf-name','mf-unit','mf-price','mf-cost','mf-stock','mf-reorder'].forEach(id => clearErr(id + '-err'));
  const name = val('mf-name'); const unit = val('mf-unit');
  const price = parseFloat(val('mf-price')); const cost = parseFloat(val('mf-cost'));
  const stock = parseFloat(val('mf-stock')); const reorder = parseFloat(val('mf-reorder'));
  if (!name) { setErr('mf-name-err', 'Name required'); return; }
  if (!unit) { setErr('mf-unit-err', 'Unit required'); return; }
  if (isNaN(price) || price <= 0) { setErr('mf-price-err', 'Must be > 0'); return; }
  if (!isNaN(cost) && cost < 0) { setErr('mf-cost-err', 'Cannot be negative'); return; }
  disableBtn('mf-save-btn', true);
  try {
    await apiPost('/materials', { name, unit, stock: stock || 0, cost_price: isNaN(cost) ? 0 : cost, price_per_unit: price, reorder_point: reorder || 10 });
    closeModal(); loadView('materials');
  } catch (e: any) { showToast(e.message); }
  finally { disableBtn('mf-save-btn', false); }
};

(window as any).editMaterial = async function (id: string) {
  const mats = await apiGet('/materials');
  (window as any).showMaterialModal(mats.find((x: any) => x.id === id));
};

(window as any).updateMaterial = async function (id: string) {
  ['mf-name','mf-unit','mf-price','mf-cost','mf-stock','mf-reorder'].forEach(i => clearErr(i + '-err'));
  const name = val('mf-name'); const unit = val('mf-unit');
  const price = parseFloat(val('mf-price')); const cost = parseFloat(val('mf-cost'));
  const stock = parseFloat(val('mf-stock')); const reorder = parseFloat(val('mf-reorder'));
  if (!name) { setErr('mf-name-err', 'Name required'); return; }
  if (!unit) { setErr('mf-unit-err', 'Unit required'); return; }
  if (isNaN(price) || price <= 0) { setErr('mf-price-err', 'Must be > 0'); return; }
  if (!isNaN(cost) && cost < 0) { setErr('mf-cost-err', 'Cannot be negative'); return; }
  disableBtn('mf-save-btn', true);
  try {
    await apiPut(`/materials/${id}`, { name, unit, stock: stock || 0, cost_price: isNaN(cost) ? 0 : cost, price_per_unit: price, reorder_point: reorder || 10 });
    closeModal(); loadView('materials');
  } catch (e: any) { showToast(e.message); }
  finally { disableBtn('mf-save-btn', false); }
};

(window as any).delMaterial = async function (id: string) {
  const name = (window as any).__materialNames?.[id] || 'this material';
  const ok = await showConfirmModal(`<h3>Delete Material</h3><p style="color:var(--c-text-secondary)">Are you sure you want to delete <strong>${esc(name)}</strong>?</p>`);
  if (!ok) return;
  try { await apiDel(`/materials/${id}`); loadView('materials'); }
  catch (e: any) { showToast(e.message); }
};

// ─────────── INVOICES ───────────

async function renderInvoices(): Promise<string> {
  const [invoices, customers, materials, settings] = await Promise.all([
    apiGet('/invoices'),
    apiGet('/customers'),
    apiGet('/materials'),
    apiGet('/settings/default_tax_rate'),
  ]);
  (window as any).__invCustomers = customers;
  (window as any).__invMaterials = materials;
  (window as any).__invDefaultTax = settings.value || '0';
  return `
    <div class="page-header">
      <h2>Invoices</h2>
      <button class="btn btn-primary" onclick="showInvoiceModal()">+ New Invoice</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>#</th><th>Customer</th><th>Total</th><th>Status</th><th>Issued</th><th>Due</th><th class="actions">Actions</th></tr></thead>
        <tbody>
          ${invoices.length ? invoices.map((inv: any) => `
            <tr>
              <td style="font-weight:600">${esc(inv.invoice_number)}</td>
              <td>${esc(inv.customer_name)}</td>
              <td>${fmtPeso(inv.total)}</td>
              <td><span class="status-badge ${inv.status}">${inv.status}</span></td>
              <td>${fmtDate(inv.issued_date)}</td>
              <td>${inv.due_date ? fmtDate(inv.due_date) : '—'}</td>
              <td class="actions">
                <button class="btn btn-success btn-sm" onclick="showInvoiceDetail('${inv.id}')">View</button>
                <button class="btn btn-danger btn-sm" onclick="delInvoice('${inv.id}')">Delete</button>
              </td>
            </tr>
          `).join('') : '<tr><td colspan="7" style="text-align:center;color:var(--c-text-muted);padding:2rem">No invoices yet</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

(window as any).showInvoiceModal = function () {
  const customers = (window as any).__invCustomers || [];
  const materials = (window as any).__invMaterials || [];
  const matOpts = materials.map((m: any) => {
    const cost = m.cost_price || 0;
    const profit = m.price_per_unit - cost;
    return `<option value="${m.id}">${esc(m.name)} (${m.stock} ${esc(m.unit)} — cost ${fmtPeso(cost)} / sell ${fmtPeso(m.price_per_unit)} / +${fmtPeso(profit)})</option>`;
  }).join('');
  showModal(`
    <h3>New Invoice</h3>

    <div class="toggle-group">
      <label>Walk-in / Cash Sale</label>
      <label class="toggle">
        <input type="checkbox" id="inv-walkin" onchange="toggleWalkin()" />
        <span class="slider"></span>
      </label>
      <label>Account Sale</label>
    </div>

    <div class="form-group" id="inv-customer-group">
      <label>Customer</label>
      <select id="inv-customer">
        <option value="">Select customer...</option>
        ${customers.map((c: any) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}
      </select>
      <div class="field-error" id="inv-customer-err"></div>
    </div>

    <h4>Line Items</h4>
    <div id="line-items">
      <div class="line-item">
        <select class="li-mat" style="flex:3">
          <option value="">Select material...</option>
          ${matOpts}
        </select>
        <div style="flex:1;display:flex;flex-direction:column;justify-content:center">
          <input placeholder="Qty" type="number" min="0.01" step="0.01" class="li-qty" />
          <div class="li-err"></div>
        </div>
        <button class="btn btn-danger btn-sm" onclick="this.parentElement.remove()">✕</button>
      </div>
    </div>
    <button class="btn" onclick="addLineItem()" style="margin-bottom:1rem">+ Add Item</button>

    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="inv-create-btn" onclick="createInvoice()">Create Invoice</button>
    </div>
  `, 'invoice-modal');
};

(window as any).toggleWalkin = function () {
  const isWalkin = (document.getElementById('inv-walkin') as HTMLInputElement).checked;
  const group = document.getElementById('inv-customer-group')!;
  group.style.display = isWalkin ? 'none' : '';
};

(window as any).addLineItem = function () {
  const materials = (window as any).__invMaterials || [];
  const matOpts = materials.map((m: any) => {
    const cost = m.cost_price || 0;
    const profit = m.price_per_unit - cost;
    return `<option value="${m.id}">${esc(m.name)} (${m.stock} ${esc(m.unit)} — cost ${fmtPeso(cost)} / sell ${fmtPeso(m.price_per_unit)} / +${fmtPeso(profit)})</option>`;
  }).join('');
  const container = document.getElementById('line-items')!;
  const div = document.createElement('div');
  div.className = 'line-item';
  div.innerHTML = `
    <select class="li-mat" style="flex:3">
      <option value="">Select material...</option>
      ${matOpts}
    </select>
    <div style="flex:1;display:flex;flex-direction:column;justify-content:center">
      <input placeholder="Qty" type="number" min="0.01" step="0.01" class="li-qty" />
      <div class="li-err"></div>
    </div>
    <button class="btn btn-danger btn-sm" onclick="this.parentElement.remove()">✕</button>
  `;
  container.appendChild(div);
};

(window as any).createInvoice = async function () {
  clearErr('inv-customer-err');
  document.querySelectorAll('.li-err').forEach(el => { el.textContent = ''; });
  document.querySelectorAll('.li-qty').forEach(el => el.classList.remove('error'));

  const isWalkin = (document.getElementById('inv-walkin') as HTMLInputElement).checked;
  const customer_id = isWalkin ? null : val('inv-customer');
  if (!isWalkin && !customer_id) { setErr('inv-customer-err', 'Select a customer or enable walk-in mode'); return; }
  const tax_rate = parseFloat((window as any).__invDefaultTax || '0');

  const matList = (window as any).__invMaterials || [];
  let hasStockErr = false;
  const items: any[] = [];

  document.querySelectorAll('.line-item').forEach(el => {
    const material_id = (el.querySelector('.li-mat') as HTMLSelectElement).value;
    const qty = parseFloat((el.querySelector('.li-qty') as HTMLInputElement).value);
    const liErr = el.querySelector('.li-err') as HTMLElement;
    const qtyInput = el.querySelector('.li-qty') as HTMLInputElement;
    if (!material_id || isNaN(qty) || qty <= 0) return;
    const mat = matList.find((m: any) => m.id === material_id);
    if (!mat) return;
    if (qty > mat.stock) {
      hasStockErr = true;
      liErr.textContent = `Only ${mat.stock} ${mat.unit} available`;
      qtyInput.classList.add('error');
      return;
    }
    items.push({ description: mat.name, material_id, quantity: qty, unit_price: mat.price_per_unit });
  });
  if (hasStockErr) return;
  if (!items.length) { showToast('Add at least one valid line item'); return; }

  const subtotal = items.reduce((s: number, i: any) => s + i.quantity * i.unit_price, 0);
  const taxAmount = Math.round(subtotal * tax_rate * 100) / 100;
  const total = subtotal + taxAmount;
  const customerSel = document.getElementById('inv-customer') as HTMLSelectElement;
  const customerName = isWalkin ? 'Walk-in / Cash Sale' : (customerSel?.selectedOptions?.[0]?.text || 'Unknown');

  const confirmHtml = `
    <h3>Confirm Invoice</h3>
    <p style="margin-bottom:var(--space-4);color:var(--c-text-secondary)">Review the details before creating:</p>
    <div class="summary-line"><span>Customer</span><span>${esc(customerName)}</span></div>
    <div class="summary-line"><span>Line Items</span><span>${items.length}</span></div>
    <div class="summary-line"><span>Subtotal</span><span>${fmtPeso(subtotal)}</span></div>
    ${tax_rate > 0 ? `<div class="summary-line"><span>Tax (${(tax_rate*100).toFixed(0)}%)</span><span>${fmtPeso(taxAmount)}</span></div>` : ''}
    <div class="summary-line total"><span>Total</span><span>${fmtPeso(total)}</span></div>
  `;
  if (!(await showConfirmModal(confirmHtml))) return;

  disableBtn('inv-create-btn', true);
  try {
    await apiPost('/invoices', { customer_id, due_date: null, tax_rate, items });
    closeModal();
    loadView('invoices');
  } catch (e: any) { showToast(e.message); }
  finally { disableBtn('inv-create-btn', false); }
};

(window as any).showInvoiceDetail = async function (id: string) {
  const inv = await apiGet(`/invoices/${id}`);
  const totalPaid = inv.payments.reduce((s: number, p: any) => s + p.amount, 0);
  const balance = inv.total - totalPaid;
  const modalId = 'invoice-detail-modal';
  document.getElementById(modalId)?.remove();
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.id = modalId;
  modal.addEventListener('click', e => { if (e.target === modal) { modal.remove(); loadView('invoices'); } });
  document.body.appendChild(modal);
  modal.innerHTML = `<div class="modal-content">
    <h3>Invoice ${esc(inv.invoice_number)}</h3>
    <div style="display:flex;gap:var(--space-4);align-items:center;margin-bottom:var(--space-4);flex-wrap:wrap">
      <span style="color:var(--c-text-secondary)">${esc(inv.customer_name)}</span>
      <span class="status-badge ${inv.status}">${inv.status}</span>
      <span style="font-size:var(--fs-xs);color:var(--c-text-muted)">Issued: ${fmtDate(inv.issued_date)}</span>
      ${inv.due_date ? `<span style="font-size:var(--fs-xs);color:var(--c-text-muted)">Due: ${fmtDate(inv.due_date)}</span>` : ''}
      ${inv.paid_date ? `<span style="font-size:var(--fs-xs);color:var(--c-success)">Paid: ${fmtDate(inv.paid_date)}</span>` : ''}
    </div>

    <h4>Line Items</h4>
    <div class="table-wrap" style="margin-bottom:1rem">
      <table>
        <thead><tr><th>Description</th><th>Qty</th><th>Unit Price</th><th>Total</th></tr></thead>
        <tbody>
          ${inv.items.map((item: any) => `
            <tr><td>${esc(item.description)}</td><td>${item.quantity}</td><td>${fmtPeso(item.unit_price)}</td><td>${fmtPeso(item.total)}</td></tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    <div style="max-width:300px;margin-left:auto">
      <div class="summary-line"><span>Subtotal</span><span>${fmtPeso(inv.subtotal)}</span></div>
      ${Number(inv.tax_rate) > 0 ? `<div class="summary-line"><span>Tax (${(Number(inv.tax_rate)*100).toFixed(0)}%)</span><span>${fmtPeso(inv.tax_amount)}</span></div>` : ''}
      <div class="summary-line total"><span>Total</span><span>${fmtPeso(inv.total)}</span></div>
      <div class="summary-line"><span>Paid</span><span style="color:var(--c-success)">${fmtPeso(totalPaid)}</span></div>
      <div class="summary-line" style="font-weight:600;font-size:var(--fs-lg)"><span>Balance</span><span style="color:${balance > 0 ? 'var(--c-danger)' : 'var(--c-success)'}">${fmtPeso(balance)}</span></div>
    </div>

    ${inv.payments.length ? `
    <h4>Payments</h4>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Date</th><th>Amount</th><th>Method</th><th>Notes</th></tr></thead>
        <tbody>
          ${inv.payments.map((p: any) => `
            <tr><td>${fmtDate(p.payment_date)}</td><td>${fmtPeso(p.amount)}</td><td>${esc(p.method)}</td><td>${esc(p.notes || '—')}</td></tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    ` : ''}

    ${balance > 0 ? `
    <h4>Record Payment</h4>
    <div style="display:flex;gap:0.75rem;align-items:end;flex-wrap:wrap">
      <div class="form-group" style="flex:1;min-width:120px"><label>Amount</label><input id="pay-amount" type="number" step="0.01" min="0.01" max="${balance.toFixed(2)}" value="${balance.toFixed(2)}" /></div>
      <div class="form-group" style="flex:1;min-width:120px"><label>Method</label>
        <select id="pay-method">
          <option value="cash">Cash</option>
          <option value="card">Card</option>
          <option value="check">Check</option>
          <option value="bank">Bank Transfer</option>
        </select>
      </div>
      <div class="form-group" style="flex:1;min-width:120px"><label>Notes</label><input id="pay-notes" /></div>
      <button class="btn btn-success" id="pay-btn" onclick="recordPayment('${inv.id}')" style="margin-bottom:1rem">Pay</button>
    </div>
    <div class="field-error" id="pay-err"></div>
    ` : '<p style="color:var(--c-success);font-weight:600;margin-top:1rem">✓ Paid in Full</p>'}

    <div class="modal-actions">
      <button class="btn btn-primary" onclick="printReceipt('${inv.id}')">🖨 Print Receipt</button>
      <button class="btn" onclick="closeModal();loadView('invoices')">Close</button>
    </div>
  </div>`;
};

(window as any).recordPayment = async function (invoiceId: string) {
  clearErr('pay-err');
  const amount = parseFloat(val('pay-amount'));
  const method = val('pay-method');
  const notes = val('pay-notes');
  if (isNaN(amount) || amount <= 0) { setErr('pay-err', 'Enter a valid amount'); return; }
  const payInput = document.getElementById('pay-amount') as HTMLInputElement;
  const max = parseFloat(payInput?.getAttribute('max') || '0');
  if (max > 0 && amount > max) { setErr('pay-err', `Amount exceeds remaining balance of ${fmtPeso(max)}`); return; }
  const confirmHtml = `
    <h3>Confirm Payment</h3>
    <p style="margin-bottom:var(--space-4);color:var(--c-text-secondary)">Record this payment?</p>
    <div class="summary-line"><span>Amount</span><span>${fmtPeso(amount)}</span></div>
    <div class="summary-line"><span>Method</span><span>${esc(method)}</span></div>
    ${notes ? `<div class="summary-line"><span>Notes</span><span>${esc(notes)}</span></div>` : ''}
  `;
  if (!(await showConfirmModal(confirmHtml))) return;
  disableBtn('pay-btn', true);
  try {
    await apiPost(`/invoices/${invoiceId}/pay`, { amount, method, notes });
    closeModal();
    loadView('invoices');
  } catch (e: any) { showToast(e.message); }
  finally { disableBtn('pay-btn', false); }
};

(window as any).delInvoice = async function (id: string) {
  const ok = await showConfirmModal(`<h3>Delete Invoice</h3><p style="color:var(--c-text-secondary)">Are you sure you want to delete this invoice? Stock will be restored.</p>`);
  if (!ok) return;
  try { await apiDel(`/invoices/${id}`); loadView('invoices'); }
  catch (e: any) { showToast(e.message); }
};

function fmtTime(d: string) {
  if (!d) return '';
  return new Date(d).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

(window as any).printReceipt = async function (id: string) {
  try {
    const inv = await apiGet(`/invoices/${id}`);
    const totalPaid = inv.payments.reduce((s: number, p: any) => s + p.amount, 0);
    const balance = inv.total - totalPaid;

    const printWin = window.open('', '_blank');
    if (!printWin) { showToast('Please allow pop-ups to print receipts'); return; }

    printWin.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Receipt - ${esc(inv.invoice_number)}</title>
        <style>
          @page { margin: 0.5in; }
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: 'Courier New', Courier, monospace;
            font-size: 12px;
            line-height: 1.5;
            color: #000;
            background: #fff;
            padding: 20px;
            max-width: 300px;
            margin: 0 auto;
          }
          .header { text-align: center; margin-bottom: 16px; }
          .header h1 { font-size: 18px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; }
          .header .sub { font-size: 10px; color: #555; }
          .divider { border-top: 1px dashed #000; margin: 8px 0; }
          .info { font-size: 11px; margin-bottom: 8px; }
          .info-row { display: flex; justify-content: space-between; }
          table { width: 100%; border-collapse: collapse; margin: 8px 0; }
          thead th { border-bottom: 1px solid #000; padding: 4px 0; text-align: left; font-size: 10px; text-transform: uppercase; }
          thead th:last-child { text-align: right; }
          thead th:nth-child(2) { text-align: center; }
          thead th:nth-child(3) { text-align: right; }
          tbody td { padding: 3px 0; font-size: 11px; vertical-align: top; }
          tbody td:last-child { text-align: right; white-space: nowrap; }
          tbody td:nth-child(2) { text-align: center; }
          tbody td:nth-child(3) { text-align: right; }
          .qty-cell { text-align: center; white-space: nowrap; }
          .totals { margin-top: 4px; }
          .totals .row { display: flex; justify-content: space-between; font-size: 11px; padding: 2px 0; }
          .totals .grand-total { font-size: 14px; font-weight: 800; border-top: 1px double #000; padding-top: 4px; margin-top: 4px; }
          .payment-info { margin: 8px 0; font-size: 11px; }
          .footer { text-align: center; margin-top: 16px; font-size: 10px; color: #555; border-top: 1px dashed #000; padding-top: 8px; }
          .status-tag { text-transform: uppercase; font-weight: 700; letter-spacing: 1px; }
          @media print {
            body { padding: 0; }
            .no-print { display: none; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>Construction POS</h1>
          <div class="sub">Official Receipt</div>
        </div>

        <div class="divider"></div>

        <div class="info">
          <div class="info-row"><span>Receipt #</span><strong>${esc(inv.invoice_number)}</strong></div>
          <div class="info-row"><span>Date</span><span>${fmtDate(inv.issued_date)} ${fmtTime(inv.issued_date)}</span></div>
          <div class="info-row"><span>Customer</span><strong>${esc(inv.customer_name)}</strong></div>
          ${inv.status !== 'pending' ? `<div class="info-row"><span>Status</span><span class="status-tag">${inv.status.toUpperCase()}</span></div>` : ''}
        </div>

        <div class="divider"></div>

        <table>
          <thead>
            <tr><th style="width:50%">Item</th><th style="width:15%">Qty</th><th style="width:17%">Price</th><th style="width:18%">Total</th></tr>
          </thead>
          <tbody>
            ${inv.items.map((item: any) => `
              <tr>
                <td>${esc(item.description)}</td>
                <td class="qty-cell">${item.quantity}</td>
                <td>${fmtPeso(item.unit_price)}</td>
                <td>${fmtPeso(item.total)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <div class="divider"></div>

        <div class="totals">
          <div class="row"><span>Subtotal</span><span>${fmtPeso(inv.subtotal)}</span></div>
          ${Number(inv.tax_rate) > 0 ? `<div class="row"><span>Tax (${(Number(inv.tax_rate)*100).toFixed(0)}%)</span><span>${fmtPeso(inv.tax_amount)}</span></div>` : ''}
          <div class="row grand-total"><span>Total</span><span>${fmtPeso(inv.total)}</span></div>
        </div>

        <div class="divider"></div>

        <div class="payment-info">
          <div class="row"><span>Amount Paid</span><span>${fmtPeso(totalPaid)}</span></div>
          <div class="row" style="font-weight:700;font-size:13px"><span>Balance</span><span>${fmtPeso(balance)}</span></div>
          ${inv.payments.length ? `
            <div style="margin-top:6px;font-size:10px;color:#555">
              ${inv.payments.map((p: any) => `${fmtDate(p.payment_date)} — ${esc(p.method)} ${fmtPeso(p.amount)}${p.notes ? ' (' + esc(p.notes) + ')' : ''}`).join('<br>')}
            </div>
          ` : ''}
        </div>

        <div class="divider"></div>

        <div class="footer">
          <p>Thank you for your business!</p>
          <p style="margin-top:4px;font-size:9px">${fmtDate(new Date().toISOString())}</p>
        </div>

        <div class="no-print" style="text-align:center;margin-top:20px">
          <button onclick="window.print()" style="padding:8px 24px;font-size:14px;cursor:pointer">Print / Save PDF</button>
          <p style="margin-top:8px;font-size:10px;color:#888">Or use Ctrl+P / Cmd+P</p>
        </div>

        <script>setTimeout(function() { window.print(); }, 500);<\/script>
      </body>
      </html>
    `);
    printWin.document.close();
  } catch (e: any) {
    showToast(e.message);
  }
};

// ─────────── SETTINGS ───────────

async function renderSettings(): Promise<string> {
  const settings = await apiGet('/settings/default_tax_rate');
  return `
    <div class="page-header">
      <h2>Settings</h2>
    </div>
    <div class="settings-card">
      <h3 style="margin-bottom:var(--space-4)">Invoice Defaults</h3>
      <div class="form-group">
        <label>Default Tax Rate</label>
        <input id="s-tax" type="number" step="0.01" min="0" max="1" value="${settings.value || '0'}" />
        <div class="helper">Decimal value (0.12 = 12%). Applied to new invoices by default.</div>
        <div class="field-error" id="s-tax-err"></div>
      </div>
      <button class="btn btn-primary" id="s-save-btn" onclick="saveSettings()">Save Settings</button>
    </div>
  `;
}

(window as any).saveSettings = async function () {
  clearErr('s-tax-err');
  const tax = parseFloat(val('s-tax'));
  if (isNaN(tax) || tax < 0 || tax > 1) { setErr('s-tax-err', 'Enter a valid rate between 0 and 1'); return; }
  disableBtn('s-save-btn', true);
  try {
    await apiPut('/settings/default_tax_rate', { value: String(tax) });
    setErr('s-tax-err', '');
    const label = document.querySelector('#s-save-btn')!;
    label.textContent = 'Saved ✓';
    setTimeout(() => { label.textContent = 'Save Settings'; }, 2000);
  } catch (e: any) { showToast(e.message); }
  finally { disableBtn('s-save-btn', false); }
};

// ─────────── INIT ───────────
loadView('dashboard');
