import { loadView } from './lib/router';
import { closeModal, isAdmin } from './lib/helpers';
import { isLoggedIn, apiGet, getCurrentUser } from './lib/api';
import * as customers from './views/customers';
import * as materials from './views/materials';
import * as invoices from './views/invoices';
import * as expenses from './views/expenses';
import * as suppliers from './views/suppliers';
import * as purchaseOrders from './views/purchase-orders';
import * as reports from './views/reports';
import * as login from './views/login';
import * as settings from './views/settings';
import { printReceipt } from './views/receipt';

Object.assign(window, {
  closeModal,
  logout: login.logout,
  doLogin: login.doLogin,
  showCustomerModal: customers.showCustomerModal,
  saveCustomer: customers.saveCustomer,
  updateCustomer: customers.updateCustomer,
  editCustomer: customers.editCustomer,
  delCustomer: customers.delCustomer,
  showCustomerStatement: customers.showCustomerStatement,
  changeCustomerPage: customers.changeCustomerPage,
  toggleCustomerDetails: customers.toggleCustomerDetails,
  showMaterialModal: materials.showMaterialModal,
  createMaterial: materials.createMaterial,
  updateMaterial: materials.updateMaterial,
  editMaterial: materials.editMaterial,
  delMaterial: materials.delMaterial,
  filterMaterials: materials.filterMaterials,
  showStockHistory: materials.showStockHistory,
  changeMaterialPage: materials.changeMaterialPage,
  toggleMobileDetails: materials.toggleMobileDetails,
  showInvoiceModal: invoices.showInvoiceModal,
  toggleWalkin: invoices.toggleWalkin,
  addLineItem: invoices.addLineItem,
  createInvoice: invoices.createInvoice,
  showInvoiceDetail: invoices.showInvoiceDetail,
  recordPayment: invoices.recordPayment,
  delInvoice: invoices.delInvoice,
  changeInvoicePage: invoices.changeInvoicePage,
  returnItems: invoices.returnItems,
  voidInvoice: invoices.voidInvoice,
  issueCreditMemo: invoices.issueCreditMemo,
  recordRefund: invoices.recordRefund,
  showExpenseModal: expenses.showExpenseModal,
  createExpense: expenses.createExpense,
  updateExpense: expenses.updateExpense,
  editExpense: expenses.editExpense,
  delExpense: expenses.delExpense,
  showSupplierModal: suppliers.showSupplierModal,
  createSupplier: suppliers.createSupplier,
  updateSupplier: suppliers.updateSupplier,
  editSupplier: suppliers.editSupplier,
  delSupplier: suppliers.delSupplier,
  showPOModal: purchaseOrders.showPOModal,
  addPOLineItem: purchaseOrders.addPOLineItem,
  poMaterialChanged: purchaseOrders.poMaterialChanged,
  removePOLineItem: purchaseOrders.removePOLineItem,
  createPO: purchaseOrders.createPO,
  showPODetail: purchaseOrders.showPODetail,
  receivePO: purchaseOrders.receivePO,
  cancelPO: purchaseOrders.cancelPO,
  delPO: purchaseOrders.delPO,
  switchReportTab: reports.switchReportTab,
  reloadDaily: reports.reloadDaily,
  reloadMonthly: reports.reloadMonthly,
  reloadTax: reports.reloadTax,
  loadRangeReport: reports.loadRangeReport,
  printReport: reports.printReport,
  reloadBooks: reports.reloadBooks,
  switchSettingsTab: settings.switchSettingsTab,
  saveSettings: settings.saveSettings,
  openCashierShift: settings.openCashierShift,
  closeCashierShift: settings.closeCashierShift,
  showUserModal: settings.showUserModal,
  createUser: settings.createUser,
  updateUser: settings.updateUser,
  delUser: settings.delUser,
  printReceipt,
  checkLowStock: () => checkLowStock(),
  openMobileMore,
});

// Navigation — desktop
document.querySelectorAll('#desktop-nav .nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const view = (btn as HTMLElement).dataset.view!;
    if (view !== '__more') loadView(view);
    if ((btn as HTMLElement).dataset.view === 'dashboard') checkLowStock();
  });
});

// Navigation — bottom nav
document.querySelectorAll('#bottom-nav .nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const view = (btn as HTMLElement).dataset.view!;
    if (view !== '__more') loadView(view);
    if ((btn as HTMLElement).dataset.view === 'dashboard') checkLowStock();
  });
});

// Online/offline detection
function updateOnlineStatus() {
  document.body.classList.toggle('offline', !navigator.onLine);
}
window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);
updateOnlineStatus();

// PWA install prompt
let deferredPrompt: any;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;
  document.body.classList.add('show-install');
});
window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  document.body.classList.remove('show-install');
});
document.getElementById('install-btn')?.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  const result = await deferredPrompt.userChoice;
  if (result.outcome === 'accepted') {
    deferredPrompt = null;
    document.body.classList.remove('show-install');
  }
});
document.getElementById('install-dismiss')?.addEventListener('click', () => {
  deferredPrompt = null;
  document.body.classList.remove('show-install');
});

// Service worker registration
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

export function applyRoleUI() {
  const admin = isAdmin();
  document.body.classList.toggle('staff-user', !admin);
  const adminTabs = ['reports', 'settings'];
  adminTabs.forEach(view => {
    const btn = document.querySelector(`[data-view="${view}"]`) as HTMLElement;
    if (btn) btn.style.display = admin ? '' : 'none';
  });
}

function openMobileMore() {
  const options = [['expenses', 'Expenses'], ['suppliers', 'Suppliers'], ['purchase-orders', 'Purchase Orders'], ...(isAdmin() ? [['reports', 'Reports'], ['settings', 'Settings']] : [])];
  const modal = document.createElement('div');
  modal.className = 'modal'; modal.id = 'mobile-more-modal';
  modal.innerHTML = `<div class="modal-content"><h3>More</h3><div class="mobile-more-menu">${options.map(([view, label]) => `<button class="btn mobile-more-option" onclick="closeModal();loadView('${view}')">${label}<span>›</span></button>`).join('')}</div><div class="modal-actions"><button class="btn" onclick="closeModal()">Close</button></div></div>`;
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);
}

// Init
if (isLoggedIn()) {
  applyRoleUI();
  loadView('dashboard');
  checkLowStock();
  showUserHeader();
} else {
  login.showLogin();
}

function showUserHeader() {
  const user = getCurrentUser();
  if (!user) return;
  const el = document.getElementById('header-user');
  const nameEl = document.getElementById('user-name-display');
  if (el) el.style.display = 'flex';
  if (nameEl) nameEl.textContent = user.username + (user.role === 'admin' ? ' (admin)' : '');
}

async function checkLowStock() {
  try {
    const materials = await apiGet<any[]>('/materials');
    const low = materials.filter((m: any) => m.stock <= m.reorder_point);
    const badge = document.querySelector('[data-view="materials"]');
    if (badge) {
      const existing = badge.querySelector('.nav-badge');
      if (existing) existing.remove();
      if (low.length > 0) {
        const b = document.createElement('span');
        b.className = 'nav-badge';
        b.textContent = String(low.length);
        badge.appendChild(b);
        // showToast is used here but was never imported in original — leaving as-is
      }
    }
  } catch {}
}
