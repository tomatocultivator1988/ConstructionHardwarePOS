import { renderDashboard } from '../views/dashboard';
import { renderCustomers } from '../views/customers';
import { renderMaterials } from '../views/materials';
import { renderInvoices } from '../views/invoices';
import { renderSettings } from '../views/settings';
import { renderExpenses } from '../views/expenses';
import { renderSuppliers } from '../views/suppliers';
import { renderPurchaseOrders } from '../views/purchase-orders';
import { renderReports } from '../views/reports';
import { renderReceipts } from '../views/receipts';
import { showLogin } from '../views/login';
import { isLoggedIn } from './api';
import { showToast } from './helpers';
import { applyRoleUI } from '../main';

const VIEWS: Record<string, () => Promise<string>> = {
  dashboard: renderDashboard,
  customers: renderCustomers,
  materials: renderMaterials,
  invoices: renderInvoices,
  receipts: renderReceipts,
  expenses: renderExpenses,
  suppliers: renderSuppliers,
  'purchase-orders': renderPurchaseOrders,
  reports: renderReports,
  settings: renderSettings,
};

export { isLoggedIn };

let chartInstances: any[] = [];
let currentView = '';

export function getCurrentView() { return currentView; }

function destroyCharts() {
  chartInstances.forEach(c => { try { c.destroy(); } catch {} });
  chartInstances = [];
}

export function getChartInstances() { return chartInstances; }

export async function loadView(view: string) {
  if (!isLoggedIn()) { showLogin(); return; }

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

  currentView = view;
  const el = document.getElementById('main-content')!;
  el.innerHTML = `<div class="loading-skeleton">${'<div class="sk-item"></div>'.repeat(6)}</div>`;
  try {
    el.innerHTML = await VIEWS[view]();
  } catch (err: any) {
    el.innerHTML = '<div class="loading-skeleton"></div>';
    showToast(err.message || String(err));
  }
}
