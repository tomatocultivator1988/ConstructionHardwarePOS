import { loadView } from './lib/router';
import { closeModal } from './lib/helpers';
import * as customers from './views/customers';
import * as materials from './views/materials';
import * as invoices from './views/invoices';
import { printReceipt } from './views/receipt';
import { saveSettings } from './views/settings';

// ─────────── EXPOSE ALL VIEW FUNCTIONS TO WINDOW ───────────
// Required for backward compatibility with HTML onclick attributes.
// Will be migrated to event delegation in a future phase.

Object.assign(window, {
  closeModal,
  showCustomerModal: customers.showCustomerModal,
  saveCustomer: customers.saveCustomer,
  updateCustomer: customers.updateCustomer,
  editCustomer: customers.editCustomer,
  delCustomer: customers.delCustomer,
  showMaterialModal: materials.showMaterialModal,
  createMaterial: materials.createMaterial,
  updateMaterial: materials.updateMaterial,
  editMaterial: materials.editMaterial,
  delMaterial: materials.delMaterial,
  showInvoiceModal: invoices.showInvoiceModal,
  toggleWalkin: invoices.toggleWalkin,
  addLineItem: invoices.addLineItem,
  createInvoice: invoices.createInvoice,
  showInvoiceDetail: invoices.showInvoiceDetail,
  recordPayment: invoices.recordPayment,
  delInvoice: invoices.delInvoice,
  printReceipt,
  saveSettings,
});

export { loadView };

// Navigation
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    loadView((btn as HTMLElement).dataset.view!);
  });
});

// ─────────── INIT ───────────
loadView('dashboard');
