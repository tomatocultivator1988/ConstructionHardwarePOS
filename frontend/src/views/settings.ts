import { apiGet, apiPut } from '../lib/api';
import { val, setErr, clearErr, disableBtn } from '../lib/helpers';
import { showToast } from '../lib/helpers';

export async function renderSettings(): Promise<string> {
  const settings = await apiGet<{ value: string }>('/settings/default_tax_rate');
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

export async function saveSettings() {
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
}
