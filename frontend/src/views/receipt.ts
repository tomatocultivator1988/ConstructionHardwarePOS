import { apiGet } from '../lib/api';
import { esc, fmtDate, fmtPeso, numberToWords } from '../lib/helpers';
import { showToast } from '../lib/helpers';
import type { Invoice } from '../lib/types';

export async function printReceipt(id: string) {
  try {
    const bluetooth = (navigator as any).bluetooth;
    if (!bluetooth) {
      showToast('Web Bluetooth is not supported in this browser. Use Chrome or Edge over HTTPS with a BLE thermal printer.');
      return;
    }

    // Request the printer before awaiting API calls so the browser preserves
    // the click gesture required to open the Bluetooth chooser.
    const device = await bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [
        '0000ffe0-0000-1000-8000-00805f9b34fb',
        '000018f0-0000-1000-8000-00805f9b34fb',
        '0000ff00-0000-1000-8000-00805f9b34fb',
      ],
    });
    if (!device?.gatt) throw new Error('Selected device does not support Bluetooth printing');
    const server = device.gatt.connected ? device.gatt : await device.gatt.connect();
    const characteristic = await findPrinterCharacteristic(server);
    if (!characteristic) throw new Error('Could not find a writable printer characteristic. Check that the printer is BLE/ESC-POS compatible.');

    const inv = await apiGet<Invoice>(`/invoices/${id}`);
    let businessSettings: Record<string, string> = {};
    try {
      businessSettings = await apiGet<Record<string, string | null>>('/settings?keys=business_name,business_address,business_tin,business_rdo,vat_registered') as Record<string, string>;
    } catch { businessSettings = {}; }
    const totalPaid = inv.payments.reduce((s: number, p: any) => s + p.amount, 0) - ((inv as any).refunds || []).reduce((s: number, r: any) => s + r.amount, 0);
    const adjustedTotal = Number((inv as any).adjusted_total ?? inv.total);
    const balance = adjustedTotal - totalPaid;

    const issuedDate = new Date(String(inv.issued_date || new Date().toISOString()).replace(' ', 'T'));
    const dateStr = issuedDate.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });
    const timeStr = issuedDate.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' });
    const cashier = 'Admin';

    const isVat = businessSettings.vat_registered === '1' || Number(inv.tax_rate) > 0;
    const vatRate = isVat ? Number(inv.tax_rate) : 0;
    const vatAmount = Number((inv as any).adjusted_tax ?? inv.tax_amount);
    const vatableSales = Math.max(0, adjustedTotal - vatAmount);
    await writeThermalReceipt(characteristic, buildThermalReceipt(inv, businessSettings, dateStr, timeStr, totalPaid, adjustedTotal, balance, isVat, vatRate, vatAmount));
    showToast(`Receipt sent to ${device.name || 'thermal printer'}`, 'success');
  } catch (e: any) {
    if (e?.name === 'NotFoundError') showToast('No Bluetooth printer was selected');
    else showToast(e?.message || 'Unable to print receipt');
  }
}

const PRINTER_SERVICES = [
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '000018f0-0000-1000-8000-00805f9b34fb',
  '0000ff00-0000-1000-8000-00805f9b34fb',
];

async function findPrinterCharacteristic(server: any): Promise<any> {
  for (const serviceId of PRINTER_SERVICES) {
    try {
      const service = await server.getPrimaryService(serviceId);
      const characteristics = await service.getCharacteristics();
      const writable = characteristics.find((c: any) => c.properties?.write || c.properties?.writeWithoutResponse);
      if (writable) return writable;
    } catch { /* Try the next common BLE printer service. */ }
  }
  return null;
}

async function writeThermalReceipt(characteristic: any, text: Uint8Array) {
  const chunkSize = characteristic.properties?.writeWithoutResponse ? 180 : 100;
  for (let offset = 0; offset < text.length; offset += chunkSize) {
    const chunk = text.slice(offset, Math.min(offset + chunkSize, text.length));
    if (characteristic.properties?.writeWithoutResponse && characteristic.writeValueWithoutResponse) await characteristic.writeValueWithoutResponse(chunk);
    else await characteristic.writeValue(chunk);
  }
}

function buildThermalReceipt(inv: Invoice, settings: Record<string, string>, dateStr: string, timeStr: string, totalPaid: number, adjustedTotal: number, balance: number, isVat: boolean, vatRate: number, vatAmount: number): Uint8Array {
  const encoder = new TextEncoder();
  const width = 42;
  const line = '-'.repeat(width);
  const center = (s: string) => s.length >= width ? s.slice(0, width) : ' '.repeat(Math.floor((width - s.length) / 2)) + s;
  const row = (label: string, value: string) => label.padEnd(Math.max(1, width - value.length)) + value;
  const safe = (value: any, fallback = '') => String(value ?? fallback).replace(/[\r\n]/g, ' ').trim();
  const itemLines = (inv.items || []).flatMap((item: any) => {
    const name = safe(item.description, 'Item').slice(0, width);
    return [`${name}`, row(`  ${item.quantity} x ${fmtPeso(item.unit_price)}`, fmtPeso(item.total))];
  });
  const paymentMethods = (inv.payments || []).map((p: any) => safe(p.method)).join(', ') || '—';
  const content = [
    '\x1b@', '\x1b\x61\x01', safe(settings.business_name, 'BuildPro Construction Supply'),
    'Hardware & Building Materials Dealer', safe(settings.business_address, 'Business address not configured'),
    `${isVat ? 'VAT Reg.' : 'Non-VAT'} TIN: ${safe(settings.business_tin, 'Not configured')}`,
    `RDO/Branch: ${safe(settings.business_rdo, 'Not configured')}`, '\x1b\x61\x00', line,
    'SALES INVOICE / OFFICIAL RECEIPT', line,
    row('Document No.', safe(inv.invoice_number)), row('Date', dateStr), row('Time', timeStr),
    row('Sold To', safe((inv as any).customer_name, 'Walk-in')), row('Delivery', safe((inv as any).delivery_person, 'Not assigned')), line,
    'ITEMS', ...itemLines, line,
    isVat ? row('VATable Sales', fmtPeso(Math.max(0, adjustedTotal - vatAmount))) : row('Non-VAT Transaction', ''),
    isVat ? row(`VAT (${(vatRate * 100).toFixed(0)}%)`, fmtPeso(vatAmount)) : '',
    row('TOTAL AMOUNT DUE', fmtPeso(adjustedTotal)), line,
    `Amount in Words: ${safe(numberToWords(adjustedTotal))}`, line,
    row('Payment Received', fmtPeso(totalPaid)), row('Outstanding Balance', fmtPeso(balance)), row('Mode of Payment', paymentMethods),
    '', 'Thank you for your purchase!', '\x1b\x64\x04', '\x1d\x56\x00',
  ].filter(Boolean).join('\n') + '\n';
  return encoder.encode(content);
}
