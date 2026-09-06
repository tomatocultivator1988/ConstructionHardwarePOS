import { renderDashboard } from '../views/dashboard';
import { renderMaterials } from '../views/materials';
import { renderInvoices } from '../views/invoices';
import { renderSettings } from '../views/settings';
import { renderExpenses } from '../views/expenses';
import { renderSupplierHub } from '../views/suppliers';
import { renderReports } from '../views/reports';
import { renderReceipts } from '../views/receipts';
import { renderProductMix } from '../views/product-mix';
import { renderReceivables } from '../views/receivables';
import { showLogin } from '../views/login';
import { isLoggedIn } from './api';
import { showToast } from './helpers';
import { applyRoleUI } from '../main';

const VIEWS: Record<string, () => Promise<string>> = {
  dashboard: renderDashboard,
  materials: renderMaterials,
  'product-mix': renderProductMix,
  receivables: renderReceivables,
  invoices: renderInvoices,
  receipts: renderReceipts,
  expenses: renderExpenses,
  suppliers: renderSupplierHub,
  reports: renderReports,
  settings: renderSettings,
};

export { isLoggedIn };

let chartInstances: any[] = [];
let currentView = '';
let loadSequence = 0;

export function getCurrentView() { return currentView; }

function destroyCharts() {
  chartInstances.forEach(c => { try { c.destroy(); } catch {} });
  chartInstances = [];
}

export function getChartInstances() { return chartInstances; }

export async function loadView(view: string) {
  if (!isLoggedIn()) { showLogin(); return; }

  const currentUser = JSON.parse(localStorage.getItem('buildpro_user') || 'null');
  if (currentUser?.role === 'staff' && view !== 'invoices') { view = 'invoices'; }

  applyRoleUI();

  const u = localStorage.getItem('buildpro_user');
  if (u) {
    const user = JSON.parse(u);
    const el = document.getElementById('header-user');
    const nameEl = document.getElementById('user-name-display');
    if (el) el.style.display = 'flex';
    if (nameEl) nameEl.textContent = user.username + (user.role === 'admin' ? ' (admin)' : '');
  }

  if (currentView === 'dashboard' && view !== 'dashboard') {
    destroyCharts();
  }

  const sequence = ++loadSequence;
  currentView = view;
  const el = document.getElementById('main-content')!;
  el.innerHTML = `<div class="loading-skeleton">${'<div class="sk-item"></div>'.repeat(6)}</div>`;
  try {
    const html = await VIEWS[view]();
    if (sequence !== loadSequence || currentView !== view) return;
    el.innerHTML = html;
    if (view === 'invoices') (window as any).enhancePOS?.();
    if (view === 'receivables') (window as any).drawReceivablesTrend?.();
  } catch (err: any) {
    if (sequence !== loadSequence || currentView !== view) return;
    el.innerHTML = '<div class="loading-skeleton"></div>';
    showToast(err.message || String(err));
  }
}
