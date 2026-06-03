export function esc(s: string): string {
  if (typeof s !== 'string') s = String(s);
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

export function fmtDate(d: string): string {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function fmtTime(d: string): string {
  if (!d) return '';
  return new Date(d).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function fmtPeso(n: number): string {
  const v = Number(n);
  return '₱' + (isNaN(v) ? '0.00' : v.toFixed(2));
}

export function val(id: string): string {
  return (document.getElementById(id) as HTMLInputElement)?.value ?? '';
}

export function setErr(id: string, msg: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = msg;
}

export function clearErr(id: string): void {
  setErr(id, '');
}

export function disableBtn(id: string, disabled: boolean): void {
  const btn = document.getElementById(id) as HTMLButtonElement | null;
  if (btn) btn.disabled = disabled;
}

export function numberToWords(n: number): string {
  if (n === 0) return 'Zero Pesos Only';
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  const numToWordsInner = (num: number): string => {
    if (num < 20) return ones[num];
    if (num < 100) return tens[Math.floor(num / 10)] + (num % 10 ? ' ' + ones[num % 10] : '');
    if (num < 1000) return ones[Math.floor(num / 100)] + ' Hundred' + (num % 100 ? ' ' + numToWordsInner(num % 100) : '');
    if (num < 1000000) return numToWordsInner(Math.floor(num / 1000)) + ' Thousand' + (num % 1000 ? ' ' + numToWordsInner(num % 1000) : '');
    if (num < 1000000000) return numToWordsInner(Math.floor(num / 1000000)) + ' Million' + (num % 1000000 ? ' ' + numToWordsInner(num % 1000000) : '');
    return num.toLocaleString('en-PH');
  };

  const pesos = Math.floor(n);
  const centavos = Math.round((n - pesos) * 100);
  let result = numToWordsInner(pesos) + ' Pesos';
  if (centavos > 0) result += ' And ' + numToWordsInner(centavos) + ' Centavos';
  return result + ' Only';
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PHONE_RE = /^\d{11}$/;

export function showToast(msg: string, type: 'error' | 'success' = 'error') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

export function showModal(html: string, id: string) {
  document.getElementById(id)?.remove();
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.id = id;
  modal.innerHTML = `<div class="modal-content">${html}</div>`;
  modal.addEventListener('click', e => {
    if (e.target === modal) closeModal();
  });
  document.body.appendChild(modal);
}

export function closeModal() {
  document.querySelectorAll('.modal').forEach(m => m.remove());
}

export function showConfirmModal(html: string): Promise<boolean> {
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
    const cleanup = (r: boolean) => {
      modal.remove();
      resolve(r);
    };
    modal.addEventListener('click', e => {
      if (e.target === modal) cleanup(false);
    });
    document.body.appendChild(modal);
    requestAnimationFrame(() => {
      document.getElementById('confirm-yes')?.addEventListener('click', () => cleanup(true));
      document.getElementById('confirm-no')?.addEventListener('click', () => cleanup(false));
    });
  });
}

export function isAdmin(): boolean {
  const u = localStorage.getItem('buildpro_user');
  if (!u) return false;
  try { return JSON.parse(u).role === 'admin'; } catch { return false; }
}
