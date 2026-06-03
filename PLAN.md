# BuildPro POS — Feature Expansion Plan

## Tech Summary
- **Backend**: Express 5 + TypeScript + sql.js (SQLite)
- **Frontend**: Vanilla TypeScript SPA + Chart.js
- **Pattern**: Each feature = new backend route file + new frontend view file + optional schema migration

---

## Navigation Layout (Updated)
```
[Dashboard] [Invoices] [Materials] [Customers] [Suppliers] [Purchase Orders]
[Expenses] [Reports] [Settings]
```

---

## Tier 1 — Reports & Financials

### 1. Daily Sales Report
- **Backend**: `GET /api/reports/daily?date=YYYY-MM-DD`
  - Transaction list: invoice #, customer, total, status, profit
  - Summary: gross sales, profit, tax collected
  - Payment method breakdown (cash/card/check/bank)
  - `GET /api/reports/daily?format=pdf` for PDF export
- **Frontend**: Reports tab > "Daily" sub-view
  - Date picker, summary cards, transactions table, print button
- **Print**: Opens printable window (reuse receipt print pattern)

### 2. Monthly Profit & Loss
- **Backend**: `GET /api/reports/monthly?month=YYYY-MM`
  - Revenue (from payments)
  - COGS (sum of invoice_items quantity × cost_price)
  - Gross profit (revenue - COGS)
  - Expenses (from `expenses` table)
  - Net profit (gross - expenses)
  - MoM comparison with % change
- **Frontend**: Reports tab > "P&L" sub-view
  - Cards + revenue/expense/profit chart

### 3. Monthly Tax Summary (BIR-Ready)
- **Backend**: `GET /api/reports/tax?month=YYYY-MM`
  - VATable sales, VAT collected, zero-rated, exempt
  - Total invoices issued
  - Based on invoice `tax_rate` field
- **Frontend**: Reports tab > "Tax" sub-view
  - Clean summary card layout, printable

### 4. Date Range Reports
- **Backend**: `GET /api/reports/range?from=YYYY-MM-DD&to=YYYY-MM-DD&type=sales|profit|tax`
- **Frontend**: Reports tab > "Custom" sub-view
  - From/To date inputs + report type dropdown

### 5. Export to PDF
- **Backend**: `GET /api/reports/*?format=pdf` generates PDF server-side
- **Lib**: `jspdf` — lightweight, no native deps, compatible with pkg EXE bundling
- Apply to all report endpoints

---

## Tier 2 — Missing Business Operations

### 6. Expense Tracking
- **New table**: `expenses`
  - `id` TEXT PRIMARY KEY
  - `category` TEXT NOT NULL
  - `amount` REAL NOT NULL
  - `description` TEXT
  - `vendor` TEXT
  - `expense_date` TEXT NOT NULL
  - `created_at` TEXT DEFAULT CURRENT_TIMESTAMP
- **Categories**: Rent, Utilities, Labor/Salary, Delivery/Transport, Tools & Equipment, Maintenance, Supplies, Other
- **Backend**: `CRUD /api/expenses`
  - `GET /api/expenses?from=&to=&category=`
  - `POST /api/expenses`
  - `PUT /api/expenses/:id`
  - `DELETE /api/expenses/:id`
- **Frontend**: New "Expenses" tab
  - Table with filter by date/category
  - Add/edit/delete
  - Monthly total by category (Chart.js doughnut)

### 7. Supplier Management
- **New table**: `suppliers`
  - `id` TEXT PRIMARY KEY
  - `name` TEXT NOT NULL
  - `contact_person` TEXT
  - `phone` TEXT
  - `email` TEXT
  - `address` TEXT
  - `tin` TEXT
  - `notes` TEXT
  - `created_at` TEXT DEFAULT CURRENT_TIMESTAMP
- **Backend**: `CRUD /api/suppliers`
- **Frontend**: New "Suppliers" tab (same pattern as Customers/Materials)

