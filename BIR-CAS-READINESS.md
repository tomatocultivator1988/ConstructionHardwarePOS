# BuildPro POS — BIR/CAS readiness

This application now contains software features for buyer TIN/address capture, configurable business settings, invoice status preservation, voiding with stock restoration, credit/refund adjustments that flow into balances and reports, audit history, cashier shifts, historical item cost, Books-oriented reports, structured CSV sales export, and server-side pagination.

These are not the same as BIR accreditation or a Permit to Transmit. The taxpayer must still complete registration and coordinate with the proper Revenue District Office. Current BIR materials describe CAS/CBA/ESS submission requirements including a sworn statement or joint sworn statement, system description, sample invoices, sample books/reports, printed audit trail, and signed functional/technical requirements. See the official [BIR Citizens' Charter 2024](https://bir-cdn.bir.gov.ph/BIR/pdf/Citizens-Charter-2024.pdf), [RR No. 7-2024](https://bir-cdn.bir.gov.ph/BIR/pdf/RR%207-2024.pdf), [RMC No. 77-2024](https://bir-cdn.bir.gov.ph/BIR/pdf/RMC%20No.%2077-2024%20Digest.pdf), and [BIR EIS portal](https://eis.bir.gov.ph/).

## Operational checklist

- Configure legal business name, address, TIN, branch/RDO and VAT status in Settings.
- Use buyer name, address and TIN on customer records when applicable.
- Use the correct registered invoice type and numbering/ATP details after the taxpayer's BIR review. Do not use placeholder values on production invoices.
- Do not delete issued invoices; use void with a reason and retain the record.
- Issue documented credit/refund adjustments rather than editing historical sales; have the accountant confirm the tax treatment of each adjustment.
- Open and close a cashier shift and investigate any cash variance.
- Export and retain sales/tax/books data with controlled access, backups, and a documented retention policy.
- Run the guarded `npm run qa:e2e` test only against a disposable QA deployment/database. It requires `QA_BASE_URL`, `QA_TOKEN`, and `QA_ALLOW_MUTATION=true`.

## CAS submission package to assemble

1. Signed sworn statement or joint sworn statement and the completed system-description and forms/reports specifications required by the applicable BIR checklist.
2. Versioned system architecture, database/schema, security/access-control, backup/restore, change-management, and business-continuity descriptions.
3. Sample VAT or Non-VAT invoice matching the taxpayer's registered details, numbering, invoice type, tax treatment, and approved printer/electronic-invoicing arrangement.
4. Sample Books of Accounts and generated sales journal, cash receipts, purchases/expenses, accounts receivable, tax, inventory, and audit-trail reports.
5. Printed audit-trail sample demonstrating user, timestamp, action, affected record, before/after values where applicable, and immutable retention controls.
6. Completed functional and technical requirements, test evidence, user roles, operating procedures, and training/administration guide.
7. Data export and, when applicable to the taxpayer, structured electronic-sales reporting/EIS integration design, retry/error handling, acknowledgements, and security controls.

## Explicit non-claims

The repository does not claim BIR accreditation, CAS registration, Authority to Print, Permit to Transmit, EIS certification, or taxpayer eligibility. Those require taxpayer-specific documents, credentials, review, and acceptance by BIR/RDO. An accountant or BIR officer must review the invoice wording, VAT treatment, books, adjustment policy, retention controls, and final submission package before production use.
