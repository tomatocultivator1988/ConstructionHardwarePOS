# BuildPro POS CAS / POS submission package

This is a preparation package, not an approval or certification. Replace every bracketed field with taxpayer-specific information and have the accountant/tax adviser validate it before submission.

## 1. Taxpayer and registration profile

- Registered name: `[complete in Settings]`
- Trade name: `[complete]`
- TIN / branch code: `[complete in Settings]`
- RDO: `[complete in Settings]`
- VAT status and registered tax types: `[accountant to confirm]`
- Business address and branches: `[complete]`
- Invoice series, starting number, ATP/permit details: `[BIR/RDO/printer to confirm]`

## 2. System description

BuildPro POS is a browser-based point-of-sale application using a Vercel serverless backend and Turso distributed SQLite database. Users authenticate with a username/PIN and role-based permissions. Sales, customer, material, purchase order, payment, return, expense, stock movement, cashier shift, credit memo, refund, settings, and audit records are stored as structured database records.

The system generates invoice numbers from a database sequence, records invoice line quantities/prices/cost snapshots, deducts and restores inventory through transaction-scoped writes, prevents deletion of issued invoices, supports void reasons, and records adjustment and cashier activities in an audit log. Data is exportable as structured CSV and through Books-oriented report APIs.

## 3. Functional controls to demonstrate

| Control | Demonstration evidence |
|---|---|
| User access | Login, staff/admin permissions, failed-access behavior |
| Sequential documents | Consecutive invoice sequence and no reuse after void |
| Sales and inventory | Invoice, stock deduction, stock movement, historical cost |
| Payments | Partial/full payment, duplicate/overpayment rejection |
| Returns | Item-specific quantity limit, stock restoration, balance reduction |
| Credit/refund | Credit memo, refund limit, adjusted balance and report effect |
| Void | Admin-only reason, retained invoice, stock restoration, audit record |
| Cash control | Open shift, cash receipts, close shift, variance |
| Audit trail | User, timestamp, action, entity, before/after values |
| Reporting | Sales journal, cash receipts, expenses, receivables, tax/export |
| Backup/recovery | Turso backup/restore procedure and access-owner record |

## 4. Technical and security controls

- Production secrets are environment variables and must not be committed.
- Production requires a non-default JWT secret and restricted CORS origin.
- Database foreign-key enforcement and indexes are enabled during initialization.
- API writes validate identifiers, numeric ranges, quantities, prices, and authorization.
- Admin-only actions include user administration, audit access, invoice voiding, credit memos, refunds, and report access.
- Vercel logs, Turso access logs, application audit records, backups, and incident procedures must be retained according to the taxpayer's approved policy.
- Changes are version-controlled in Git; every release should have a reviewed commit, test result, migration note, and rollback plan.

## 5. Required samples to print/export

1. VAT or Non-VAT invoice with the taxpayer's actual registered details.
2. Void invoice and its audit entry.
3. Return, credit memo, and refund examples with supporting records.
4. Daily sales, monthly P&L, tax summary, Books, receivables, inventory and cash-shift reports.
5. Audit-log extract showing create/update/void/delete and before/after values.
6. CSV export opened in a spreadsheet and reconciled to the printed report.
7. E2E test output from `npm run qa:e2e` executed only against a disposable QA database.

## 6. External submission and review

The taxpayer must obtain the applicable current BIR checklist from the registered RDO, complete the applicable sworn statement/joint sworn statement and functional/technical requirements, submit samples, and follow any registration, permit, printer, CAS/CBA/ESS, EIS, or Permit to Transmit process applicable to its classification. BIR may request changes or additional evidence. No software commit can substitute for BIR acceptance.

Official starting references: [BIR Citizens' Charter 2024](https://bir-cdn.bir.gov.ph/BIR/pdf/Citizens-Charter-2024.pdf), [RR No. 7-2024](https://bir-cdn.bir.gov.ph/BIR/pdf/RR%207-2024.pdf), [RMC No. 77-2024](https://bir-cdn.bir.gov.ph/BIR/pdf/RMC%20No.%2077-2024%20Digest.pdf), and [BIR EIS](https://eis.bir.gov.ph/).