### 8. Purchase Orders
- **New tables**:
  - `purchase_orders`
    - `id` TEXT PRIMARY KEY
    - `supplier_id` TEXT NOT NULL REFERENCES suppliers(id)
    - `po_number` TEXT NOT NULL UNIQUE
    - `status` TEXT DEFAULT 'pending' (pending/received/cancelled)
    - `total` REAL NOT NULL
    - `order_date` TEXT NOT NULL
    - `received_date` TEXT
    - `created_at` TEXT DEFAULT CURRENT_TIMESTAMP
  - `po_items`
    - `id` TEXT PRIMARY KEY
    - `po_id` TEXT NOT NULL REFERENCES purchase_orders(id)
    - `material_id` TEXT REFERENCES materials(id)
    - `description` TEXT NOT NULL
    - `quantity` REAL NOT NULL
    - `unit_cost` REAL NOT NULL
    - `total` REAL NOT NULL
  - `po_sequence`
    - `id` INTEGER PRIMARY KEY
    - `next_number` INTEGER NOT NULL DEFAULT 1
- **Stock auto-increment**: When PO marked "received", update `materials.stock` in a transaction
- **Backend**:
  - `POST /api/purchase-orders` — create PO with items (transaction)
  - `GET /api/purchase-orders` — list with supplier name, filters
  - `GET /api/purchase-orders/:id` — detail with line items
  - `PUT /api/purchase-orders/:id` — update pending PO
  - `PUT /api/purchase-orders/:id/receive` — mark received, increment stock (transaction)
  - `PUT /api/purchase-orders/:id/cancel` — cancel PO
  - `DELETE /api/purchase-orders/:id` — delete pending PO only
- **Frontend**: "Purchase Orders" tab
  - Create PO with supplier dropdown + line items (material dropdown)
  - PO history list with status badges
  - Detail view with receive/cancel buttons
- **PO numbering**: PO-0001 format, auto-increment in transaction

### 9. Stock Movement History
- **New table**: `stock_movements`
  - `id` TEXT PRIMARY KEY
  - `material_id` TEXT NOT NULL REFERENCES materials(id)
  - `type` TEXT NOT NULL (sale/po/adjustment)
  - `quantity` REAL NOT NULL
  - `reference_id` TEXT
  - `reference_type` TEXT
  - `notes` TEXT
  - `created_at` TEXT DEFAULT CURRENT_TIMESTAMP
- **Backend**:
  - `GET /api/stock-movements?material_id=&type=&from=&to=`
  - Auto-insert on: invoice creation (sale), PO receive (po), manual stock adjustment
- **Frontend**: Stock card view — click material row → see movement history

### 10. Customer Statement of Account (SOA)
- **Backend**: `GET /api/customers/:id/statement?from=&to=`
  - All invoices for customer (pending/partial/paid)
  - All payments for those invoices
  - Opening balance, running balance, closing balance
- **Frontend**: "Statement" button on customer row
  - Printable SOA window (reuse receipt print pattern)

---

## Tier 3 — Operational Enhancements

### 11. Material Categories
- **Schema migration**: Add `category` TEXT column to `materials`
- **Categories**: Cement, Steel/Rebar, Lumber/Wood, Plumbing, Electrical, Paint, Hardware, Sand/Gravel, Roofing, Tools, Other
- **Backend**: `GET /api/materials?category=` filter
- **Frontend**: Category dropdown filter on Materials tab. Category breakdown section on dashboard.

### 12. Price Tiers (Wholesale/Retail)
- **Schema**: Add `wholesale_price` REAL column to `materials`
- **Schema**: Add `is_wholesale` INTEGER DEFAULT 0 to `customers`
- **Invoice**: Toggle `price_tier` per line item — default to retail, option for wholesale
- **Customer auto-default**: If customer is_wholesale, auto-default invoice line items to wholesale price
- **Backend**: Include `wholesale_price` in material responses

