/**
 * Deterministic content hash for a parsed ACR11P customer payload.
 *
 * The point of this hash is to answer "does this customer's statement
 * actually contain different data than last time?" WITHOUT being fooled by:
 *   - PDF/XLSX file-byte differences (LibreOffice and ExcelJS always stamp
 *     a `/CreationDate` and a `core.xml` `createdAt`, so two outputs of
 *     identical input data are never byte-identical).
 *   - Pagination shape (page-row chunking, page totals, page numbers).
 *   - BPCS row ordering inside the export (we sort invoices by invoice
 *     number before hashing).
 *   - Stray whitespace.
 *
 * What IS hashed:
 *   - Customer-visible header: custNo, custName, addr1/2/3, town, postcode,
 *     terms, statement date (YYYYMMDD string from field 6).
 *   - Account aging: current, 1-30, 31-60, 61-90, 91+, total balance
 *     (normalised to 2dp strings so a recomputed 0.10000000001 doesn't
 *     spuriously differ from 0.10).
 *   - Invoice lines sorted by `invNo`, each with invNo, invDate, dueDate,
 *     net, vat, gross.
 *
 * What is NOT hashed:
 *   - `pages` (pagination is derived from `lines`; hashing the paged form
 *     would make a different `ROWS_PER_PAGE` look like a content change).
 *   - `pageTotal` (derived).
 *   - The per-line `page` field (BPCS counter; pagination metadata).
 *   - Credit controller fields (`ccName`, `ccEmail`) - these are routing
 *     metadata, not customer-visible statement content.
 *
 * Stored on `Statement.metadata.contentHash`. Compared in
 * `findOrCreateStatement` when `source === 'generated'`.
 */

const crypto = require('crypto');

function s(v) {
  return v == null ? '' : String(v).trim();
}

function money(v) {
  const n = typeof v === 'number' ? v : parseFloat(String(v || '').replace(/[£$€,\s]/g, ''));
  return Number.isFinite(n) ? n.toFixed(2) : '0.00';
}

/**
 * Compute the deterministic content hash for a parsed customer payload.
 * Returns a hex SHA-256 string.
 *
 * @param {object} customer - Output of `parseExportText(...).customerList[i]`
 * @returns {string} hex sha-256 of the normalised content
 */
function computeStatementContentHash(customer) {
  if (!customer) return null;

  const header = {
    custNo: s(customer.custNo),
    custName: s(customer.custName),
    addr1: s(customer.addr1),
    addr2: s(customer.addr2),
    addr3: s(customer.addr3),
    town: s(customer.town),
    postcode: s(customer.postcode),
    terms: s(customer.terms),
    stmtDate: s(customer.stmtDate)
  };

  const aging = {
    current: money(customer.aging?.current),
    od1_30: money(customer.aging?.od1_30),
    od31_60: money(customer.aging?.od31_60),
    od61_90: money(customer.aging?.od61_90),
    od91: money(customer.aging?.od91),
    totalBal: money(customer.aging?.totalBal)
  };

  const lines = Array.isArray(customer.lines) ? customer.lines : [];
  const sorted = [...lines]
    .map((row) => ({
      invNo: s(row.invNo),
      invDate: s(row.invDate),
      dueDate: s(row.dueDate),
      net: money(row.net),
      vat: money(row.vat),
      gross: money(row.gross)
    }))
    .sort((a, b) => {
      if (a.invNo === b.invNo) {
        if (a.invDate === b.invDate) return a.gross.localeCompare(b.gross);
        return a.invDate.localeCompare(b.invDate);
      }
      return a.invNo.localeCompare(b.invNo);
    });

  const normalised = JSON.stringify({ v: 1, header, aging, invoices: sorted });
  return crypto.createHash('sha256').update(normalised).digest('hex');
}

module.exports = {
  computeStatementContentHash
};
