# BuildPro POS System — Project Summary

## App Overview
Full-featured Construction POS system with material cost tracking, analytics dashboard, receipt printing (PH BIR-style), and dark-themed UI. Built as a vanilla TypeScript SPA (no framework) with an Express 5 backend and sql.js (pure JS SQLite).

## Current State — Ready to Ship

### What's Built

#### Backend (Express 5 + sql.js)
- Full CRUD for customers, materials, invoices, payments, settings
- 7 RESTful route modules: customers, materials, invoices, analytics, settings, payments, health
- SQLite database with schema migrations, FK indexes, and profit margin view
- API token authentication (`API_TOKEN` env var, opt-in)
- Helmet security headers, CORS restriction, rate limiting (100 req/min per IP)
- Morgan request logging
- Auto-creates `data/` folder + `construction_pos.db` on first launch
- Async `initDb()` on startup with error handling

#### Frontend (Vanilla TypeScript SPA)
- Tab-based navigation: Dashboard, Customers, Materials, Invoices, Settings, Receipt
- Dashboard: 6 metric cards, 5 charts (revenue+profit overlay, invoice status, top materials, margins, low stock), period analytics (monthly/yearly/overall with MoM %)
- Customer CRUD with phone (11 digits), address (min 5), name (min 2) validation
- Material CRUD with cost/retail/profit/margin columns, integer validation for stock/reorder
- Invoice CRUD with line items, payment recording, overpayment protection inside transaction
- BIR-compliant official receipt (80mm thermal paper) with VAT/non-VAT breakdown, amount in words, payment summary, status stamp overlay
- Full form validation with per-row errors
- Mobile-responsive (4 breakpoints)

#### Security
- `helmet` middleware
- CORS restricted to configurable origin
- Request body size limit (1mb)
- Rate limiting (skips health endpoint)
- API token authentication (configurable, opt-in with startup warning)

### EXE Distribution
- Single `BuildProPOS.exe` (39.7 MB) via `pkg` — bundles Node.js 18 runtime, backend code, frontend dist, and sql.js WASM
- `Start-BuildPro.vbs` launcher — double-click runs EXE silently with no terminal window
- Database auto-creates on first run in `data/` subfolder
- No installation required — just unzip and run
- Defaults to production mode (`NODE_ENV=production`)

### Key Technical Decisions
- **sql.js** over better-sqlite3: pure JS + WASM avoids native module ABI mismatch with pkg's bundled Node.js 18
- **uuid@9** over uuid@14: v14 is ESM-only, breaks pkg's CJS build
- **Express 5** route patterns: `/{*path}` instead of `*` (path-to-regexp v8 breaking change)
- **sql.js wrapper** mimics better-sqlite3 API: `prepare/run/get/all/transaction` with auto-save
- **window globals** for onclick backward compatibility (planned migration to event delegation)
- **Invoice payments** wrapped in `db.transaction()` for atomicity
- **Profit margin SQL view** (`v_invoice_profit_margin`) eliminates 7 duplicated subqueries
- **Frontend rounding** matches backend: `round(subtotal) → round(roundedSubtotal * tax) → round(roundedSubtotal + taxAmount)`

### Fixed Issues (13 across 2 audits)
1. Overpayment prevention — balance check inside transaction
2. Receipt uses invoice issued_date (not current date)
3. Receipt reads stored subtotal/tax from DB
4. Profit view uses LEFT JOIN with DROP VIEW migration
5. Frontend rounding matches backend
6. Balance colors: negative→warning, positive→danger, zero→success
7. Removed redundant dynamic imports
8. Rate limiting (100 req/min, skips health)
9. Auth warning when API_TOKEN is empty
10. Chrome date parsing (replace space with T)
11. NumberToWords million/billion support
12. Analytics COALESCE for NULL cost_price
13. Duplicate invoice numbers (sequence inside same transaction)

### How to Run
```bash
# Development
cd backend && npm run dev    # API at :3001
cd frontend && npm run dev   # UI at :5173

# Production
cd backend && npm start      # Serves everything on :3001

# Build EXE
npm run build:exe            # Outputs BuildProPOS.exe + Start-BuildPro.vbs in backend/
```

### Distribution
Zip `dist/` folder (contains `BuildProPOS.exe` + `Start-BuildPro.vbs`). Client unzips, double-clicks `.vbs`, opens `http://localhost:3001` in browser. `data/construction_pos.db` auto-created on first run.

### Future Ideas (Not Started)
- Event delegation replacing window globals
- Automated testing
- Multi-user support
- Cloud backup for database
- BIR integration / e-receipt
