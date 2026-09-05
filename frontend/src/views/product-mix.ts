import { apiGet } from '../lib/api';
import { esc, fmtPeso } from '../lib/helpers';

let productMixFrom = '';
let productMixTo = '';

function productMixPath() {
  const params = new URLSearchParams();
  if (productMixFrom) params.set('from', productMixFrom);
  if (productMixTo) params.set('to', productMixTo);
  const query = params.toString();
  return `/analytics/product-mix${query ? `?${query}` : ''}`;
}

function renderProductMixContent(data: any): string {
  const products = data.products || [];
  const totals = data.totals || {};
  const margin = totals.revenue > 0 ? (totals.gross_profit / totals.revenue) * 100 : 0;
  const bestSelling = [...products].sort((a: any, b: any) => Number(b.quantity_sold || 0) - Number(a.quantity_sold || 0) || Number(b.revenue || 0) - Number(a.revenue || 0)).slice(0, 5);
  const slowMovers = [...products].sort((a: any, b: any) => Number(a.quantity_sold || 0) - Number(b.quantity_sold || 0) || Number(a.revenue || 0) - Number(b.revenue || 0)).slice(0, 5);
  const compactRows = (items: any[], empty: string) => items.length ? items.map((p: any, index: number) => `<tr>
    <td><span class="product-rank">${index + 1}</span><strong>${esc(p.name)}</strong><small>${esc(p.unit || '')} · Stock ${Number(p.stock || 0)}</small></td>
    <td class="product-mix-qty">${Number(p.quantity_sold || 0).toLocaleString()} sold</td>
    <td class="money">${fmtPeso(p.revenue)}</td>
  </tr>`).join('') : `<tr><td colspan="3" class="empty-state">${empty}</td></tr>`;

  return `
    <div class="page-header">
      <div><div class="page-kicker">Sales analysis</div><h2>Product Mix</h2><p class="page-subtitle">See which products sell, how much revenue they generate, and the recorded gross profit.</p></div>
    </div>
    <div class="product-mix-filter dashboard-card">
      <div><strong>Sales period</strong><span class="card-sub">Default: all recorded sales</span></div>
      <div class="product-mix-filter-fields"><label>From <input id="product-mix-from" type="date" value="${esc(productMixFrom)}"></label><label>To <input id="product-mix-to" type="date" value="${esc(productMixTo)}"></label><button class="btn btn-primary btn-sm" onclick="applyProductMixFilter()">Apply</button><button class="btn btn-sm" onclick="clearProductMixFilter()">All time</button></div>
    </div>
    <div class="dashboard-grid report-metrics report-metrics-4 product-mix-summary">
      <div class="dashboard-card card-success"><div class="card-label">Recorded Revenue</div><div class="card-value">${fmtPeso(totals.revenue)}</div><div class="card-sub">After recorded returns</div></div>
      <div class="dashboard-card card-info"><div class="card-label">Gross Profit</div><div class="card-value">${fmtPeso(totals.gross_profit)}</div><div class="card-sub">${margin.toFixed(1)}% overall margin</div></div>
      <div class="dashboard-card"><div class="card-label">Products with Sales</div><div class="card-value">${totals.products_sold || 0}</div><div class="card-sub">of ${totals.products || 0} products</div></div>
      <div class="dashboard-card card-warning"><div class="card-label">No Recorded Sales</div><div class="card-value">${totals.no_sales || 0}</div><div class="card-sub">Review slow-moving stock</div></div>
    </div>
    <div class="product-mix-lists">
      <section class="dashboard-card product-mix-list-card">
        <div class="section-heading"><div><h3>Best Selling Products</h3><p class="card-sub">Top 5 by quantity sold across completed sales.</p></div><span class="product-list-icon product-list-icon-best">↑</span></div>
        <div class="table-wrap"><table class="product-mix-mini-table"><thead><tr><th>Product</th><th>Quantity</th><th>Revenue</th></tr></thead><tbody>${compactRows(bestSelling, 'No completed sales yet.')}</tbody></table></div>
      </section>
      <section class="dashboard-card product-mix-list-card">
        <div class="section-heading"><div><h3>Slow Movers / No Sales</h3><p class="card-sub">Lowest recorded quantity sold; review stock before reordering.</p></div><span class="product-list-icon product-list-icon-slow">↓</span></div>
        <div class="table-wrap"><table class="product-mix-mini-table"><thead><tr><th>Product</th><th>Quantity</th><th>Revenue</th></tr></thead><tbody>${compactRows(slowMovers, 'No products found.')}</tbody></table></div>
      </section>
    </div>
    <section class="dashboard-card product-mix-card">
      <div class="section-heading"><div><h3>Product performance</h3><p class="card-sub">Ranked by revenue. COGS uses the cost recorded at the time of each sale.</p></div></div>
      <div class="table-wrap"><table class="product-mix-table"><thead><tr><th>Product</th><th>Sold</th><th>Revenue</th><th>COGS</th><th>Gross Profit</th><th>Margin</th><th>Share</th><th>Status</th></tr></thead><tbody>
        ${products.length ? products.map((p: any) => {
          const noSales = Number(p.quantity_sold || 0) <= 0;
          const lowStock = Number(p.stock || 0) <= Number(p.reorder_point || 0);
          return `<tr class="${noSales ? 'product-mix-no-sales' : ''}">
            <td data-label="Product"><strong>${esc(p.name)}</strong><small>${esc(p.unit || '')} · Stock ${Number(p.stock || 0)}</small></td>
            <td data-label="Sold">${Number(p.quantity_sold || 0).toLocaleString()}</td>
            <td data-label="Revenue" class="money">${fmtPeso(p.revenue)}</td>
            <td data-label="COGS" class="money">${fmtPeso(p.cogs)}</td>
            <td data-label="Gross Profit" class="money ${p.gross_profit >= 0 ? 'positive' : 'negative'}">${fmtPeso(p.gross_profit)}</td>
            <td data-label="Margin">${Number(p.margin_pct || 0).toFixed(1)}%</td>
            <td data-label="Share">${Number(p.sales_share_pct || 0).toFixed(1)}%</td>
            <td data-label="Status"><span class="status-badge ${noSales ? 'status-warning' : 'status-success'}">${noSales ? 'No sales' : 'Selling'}${lowStock ? ' · Low stock' : ''}</span></td>
          </tr>`;
        }).join('') : '<tr><td colspan="8" class="empty-state">No products found.</td></tr>'}
      </tbody></table></div>
    </section>`;
}

export async function renderProductMix(): Promise<string> {
  const data = await apiGet<any>(productMixPath());
  return renderProductMixContent(data);
}

export async function applyProductMixFilter() {
  const from = (document.getElementById('product-mix-from') as HTMLInputElement | null)?.value || '';
  const to = (document.getElementById('product-mix-to') as HTMLInputElement | null)?.value || '';
  if (from && to && from > to) { (window as any).showToast?.('From date cannot be after To date.'); return; }
  productMixFrom = from; productMixTo = to;
  const content = document.getElementById('main-content');
  if (!content) return;
  content.innerHTML = `<div class="loading-skeleton">${'<div class="sk-item"></div>'.repeat(6)}</div>`;
  try { content.innerHTML = await renderProductMix(); } catch (error: any) { content.innerHTML = ''; (window as any).showToast?.(error.message || 'Unable to load Product Mix.'); }
}

export function clearProductMixFilter() { productMixFrom = ''; productMixTo = ''; applyProductMixFilter(); }