### 13. User Roles (Admin / Staff)
- **New table**: `users`
  - `id` TEXT PRIMARY KEY
  - `username` TEXT NOT NULL UNIQUE
  - `pin_hash` TEXT NOT NULL
  - `role` TEXT NOT NULL DEFAULT 'staff' (admin/staff)
  - `created_at` TEXT DEFAULT CURRENT_TIMESTAMP
- **PIN login**: 4-6 digit PIN, bcrypt hashed
- **Auth flow**: POST /api/auth/login → returns JWT token
- **Middleware**: `requireAdmin` middleware checks role
- **Staff restrictions**: Cannot delete records, cannot change prices, cannot access Reports/Settings
- **Schema**: Add `user_id` TEXT column to `invoices` (track who created)
- **Frontend**: Login screen on startup. Settings > Users management (admin only). Current user display in nav.

### 14. Audit Log
- **New table**: `audit_log`
  - `id` TEXT PRIMARY KEY
  - `user_id` TEXT REFERENCES users(id)
  - `action` TEXT NOT NULL (create/update/delete)
  - `entity` TEXT NOT NULL (invoice/material/customer/expense/supplier/po/settings)
  - `entity_id` TEXT
  - `details` TEXT (JSON string)
  - `created_at` TEXT DEFAULT CURRENT_TIMESTAMP
- **Backend**: Log in each route handler after successful mutation
- **Frontend**: Settings > Audit Log sub-view with date/user/entity filters

### 15. Return/Refund Processing
- **Backend**: `POST /api/invoices/:id/return`
  - Validates invoice is paid or partial
  - Creates return items (store as negative invoice_items or separate return_items)
  - Restores stock in transaction
  - Adjusts invoice balance
  - Can issue refund payment (negative payment record)
- **Frontend**: "Return Items" button on invoice detail
  - Select items, enter quantities, confirm
  - Updates inventory + balance

### 16. Low Stock Notifications
- **Frontend-only**: On page load/navigation, check `materials.filter(m => m.stock <= m.reorder_point)`
- **Badge**: Show count badge on Materials nav tab
- **Toast**: On dashboard load, if low stock items exist, show notification
- **Dashboard card**: Already exists — ensure prominent display with count badge

---

## Schema Changes Summary

### New Tables (10)
```
expenses, suppliers, purchase_orders, po_items, po_sequence,
stock_movements, users, audit_log
```

### New Columns on Existing Tables (5)
```
materials.category        TEXT
materials.wholesale_price  REAL
customers.is_wholesale     INTEGER DEFAULT 0
invoices.user_id           TEXT REFERENCES users(id)
```

### New Foreign Keys
```
purchase_orders.supplier_id  → suppliers.id
po_items.po_id              → purchase_orders.id
po_items.material_id         → materials.id
stock_movements.material_id  → materials.id
invoices.user_id             → users.id
audit_log.user_id            → users.id
```

### New Indexes
```
CREATE INDEX idx_expenses_date ON expenses(expense_date);
CREATE INDEX idx_expenses_category ON expenses(category);
CREATE INDEX idx_po_supplier ON purchase_orders(supplier_id);
CREATE INDEX idx_po_status ON purchase_orders(status);
CREATE INDEX idx_stock_mov_material ON stock_movements(material_id);
CREATE INDEX idx_stock_mov_type ON stock_movements(type);
CREATE INDEX idx_audit_entity ON audit_log(entity);
CREATE INDEX idx_audit_user ON audit_log(user_id);
CREATE INDEX idx_audit_date ON audit_log(created_at);
```

---

## Implementation Order

### Phase 1 — Foundation (Expenses, Suppliers, Categories)
| Feature | New Backend File | New Frontend File | Schema Changes |
|---------|-----------------|-------------------|----------------|
| #6 Expenses | `backend/src/routes/expenses.ts` | `frontend/src/views/expenses.ts` | `expenses` table |
| #7 Suppliers | `backend/src/routes/suppliers.ts` | `frontend/src/views/suppliers.ts` | `suppliers` table |
| #11 Categories | Modify `materials.ts` | Modify `materials.ts` view | `materials.category` column |

