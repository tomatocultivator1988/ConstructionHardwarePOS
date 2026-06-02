import { renderDashboard } from '../views/dashboard';
import { renderCustomers } from '../views/customers';
import { renderMaterials } from '../views/materials';
import { renderInvoices } from '../views/invoices';
import { renderSettings } from '../views/settings';
import { showToast } from './helpers';

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

export function getChartInstances() { return chartInstances; }

export async function loadView(view: string) {
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
