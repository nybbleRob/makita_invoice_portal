# Statement Generator assets

Assets consumed by `backend/services/statementGenerator/` when generating
PDF + XLSX statements from the ACR11P export.

## Files

| File | Required | Purpose |
|------|----------|---------|
| `makita_logo.png` | yes | 129x43 logo embedded into the Excel output (`excel.js`). |
| `ACR11P.xlsx` | yes - **NOT COMMITTED** | The real Makita statement template used to render the branded PDF. Contains the two embedded images (logo top-left, Bank Details block bottom-right) and the `#data1#` ... `#data26#` placeholder tokens. |

## Why ACR11P.xlsx is not in the repo

The template is the authoritative branded layout sourced from the existing
Access/Excel-macro process. It contains business-confidential layout (bank
details, VAT number, WEEE number) so it lives outside source control and is
deployed alongside the application.

## Deployment

Copy `ACR11P.xlsx` into this directory on each deployment. The path is
resolved by `backend/services/statementGenerator/pdf.js` via
`STATEMENT_TEMPLATE_PATH` (optional env var) or, by default,
`backend/assets/statement-template/ACR11P.xlsx`.

The generator fails fast at startup if the template is missing - it does
not silently fall back, because non-template output would not be visually
identical to the existing statement run.