**Outcome**: Expenses, Suppliers, and categorized materials are live.

### Phase 2 — Inventory Supply Side
| Feature | New Backend File | New Frontend File | Schema Changes |
|---------|-----------------|-------------------|----------------|
| #8 Purchase Orders | `backend/src/routes/purchase-orders.ts` | `frontend/src/views/purchase-orders.ts` | `purchase_orders`, `po_items`, `po_sequence` tables |
| #9 Stock-In History | `backend/src/routes/stock-movements.ts` | Add to Materials view | `stock_movements` table |

**Outcome**: Full purchase/inventory lifecycle — buy from suppliers, restock, track history.

### Phase 3 — Reports
| Feature | New Backend File | New Frontend File | Schema Changes |
|---------|-----------------|-------------------|----------------|
| #1 Daily Sales Report | `backend/src/routes/reports.ts` | `frontend/src/views/reports.ts` | None (uses existing data) |
| #2 Monthly P&L | Same as above | Same as above | Uses `expenses` from Phase 1 |
| #3 Monthly Tax Summary | Same as above | Same as above | None |
| #4 Date Range Reports | Same as above | Same as above | None |
| #5 PDF Export | Same as above (query param) | Same as above (print/export buttons) | Install `jspdf` |

**Outcome**: Full reporting suite with PDF export.

### Phase 4 — Customer & Pricing
| Feature | New Backend File | New Frontend File | Schema Changes |
|---------|-----------------|-------------------|----------------|
| #10 Customer SOA | Modify `customers.ts` route | Button + print window in Customers view | None |
| #12 Price Tiers | Modify `materials.ts`, `invoices.ts` | Modify Materials and Invoices views | `materials.wholesale_price`, `customers.is_wholesale` |
| #13 User Roles | `backend/src/routes/auth.ts`, `backend/src/routes/users.ts`, new middleware | `frontend/src/views/login.ts`, modify `settings.ts` | `users` table, `invoices.user_id` |
| #14 Audit Log | Inline in all route files | `frontend/src/views/audit.ts` (in Settings) | `audit_log` table |

**Outcome**: Multi-user auth, pricing tiers, customer statements, full audit trail.

### Phase 5 — Operations Polish
| Feature | New Backend File | New Frontend File | Schema Changes |
|---------|-----------------|-------------------|----------------|
| #15 Returns | Modify `invoices.ts` route | Modify Invoices view (return UI) | None (reuses existing tables) |
| #16 Low Stock Notifications | None | Modify `main.ts`, `materials.ts` | None |

**Outcome**: Return/refund workflow, persistent low stock alerts.

---

## npm Packages to Add

| Package | Purpose | Phase |
|---------|---------|-------|
| `jspdf` | Server-side PDF generation | Phase 3 |
| `bcryptjs` | PIN hashing for user auth | Phase 4 |
| `jsonwebtoken` | JWT auth tokens | Phase 4 |

None of these have native dependencies — all compatible with pkg EXE bundling.

---

## File Count Estimate

| Phase | Backend Files (New + Modified) | Frontend Files (New + Modified) |
|-------|-------------------------------|--------------------------------|
| Phase 1 | 3 new routes + 1 route modified | 2 new views + 1 view modified + CSS |
| Phase 2 | 2 new routes + 1 route modified | 1 new view + 1 view modified |
| Phase 3 | 1 new route | 1 new view |
| Phase 4 | 2 new routes + 3 routes modified + 1 middleware | 2 new views + 3 views modified |
| Phase 5 | 1 route modified | 2 files modified |
| **Total** | **8 new + 8 modified** | **6 new + 9 modified** |
