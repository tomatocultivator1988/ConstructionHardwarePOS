import { apiGet } from '../lib/api';
import { esc, fmtDate, fmtPeso, numberToWords } from '../lib/helpers';
import { showToast } from '../lib/helpers';
import type { Invoice } from '../lib/types';

export async function printReceipt(id: string) {
  try {
    const inv = await apiGet<Invoice>(`/invoices/${id}`);
    const business = await Promise.all(['business_name','business_address','business_tin','business_rdo','vat_registered'].map(async key => [key, (await apiGet<{ value: string }>(`/settings/${key}`)).value || '']));
    const businessSettings = Object.fromEntries(business);
    const totalPaid = inv.payments.reduce((s: number, p: any) => s + p.amount, 0) - ((inv as any).refunds || []).reduce((s: number, r: any) => s + r.amount, 0);
    const adjustedTotal = Number((inv as any).adjusted_total ?? inv.total);
    const balance = adjustedTotal - totalPaid;

    const printWin = window.open('', '_blank');
    if (!printWin) { showToast('Please allow pop-ups to print receipts'); return; }

    const issuedDate = new Date(inv.issued_date.replace(' ', 'T'));
    const dateStr = issuedDate.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });
    const timeStr = issuedDate.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' });
    const cashier = 'Admin';

    const isVat = businessSettings.vat_registered === '1' || Number(inv.tax_rate) > 0;
    const vatRate = isVat ? Number(inv.tax_rate) : 0;
    const vatableSales = Number(inv.subtotal);
    const vatAmount = Number(inv.tax_amount);

    printWin.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Official Receipt - ${esc(inv.invoice_number)}</title>
        <style>
          @page { margin: 0; }
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: 'Arial Narrow', Arial, 'Helvetica Neue', sans-serif;
            font-size: 10px;
            line-height: 1.45;
            color: #000;
            background: #fff;
            padding: 0;
            max-width: 80mm;
            margin: 0 auto;
          }
          .receipt { border: 1.5px solid #000; margin: 8px; padding: 10px 12px; }
          .brand { text-align: center; padding-bottom: 6px; border-bottom: 2px solid #000; margin-bottom: 6px; }
          .brand .name { font-size: 15px; font-weight: 900; letter-spacing: 2px; text-transform: uppercase; }
          .brand .nature { font-size: 6.5px; text-transform: uppercase; letter-spacing: 2.5px; color: #555; margin-top: 1px; }
          .brand .addr { font-size: 7px; color: #444; margin-top: 3px; line-height: 1.4; }
          .brand .bir-line { font-size: 6px; color: #666; margin-top: 2px; letter-spacing: 0.3px; }
          .or-title { text-align: center; font-size: 12px; font-weight: 800; letter-spacing: 1.5px; padding: 5px 0; border-bottom: 1px solid #000; margin-bottom: 5px; }
          .info-grid { width: 100%; font-size: 8px; border-collapse: collapse; margin-bottom: 5px; }
          .info-grid td { padding: 1px 2px; vertical-align: top; }
          .info-grid .lbl { font-weight: 700; color: #333; width: 30%; text-transform: uppercase; font-size: 6.5px; letter-spacing: 0.3px; }
          .info-grid .val { font-weight: 600; }
          .info-grid .bdr-b { border-bottom: 1px dotted #ccc; padding-bottom: 3px; }
          .items-table { width: 100%; border-collapse: collapse; margin: 4px 0; font-size: 8px; }
          .items-table thead th { border-top: 1px solid #000; border-bottom: 1px solid #000; padding: 3px 2px; font-size: 6.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.3px; color: #333; text-align: right; }
          .items-table thead th:nth-child(1) { text-align: left; }
          .items-table thead th:nth-child(2) { text-align: center; }
          .items-table tbody td { padding: 2px 2px; vertical-align: top; text-align: right; border-bottom: 1px dotted #e0e0e0; }
          .items-table tbody td:nth-child(1) { text-align: left; }
          .items-table tbody td:nth-child(2) { text-align: center; }
          .amt-box { margin-top: 3px; }
          .amt-box .row { display: flex; justify-content: space-between; padding: 1px 0; font-size: 8px; }
          .amt-box .row .lbl { color: #444; font-weight: 600; text-transform: uppercase; font-size: 6.5px; letter-spacing: 0.3px; }
          .amt-box .total-row { font-size: 12px; font-weight: 900; border-top: 2px solid #000; border-bottom: 2px solid #000; padding: 3px 0; margin: 3px 0; }
          .words-box { font-size: 7px; color: #333; padding: 3px 0; margin-bottom: 3px; font-style: italic; }
          .words-box strong { font-style: normal; }
          .payment-section { border-top: 1px solid #000; padding-top: 3px; margin-top: 3px; }
          .payment-section .row { display: flex; justify-content: space-between; font-size: 8px; padding: 1px 0; }
          .bir-footer { border-top: 1px solid #000; margin-top: 5px; padding-top: 4px; text-align: center; font-size: 5.5px; color: #666; line-height: 1.5; }
          .bir-footer b { color: #333; }
          .sig-line { display: flex; justify-content: space-between; margin-top: 8px; padding-top: 4px; border-top: 1px dashed #999; font-size: 7px; }
          .sig-line div { text-align: center; }
          .sig-line .bar { margin-top: 14px; }
          .status-stamp { position: absolute; top: 50%; right: 8px; transform: translateY(-50%) rotate(-15deg); font-size: 14px; font-weight: 900; letter-spacing: 3px; border: 3px solid; padding: 4px 8px; opacity: 0.6; }
          @media print { body { margin: 0; padding: 0; } .no-print { display: none !important; } @page { margin: 0; } }
        </style>
      </head>
      <body>
        <div class="receipt" style="position:relative">
          ${inv.status === 'paid' ? '<div class="status-stamp" style="border-color:#2e7d32;color:#2e7d32">PAID</div>' : inv.status === 'partial' ? '<div class="status-stamp" style="border-color:#e65100;color:#e65100">PARTIAL</div>' : ''}
          <div class="brand">
            <div class="name">${esc(businessSettings.business_name || 'BuildPro Construction Supply')}</div>
            <div class="nature">Hardware &amp; Building Materials Dealer</div>
            <div class="addr">${esc(businessSettings.business_address || 'Business address not configured')}</div>
            <div class="bir-line">${isVat ? 'VAT Reg.' : 'Non-VAT'} TIN: ${esc(businessSettings.business_tin || 'Not configured')} &bull; RDO/Branch: ${esc(businessSettings.business_rdo || 'Not configured')}</div>
          </div>
          <div class="or-title">SALES INVOICE / OFFICIAL RECEIPT</div>
          <table class="info-grid">
            <tr><td class="lbl">Document No.</td><td class="val" colspan="3">${esc(inv.invoice_number)}</td></tr>
            <tr><td class="lbl">Date</td><td class="val" colspan="3">${esc(dateStr)}</td></tr>
            <tr><td class="lbl">Time</td><td class="val" colspan="3">${esc(timeStr)}</td></tr>
            <tr><td class="lbl bdr-b" colspan="4"></td></tr>
            <tr><td class="lbl">Sold To</td><td class="val" colspan="3">${esc(inv.customer_name)}</td></tr>
            <tr><td class="lbl">Address</td><td class="val" colspan="3">${esc((inv as any).customer_address || (inv.customer_name === 'Walk-in' ? 'N/A' : 'Not Provided'))}</td></tr>
            <tr><td class="lbl">TIN</td><td class="val" colspan="3">${esc((inv as any).customer_tin || 'Not Provided')}</td></tr>
            <tr><td class="lbl">Cashier</td><td class="val" colspan="3">${esc(cashier)}</td></tr>
          </table>
          <table class="items-table">
            <thead><tr><th style="width:40%">Particulars</th><th style="width:12%">Qty</th><th style="width:20%">Unit Price</th><th style="width:28%">Amount</th></tr></thead>
            <tbody>
              ${inv.items.map((item: any) => `<tr><td>${esc(item.description)}</td><td>${item.quantity}</td><td>${fmtPeso(item.unit_price)}</td><td>${fmtPeso(item.total)}</td></tr>`).join('')}
            </tbody>
          </table>
          <div class="amt-box">
            ${isVat ? `
            <div class="row"><span class="lbl">VATable Sales</span><span>${fmtPeso(vatableSales)}</span></div>
            <div class="row"><span class="lbl">VAT (${(vatRate*100).toFixed(0)}%)</span><span>${fmtPeso(vatAmount)}</span></div>
            ` : '<div class="row"><span class="lbl">Non-VAT Transaction</span><span></span></div>'}
            <div class="row total-row"><span>TOTAL AMOUNT DUE</span><span>${fmtPeso(adjustedTotal)}</span></div>
          </div>
          <div class="words-box">Amount in Words: <strong>${esc(numberToWords(adjustedTotal))}</strong></div>
          <div class="payment-section">
            <div class="row"><span>Payment Received</span><span>${fmtPeso(totalPaid)}</span></div>
            <div class="row" style="font-weight:700;font-size:10px"><span>Outstanding Balance</span><span>${fmtPeso(balance)}</span></div>
            ${inv.payments.length ? inv.payments.map((p: any) => `<div class="row" style="font-size:7px;color:#666"><span>${fmtDate(p.payment_date)} via ${esc(p.method)}</span><span>${fmtPeso(p.amount)}</span></div>`).join('') : ''}
            <div class="row" style="font-size:7px;color:#666;margin-top:2px"><span>Mode of Payment:</span><span>${inv.payments.length ? inv.payments.map((p: any) => esc(p.method)).join(', ') : '—'}</span></div>
          </div>
          <div class="sig-line">
            <div><div class="bar">_________________________</div><div>Received By</div></div>
            <div><div class="bar">_________________________</div><div>Customer Signature</div></div>
          </div>
          <div class="bir-footer">
            <b>${esc(businessSettings.business_name || 'BuildPro Construction Supply')}</b><br>
            ${esc(businessSettings.business_address || 'Business address not configured')} &bull; TIN: ${esc(businessSettings.business_tin || 'Not configured')}<br>
            RDO/Branch: ${esc(businessSettings.business_rdo || 'Not configured')} &bull; Serial No. ${esc(inv.invoice_number)}<br>
            ${isVat ? 'VAT invoice — retain this document for your records.' : 'Non-VAT invoice — not valid for input tax credit.'}<br>
            This document is subject to the taxpayer\'s approved BIR registration details.<br>
            Issued ${esc(dateStr)} at ${esc(timeStr)}
          </div>
        </div>
        <div class="no-print" style="text-align:center;padding:20px;font-family:Arial,sans-serif">
          <button onclick="window.print()" style="padding:10px 36px;font-size:14px;cursor:pointer;border:1px solid #999;border-radius:6px;background:#f0f0f0;font-weight:600">🖨 Print / Save as PDF</button>
          <p style="margin-top:8px;font-size:11px;color:#888">Keyboard shortcut: Ctrl+P &bull; Cmd+P on Mac</p>
        </div>
        <script>setTimeout(function() { window.print(); }, 600);<\/script>
      </body>
      </html>
    `);
    printWin.document.close();
  } catch (e: any) {
    showToast(e.message);
  }
}
