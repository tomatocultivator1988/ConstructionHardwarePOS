import { Material } from './types';
import { apiGet, apiPost, isLoggedIn, getCurrentUser } from './api';
import { showToast } from './helpers';

const DB_NAME = 'buildpro_pos_offline';
const DB_VERSION = 1;

export interface OfflineSaleItem {
  material_id: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  unit: string;
  stock_multiplier: number;
}

export interface OfflineSaleRecord {
  id: string; // UUID used as idempotency key and local identifier
  offline_reference: string; // e.g. "OFF-20261003-1234"
  created_at: string;
  customer_id: string | null;
  credit_account_name: string | null;
  buyer_address: string | null;
  notes: string | null;
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  discount_amount: number;
  total: number;
  items: OfflineSaleItem[];
  payment: {
    amount: number;
    received_amount: number;
    method: string;
    notes?: string;
  };
  shift_id: string | null;
  user_id: string | null;
  status: 'pending' | 'syncing' | 'synced' | 'failed';
  error_message?: string;
  synced_invoice_number?: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;

export function openOfflineDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB is not supported in this browser'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      if (!db.objectStoreNames.contains('catalog_materials')) {
        db.createObjectStore('catalog_materials', { keyPath: 'id' });
      }

      if (!db.objectStoreNames.contains('catalog_settings')) {
        db.createObjectStore('catalog_settings', { keyPath: 'key' });
      }

      if (!db.objectStoreNames.contains('offline_sales_queue')) {
        const store = db.createObjectStore('offline_sales_queue', { keyPath: 'id' });
        store.createIndex('status', 'status', { unique: false });
        store.createIndex('created_at', 'created_at', { unique: false });
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
  });

  return dbPromise;
}

// -------------------------------------------------------------
// Catalog Cache
// -------------------------------------------------------------

export async function cacheMaterials(materials: Material[]): Promise<void> {
  try {
    const db = await openOfflineDB();
    const tx = db.transaction('catalog_materials', 'readwrite');
    const store = tx.objectStore('catalog_materials');
    store.clear();
    for (const m of materials) {
      store.put(m);
    }
  } catch (err) {
    console.warn('Failed to cache materials to IndexedDB:', err);
  }
}

export async function precacheCatalog(): Promise<void> {
  if (!navigator.onLine || !isLoggedIn()) return;
  try {
    const [fetchedMaterials, fetchedSettings] = await Promise.all([
      apiGet<Material[]>('/materials'),
      apiGet<{ value: string }>('/settings/default_tax_rate'),
    ]);
    const list = Array.isArray(fetchedMaterials) ? fetchedMaterials : ((fetchedMaterials as any)?.data || []);
    if (Array.isArray(list) && list.length) {
      await cacheMaterials(list);
    }
    if (fetchedSettings?.value !== undefined) {
      await cacheSetting('default_tax_rate', fetchedSettings.value);
    }
  } catch (err) {
    console.debug('Background catalog pre-caching skipped:', err);
  }
}

export async function getCachedMaterials(): Promise<Material[]> {
  try {
    const db = await openOfflineDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('catalog_materials', 'readonly');
      const store = tx.objectStore('catalog_materials');
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('Failed to read cached materials from IndexedDB:', err);
    return [];
  }
}

export async function cacheSetting(key: string, value: any): Promise<void> {
  try {
    const db = await openOfflineDB();
    const tx = db.transaction('catalog_settings', 'readwrite');
    const store = tx.objectStore('catalog_settings');
    store.put({ key, value });
  } catch (err) {
    console.warn('Failed to cache setting:', key, err);
  }
}

export async function getCachedSetting(key: string, fallback: any = null): Promise<any> {
  try {
    const db = await openOfflineDB();
    return new Promise((resolve) => {
      const tx = db.transaction('catalog_settings', 'readonly');
      const store = tx.objectStore('catalog_settings');
      const req = store.get(key);
      req.onsuccess = () => {
        resolve(req.result ? req.result.value : fallback);
      };
      req.onerror = () => resolve(fallback);
    });
  } catch {
    return fallback;
  }
}

