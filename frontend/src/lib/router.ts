import { renderDashboard } from '../views/dashboard';
import { renderMaterials } from '../views/materials';
import { renderInvoices } from '../views/invoices';
import { renderSettings } from '../views/settings';
import { renderExpenses } from '../views/expenses';
import { renderSupplierHub, setSupplierTab } from '../views/suppliers';
import { renderReports } from '../views/reports';
import { renderReceipts } from '../views/receipts';
import { renderProductMix } from '../views/product-mix';
import { renderReceivables } from '../views/receivables';
import { renderDeliveries } from '../views/deliveries';
import { renderCustomers } from '../views/customers';
import { showLogin } from '../views/login';
import { isLoggedIn, apiGet } from './api';
import { showToast } from './helpers';
import { applyRoleUI } from '../main';

const VIEWS: Record<string, () => Promise<string>> = {
  dashboard: renderDashboard,
  materials: renderMaterials,
  'product-mix': renderProductMix,
  receivables: renderReceivables,
  invoices: renderInvoices,
  receipts: renderReceipts,
  sales: renderReceipts,
  deliveries: renderDeliveries,
  expenses: renderExpenses,
  suppliers: async () => { setSupplierTab('suppliers'); return renderSupplierHub(); },
  'purchase-orders': async () => { setSupplierTab('purchase-orders'); return renderSupplierHub(); },
  customers: renderCustomers,
  reports: renderReports,
  settings: renderSettings,
};

export { isLoggedIn };

let chartInstances: any[] = [];
let currentView = '';
let loadSequence = 0;

export function getCurrentView() { return currentView; }

function syncActiveNavigation(view: string) {
  const activeNav = view === 'purchase-orders' ? 'suppliers' : (view === 'receipts' ? 'sales' : view);
  document.querySelectorAll<HTMLElement>('#desktop-nav .nav-btn, #bottom-nav .nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === activeNav || (activeNav === 'sales' && (btn.dataset.view === 'sales' || btn.dataset.view === 'receipts')));
  });
}

export function destroyCharts() {
  chartInstances.forEach(c => { try { c.destroy(); } catch {} });
  chartInstances = [];
}

export function getChartInstances() { return chartInstances; }

export async function loadView(view: string) {
  if (!isLoggedIn()) { showLogin(); return; }

  const currentUser = JSON.parse(localStorage.getItem('buildpro_user') || 'null');
  if (currentUser?.role === 'staff' && view !== 'invoices') { view = 'invoices'; }
  if (currentUser?.role === 'staff' && view === 'invoices') {
    try {
      const shift = await apiGet<any>(`/shifts/current?_=${Date.now()}`);
      if (!shift) { showToast('Your shift is closed. Please contact the admin.'); (window as any).logout?.(); return; }
    } catch { /* The POS view will show the normal retry/error state if the session is unavailable. */ }
  }

  // Safe routing alias resolution and fallback to prevent undefined view function crashes
  let targetView = view;
  if (!VIEWS[targetView]) {
    if (targetView === 'po' || targetView === 'purchase-order') targetView = 'purchase-orders';
    else if (targetView === 'customer') targetView = 'customers';
    else if (targetView === 'supplier') targetView = 'suppliers';
    else if (targetView === 'pos') targetView = 'invoices';
    else if (targetView === 'products') targetView = 'materials';
    else if (targetView === 'sales-history') targetView = 'sales';
    else {
      console.warn(`View "${view}" not found in router. Falling back to dashboard.`);
      targetView = 'dashboard';
    }
  }

  applyRoleUI();
  syncActiveNavigation(targetView);

  const u = localStorage.getItem('buildpro_user');
  if (u) {
    const user = JSON.parse(u);
    const el = document.getElementById('header-user');
    const nameEl = document.getElementById('user-name-display');
    if (el) el.style.display = 'flex';
    if (nameEl) nameEl.textContent = user.username + (user.role === 'admin' ? ' (admin)' : '');
  }

  if (currentView === 'dashboard') {
    destroyCharts();
  }

  const previousView = currentView;
  const sequence = ++loadSequence;
  currentView = targetView;
  const el = document.getElementById('main-content')!;
  if (previousView !== targetView || !el.innerHTML.trim()) {
    el.innerHTML = `<div class="loading-skeleton">${'<div class="sk-item"></div>'.repeat(6)}</div>`;
  }
  try {
    const viewFn = VIEWS[targetView];
    if (typeof viewFn !== 'function') {
      throw new Error(`View handler for "${targetView}" is not a function.`);
    }
    const html = await viewFn();
    if (sequence !== loadSequence || currentView !== targetView) return;
    if (!isLoggedIn()) {
      showLogin();
      return;
    }
    el.innerHTML = html;
    if (targetView === 'invoices') (window as any).enhancePOS?.();
    if (targetView === 'receivables') (window as any).drawReceivablesTrend?.();
  } catch (err: any) {
    if (sequence !== loadSequence || currentView !== targetView) return;
    if (!isLoggedIn() || /session expired|login/i.test(err?.message || '')) {
      showLogin();
      return;
    }
    const isOffline = !navigator.onLine || /failed to fetch|network|offline|abort|load failed/i.test(err?.message || '');
    if (isOffline) {
      el.innerHTML = `<div class="empty-state view-error" style="max-width:540px;margin:var(--space-6) auto;padding:var(--space-6);background:var(--c-surface);border:1px solid var(--c-border);border-radius:var(--radius-lg);box-shadow:var(--shadow-sm)">
        <div style="font-size:3rem;margin-bottom:var(--space-2)">📡</div>
        <h3 style="margin-bottom:var(--space-2)">You're currently offline</h3>
        <p style="color:var(--c-text-secondary);line-height:1.5;margin:0 0 var(--space-4)">
          The <strong>${targetView}</strong> section requires an active cloud connection.
          However, the <strong>Point of Sale (POS)</strong> is fully active offline so you can ring up sales, take cash, and print receipts right now.
        </p>
        <div style="display:flex;gap:var(--space-2);justify-content:center;flex-wrap:wrap">
          <button class="btn btn-primary" onclick="loadView('invoices')" style="font-weight:700">🛒 Open POS Cashier</button>
          <button class="btn btn-outline" onclick="loadView('${targetView}')">↻ Retry</button>
        </div>
      </div>`;
      return;
    }
    el.innerHTML = `<div class="empty-state view-error">
      <h3>Unable to load ${targetView === 'dashboard' ? 'Dashboard' : targetView}</h3>
      <p>${err.message || 'Please try again.'}</p>
      <div style="display:flex;gap:var(--space-2);justify-content:center;margin-top:var(--space-3)">
        <button class="btn btn-primary" onclick="loadView('${targetView}')">Retry</button>
        ${targetView !== 'dashboard' ? `<button class="btn" onclick="loadView('dashboard')">Go to Dashboard</button>` : `<button class="btn" onclick="loadView('invoices')">Go to POS</button>`}
      </div>
    </div>`;
    showToast(err.message || String(err));
  }
}
