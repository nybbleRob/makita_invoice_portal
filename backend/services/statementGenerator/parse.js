/**
 * ACR11P export parser.
 *
 * Ports the validated prototype parser (`Statement Generator/parse.js`) into the
 * backend with structural validation only:
 *   - exactly 26 tab-delimited fields per non-blank row
 *   - amount fields (18..26) parse as finite numbers (empty = 0)
 *   - payment terms (field 2) is in a recognised set (warning, not fatal)
 *
 * Currency is intentionally NOT checked here - the export has no currency field
 * (every amount is implicitly GBP). The currency guard lives in the worker
 * against `Company.currency` after the customer is matched.
 */

const fs = require('fs');

// Column map (0-based positions after splitting on \t). Mirrors the prototype
// constant so renames stay in lockstep with the verified field map.
const FIELD = {
  custNo: 0,
  terms: 1,
  ccName: 2,
  ccEmail: 3,
  // 4 unused
  stmtDate: 5,
  acctRef: 6,
  page: 7,
  custName: 8,
  town: 9,
  addr1: 10,
  addr2: 11,
  addr3: 12,
  postcode: 13,
  invNo: 14,
  invDate: 15,
  dueDate: 16,
  net: 17,
  vat: 18,
  gross: 19,
  current: 20,
  od1_30: 21,
  od31_60: 22,
  od61_90: 23,
  od91: 24,
  totalBal: 25
};

const EXPECTED_FIELDS = 26;
const ROWS_PER_PAGE = 36;
const AMOUNT_FIELDS = [
  FIELD.net, FIELD.vat, FIELD.gross,
  FIELD.current, FIELD.od1_30, FIELD.od31_60, FIELD.od61_90, FIELD.od91, FIELD.totalBal
];

// Known payment-term strings seen across real BPCS exports. Unknown values are
// flagged as a warning (not fatal) so a new term added by Finance doesn't break
// a statement run - we surface it for ops review instead.
const RECOGNISED_TERMS = new Set([
  '60 DAYS E.O.M.',
  '60 DAYS EOM',
  '45 DAYS EOM',
  '45 DAYS E.O.M.',
  '30 DAYS EOM',
  '30 DAYS E.O.M.',
  'PRO FORMA INV',
  'PRO FORMA',
  'CASH ON DELIVERY',
  'COD',
  'NET CASH'
]);

function s(v) {
  return (v == null ? '' : String(v)).trim();
}

function n(v) {
  const x = parseFloat(s(v));
  return Number.isFinite(x) ? x : 0;
}

/**
 * "20260302" -> "2026-03-02". Returns the original string if it isn't an
 * 8-character numeric date (the consumer can decide how to handle it).
 */
function isoDate(yyyymmdd) {
  const d = s(yyyymmdd);
  return d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : d;
}

/**
 * "20260302" -> "02.03.2026" — the dotted UK format the printed statement uses.
 */
function ukDate(yyyymmdd) {
  const d = s(yyyymmdd);
  return d.length === 8 ? `${d.slice(6, 8)}.${d.slice(4, 6)}.${d.slice(0, 4)}` : d;
}

/**
 * Parse the export from a path on disk.
 * @param {string} path
 * @returns {ReturnType<typeof parseExportText>}
 */
function parseExportFile(path) {
  const raw = fs.readFileSync(path, 'utf8');
  return parseExportText(raw);
}

/**
 * Parse the export text. Splits on \r\n or \n, filters blank lines, validates
 * each row, groups by customer, and paginates at 36 rows/page.
 *
 * @param {string} raw - The raw text content of the .TXT file
 * @returns {{
 *   customers: Map<string, object>,
 *   customerList: object[],
 *   validation: {
 *     totalLines: number,
 *     parsedLines: number,
 *     malformedLines: { lineNumber: number, reason: string }[],
 *     unknownTerms: { lineNumber: number, customerNo: string, terms: string }[]
 *   },
 *   statementDate: string | null   // ISO YYYY-MM-DD from the first valid row's field 6
 * }}
 */