export async function deductCachedStock(items: Array<{ material_id?: string | null; quantity: number; stockMultiplier?: number; stock_multiplier?: number }>): Promise<void> {
  // 1. Immediately update in-memory materials cache so POS cards reflect the reduction instantly
  const memMaterials = (window as any).__invMaterials as Material[] | undefined;
  if (Array.isArray(memMaterials)) {
    for (const it of items) {
      if (!it.material_id) continue;
      const memMat = memMaterials.find(m => m.id === it.material_id);
      if (memMat) {
        const mult = it.stockMultiplier ?? it.stock_multiplier ?? 1;
        const qtyNeeded = it.quantity * mult;
        memMat.stock = Math.max(0, Math.round((Number(memMat.stock || 0) - qtyNeeded) * 1000) / 1000);
      }
    }
  }

  // 2. Persist to IndexedDB
  try {
    const db = await openOfflineDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('catalog_materials', 'readwrite');
      const store = tx.objectStore('catalog_materials');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);

      for (const it of items) {
        if (!it.material_id) continue;
        const getReq = store.get(it.material_id);
        getReq.onsuccess = () => {
          const mat = getReq.result as Material | undefined;
          if (mat) {
            const mult = it.stockMultiplier ?? it.stock_multiplier ?? 1;
            const qtyNeeded = it.quantity * mult;
            mat.stock = Math.max(0, Math.round((Number(mat.stock || 0) - qtyNeeded) * 1000) / 1000);
            store.put(mat);
          }
        };
      }
    });
  } catch (err) {
    console.warn('Failed to deduct cached stock in IndexedDB:', err);
  }
}

// -------------------------------------------------------------
// Offline Sales Queue
// -------------------------------------------------------------

export function generateOfflineReference(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `OFF-${yyyy}${mm}${dd}-${rand}`;
}