function parseExportText(raw) {
  if (raw == null) {
    throw new Error('parseExportText: input is required');
  }

  const lines = String(raw).split(/\r?\n/);
  const customers = new Map();
  const malformedLines = [];
  const unknownTerms = [];
  let parsedLines = 0;
  let statementDate = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length === 0) continue;

    const lineNumber = i + 1;
    const c = line.split('\t');

    if (c.length !== EXPECTED_FIELDS) {
      malformedLines.push({
        lineNumber,
        reason: `expected ${EXPECTED_FIELDS} tab-delimited fields, got ${c.length}`
      });
      continue;
    }

    let amountInvalid = null;
    for (const idx of AMOUNT_FIELDS) {
      const raw = s(c[idx]);
      if (raw === '') continue;
      const num = parseFloat(raw);
      if (!Number.isFinite(num)) {
        amountInvalid = { idx, raw };
        break;
      }
    }
    if (amountInvalid) {
      malformedLines.push({
        lineNumber,
        reason: `field ${amountInvalid.idx + 1} is not a finite number: "${amountInvalid.raw}"`
      });
      continue;
    }

    const id = s(c[FIELD.custNo]);
    if (id === '') {
      malformedLines.push({ lineNumber, reason: 'empty customer number (field 1)' });
      continue;
    }

    const terms = s(c[FIELD.terms]);
    if (terms && !RECOGNISED_TERMS.has(terms.toUpperCase()) && !RECOGNISED_TERMS.has(terms)) {
      unknownTerms.push({ lineNumber, customerNo: id, terms });
    }

    if (!customers.has(id)) {
      const rowStmtDate = s(c[FIELD.stmtDate]);
      if (!statementDate && rowStmtDate) {
        statementDate = isoDate(rowStmtDate);
      }

      customers.set(id, {
        custNo: id,
        terms,
        ccName: s(c[FIELD.ccName]),
        ccEmail: s(c[FIELD.ccEmail]),
        stmtDate: rowStmtDate,
        custName: s(c[FIELD.custName]),
        town: s(c[FIELD.town]),
        addr1: s(c[FIELD.addr1]),
        addr2: s(c[FIELD.addr2]),
        addr3: s(c[FIELD.addr3]),
        postcode: s(c[FIELD.postcode]),
        // Account-level aging totals - identical across the customer's rows
        // (the file repeats them on every line; we capture them from the first).
        aging: {
          current: n(c[FIELD.current]),
          od1_30: n(c[FIELD.od1_30]),
          od31_60: n(c[FIELD.od31_60]),
          od61_90: n(c[FIELD.od61_90]),
          od91: n(c[FIELD.od91]),
          totalBal: n(c[FIELD.totalBal])
        },
        lines: []
      });
    }

    customers.get(id).lines.push({
      page: s(c[FIELD.page]),
      invNo: s(c[FIELD.invNo]),
      invDate: s(c[FIELD.invDate]),
      dueDate: s(c[FIELD.dueDate]),
      net: n(c[FIELD.net]),
      vat: n(c[FIELD.vat]),
      gross: n(c[FIELD.gross])
    });

    parsedLines++;
  }

  for (const cust of customers.values()) {
    const startPage = parseInt(cust.lines[0]?.page, 10) || 1;
    const pages = [];
    for (let i = 0; i < cust.lines.length; i += ROWS_PER_PAGE) {
      const rows = cust.lines.slice(i, i + ROWS_PER_PAGE);
      pages.push({
        pageNo: String(startPage + pages.length),
        rows,
        // Page total set directly (not via formula) so the PDF doesn't depend
        // on the template's recalc-on-open behaviour in LibreOffice.
        pageTotal: rows.reduce((sum, r) => sum + r.gross, 0)
      });
    }
    cust.pages = pages;
  }

  return {
    customers,
    customerList: Array.from(customers.values()),
    validation: {
      totalLines: lines.filter((l) => l.length > 0).length,
      parsedLines,
      malformedLines,
      unknownTerms
    },
    statementDate
  };
}

module.exports = {
  FIELD,
  EXPECTED_FIELDS,
  ROWS_PER_PAGE,
  RECOGNISED_TERMS,
  isoDate,
  ukDate,
  parseExportFile,
  parseExportText
};