export async function queueOfflineSale(data: Omit<OfflineSaleRecord, 'id' | 'status' | 'created_at'> & { id?: string }): Promise<OfflineSaleRecord> {
  const db = await openOfflineDB();
  const saleRecord: OfflineSaleRecord = {
    id: data.id || (typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`),
    offline_reference: data.offline_reference || generateOfflineReference(),
    created_at: new Date().toISOString(),
    customer_id: data.customer_id || null,
    credit_account_name: data.credit_account_name || null,
    buyer_address: data.buyer_address || null,
    notes: data.notes || null,
    subtotal: data.subtotal,
    tax_rate: data.tax_rate,
    tax_amount: data.tax_amount,
    discount_amount: data.discount_amount,
    total: data.total,
    items: data.items,
    payment: data.payment,
    shift_id: data.shift_id || localStorage.getItem('buildpro_active_shift_id') || null,
    user_id: data.user_id || getCurrentUser()?.id || null,
    status: 'pending',
  };

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('offline_sales_queue', 'readwrite');
    const store = tx.objectStore('offline_sales_queue');
    const req = store.put(saleRecord);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });

  // Deduct local stock immediately for all items in this sale
  await deductCachedStock(data.items);

  updateOfflineStatusUI();
  return saleRecord;
}

export async function getPendingOfflineSales(): Promise<OfflineSaleRecord[]> {
  try {
    const db = await openOfflineDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('offline_sales_queue', 'readonly');
      const store = tx.objectStore('offline_sales_queue');
      const req = store.getAll();
      req.onsuccess = () => {
        const all = (req.result || []) as OfflineSaleRecord[];
        const pending = all.filter(s => s.status === 'pending' || s.status === 'failed');
        resolve(pending);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function getPendingOfflineCount(): Promise<number> {
  const pending = await getPendingOfflineSales();
  return pending.length;
}

export async function markOfflineSaleSynced(saleId: string, invoiceNumber: string): Promise<void> {
  const db = await openOfflineDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('offline_sales_queue', 'readwrite');
    const store = tx.objectStore('offline_sales_queue');
    // Remove completed items to keep queue tidy, or we can update status
    const req = store.delete(saleId);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
  updateOfflineStatusUI();
}

// -------------------------------------------------------------
// Sync Engine
// -------------------------------------------------------------

let isSyncing = false;

export async function syncOfflineSales(): Promise<{ success: boolean; syncedCount: number; errors: string[] }> {
  if (isSyncing) return { success: true, syncedCount: 0, errors: [] };
  if (!navigator.onLine || !isLoggedIn()) return { success: false, syncedCount: 0, errors: ['Offline or not logged in'] };

  const pendingSales = await getPendingOfflineSales();
  if (!pendingSales.length) {
    updateOfflineStatusUI();
    return { success: true, syncedCount: 0, errors: [] };
  }

  isSyncing = true;
  updateOfflineStatusUI(true);

  let syncedCount = 0;
  const errors: string[] = [];

  try {
    const res = await apiPost<any>('/invoices/sync-offline', { sales: pendingSales });
    const syncedList = Array.isArray(res?.synced) ? res.synced : [];
    const errorList = Array.isArray(res?.errors) ? res.errors : [];

    for (const item of syncedList) {
      await markOfflineSaleSynced(item.id, item.invoice_number);
      syncedCount++;
    }

    for (const err of errorList) {
      errors.push(`${err.offline_reference || err.id}: ${err.error}`);
    }

    if (syncedCount > 0) {
      showToast(`Synced ${syncedCount} offline sale${syncedCount === 1 ? '' : 's'} to server`, 'success');
      // If cashier is currently on POS, refresh materials from server
      if (typeof (window as any).renderInvoices === 'function') {
        const currentView = document.querySelector('.pos-page');
        if (currentView) {
          (window as any).loadView?.('invoices');
        }
      }
    }

    if (errors.length > 0) {
      showToast(`Sync issue: ${errors[0]}`, 'warning');
    }
  } catch (err: any) {
    errors.push(err.message || 'Sync failed');
    showToast(`Offline sync failed: ${err.message || 'Network error'}`, 'warning');
  } finally {
    isSyncing = false;
    updateOfflineStatusUI();
  }

  return { success: errors.length === 0, syncedCount, errors };
}

// -------------------------------------------------------------
// UI Updates
// -------------------------------------------------------------

export async function updateOfflineStatusUI(syncInProgress = false) {
  const isOnline = navigator.onLine;
  const count = await getPendingOfflineCount();

  document.body.classList.toggle('offline', !isOnline);

  const bannerText = document.getElementById('offline-banner-text');
  const syncBtn = document.getElementById('offline-sync-btn') as HTMLElement | null;

  if (bannerText) {
    if (!isOnline) {
      bannerText.textContent = count > 0
        ? `You're offline — ${count} sale${count === 1 ? '' : 's'} queued locally. Will auto-sync when online.`
        : `You're offline — viewing cached catalog. New sales will queue locally.`;
    } else if (count > 0) {
      bannerText.textContent = syncInProgress
        ? `Online — Syncing ${count} offline sale${count === 1 ? '' : 's'} to server...`
        : `Online — ${count} offline sale${count === 1 ? '' : 's'} pending sync.`;
    }
  }

  if (syncBtn) {
    syncBtn.style.display = isOnline && count > 0 && !syncInProgress ? 'inline-block' : 'none';
  }

  const posShortcut = document.getElementById('offline-pos-shortcut') as HTMLElement | null;
  if (posShortcut) {
    const isPOSActive = document.querySelector('.pos-page') !== null;
    posShortcut.style.display = !isOnline && !isPOSActive ? 'inline-block' : 'none';
  }

  // Update POS header status pill if present
  const posStatusBadge = document.getElementById('pos-offline-badge');
  if (posStatusBadge) {
    if (!isOnline) {
      posStatusBadge.className = 'pos-status-badge pos-status-offline';
      posStatusBadge.innerHTML = `<span>● Offline</span>${count > 0 ? ` <strong>(${count} unsynced)</strong>` : ''}`;
    } else if (count > 0) {
      posStatusBadge.className = 'pos-status-badge pos-status-pending';
      posStatusBadge.innerHTML = `<span>● ${count} unsynced</span> <button type="button" class="btn btn-xs" onclick="triggerManualSync()">Sync Now</button>`;
    } else {
      posStatusBadge.className = 'pos-status-badge pos-status-online';
      posStatusBadge.innerHTML = `<span>● Online</span>`;
    }
  }
}

// Global auto-sync setup
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    updateOfflineStatusUI();
    syncOfflineSales();
    precacheCatalog();
  });

  window.addEventListener('offline', () => {
    updateOfflineStatusUI();
  });

  // Check periodically (every 45s) if online and there are pending sales
  setInterval(() => {
    if (navigator.onLine && isLoggedIn()) {
      getPendingOfflineCount().then(count => {
        if (count > 0) syncOfflineSales();
      });
    }
  }, 45000);
}
