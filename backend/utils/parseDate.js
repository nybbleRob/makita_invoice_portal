/**
 * Shared day-first date parser.
 *
 * Single source of truth for converting human-readable date strings (from PDF
 * extraction, Excel parsing, the ACR11P CSV, etc.) into a UTC-midnight Date.
 *
 * Pattern coverage (all explicit, no implicit locale guesses):
 *  - dd/mm/yy or dd/mm/yyyy
 *  - dd-mm-yy or dd-mm-yyyy
 *  - dd.mm.yy or dd.mm.yyyy  (the printed ACR11P statement uses this)
 *  - yyyy-mm-dd  (ISO; also what `isoDate(YYYYMMDD)` from the generator emits)
 *  - yyyy/mm/dd
 *  - dd MMM yyyy   (e.g. "05 Dec 2025")
 *  - MMM dd, yyyy  (e.g. "Dec 05, 2025")
 *
 * Always interprets numeric formats as DAY-FIRST. This matters because
 * `new Date("02/03/2026")` in V8 is read as MM/DD/YYYY (American) and would
 * silently swap day/month for any day <= 12. Using `Date.UTC(...)` also
 * guarantees the result lands at 00:00 UTC, so two callers parsing the same
 * string from different sources land on exactly the same instant (critical
 * for `(companyId, periodEnd)` dedupe between the CSV-generated path and the
 * manual-upload/FTP paths).
 *
 * Returns:
 *  - A valid Date on success.
 *  - `null` on failure (caller decides the fallback - e.g. `new Date()` for
 *    upload-stamped fields, or surfacing a validation error for invoice dates).
 *
 * Optional `logger` shape: `{ log(msg), warn(msg) }`. Defaults to silent.
 */

const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const PATTERNS = [
  { pattern: /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/, format: 'dd/mm/yy' },
  { pattern: /^(\d{1,2})-(\d{1,2})-(\d{2,4})$/, format: 'dd-mm-yy' },
  { pattern: /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/, format: 'dd.mm.yy' },
  { pattern: /^(\d{4})-(\d{1,2})-(\d{1,2})$/, format: 'yyyy-mm-dd' },
  { pattern: /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/, format: 'yyyy/mm/dd' },
  { pattern: /^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{2,4})$/, format: 'dd MMM yyyy' },
  { pattern: /^([A-Za-z]{3,})\s+(\d{1,2}),\s+(\d{2,4})$/, format: 'MMM dd, yyyy' }
];

/**
 * Parse a date string into a UTC Date, day-first for numeric formats.
 * Returns null if no pattern matches and the standard Date parser also fails.
 *
 * @param {string|number|Date|null|undefined} input
 * @param {{ log?: (m: string) => void, warn?: (m: string) => void }} [logger]
 * @returns {Date | null}
 */
function parseDate(input, logger) {
  if (input == null || input === '') return null;
  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : input;
  }

  const log = (logger && logger.log) || (() => {});
  const warn = (logger && logger.warn) || (() => {});

  let str;
  try {
    str = input.toString().trim();
  } catch (_) {
    return null;
  }
  if (!str) return null;

  for (const { pattern, format } of PATTERNS) {
    const match = str.match(pattern);
    if (!match) continue;

    let day;
    let month;
    let year;

    if (format.includes('MMM')) {
      const monthStr = (format === 'dd MMM yyyy' ? match[2] : match[1]).toLowerCase();
      month = MONTH_NAMES.findIndex((m) => monthStr.startsWith(m)) + 1;
      if (month === 0) continue;
      if (format === 'dd MMM yyyy') {
        day = parseInt(match[1], 10);
        year = parseInt(match[3], 10);
      } else {
        day = parseInt(match[2], 10);
        year = parseInt(match[3], 10);
      }
    } else if (format.startsWith('yyyy')) {
      year = parseInt(match[1], 10);
      month = parseInt(match[2], 10);
      day = parseInt(match[3], 10);
    } else {
      // dd-first numeric formats: dd/mm/yy, dd-mm-yy, dd.mm.yy
      day = parseInt(match[1], 10);
      month = parseInt(match[2], 10);
      year = parseInt(match[3], 10);
    }

    if (year < 100) {
      year = year < 50 ? 2000 + year : 1900 + year;
    }

    if (month < 1 || month > 12 || day < 1 || day > 31) continue;

    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (
      parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month - 1 &&
      parsed.getUTCDate() === day
    ) {
      log(`Parsed date "${str}" as ${day}/${month}/${year} (${parsed.toISOString().split('T')[0]}) via ${format}`);
      return parsed;
    }
    warn(`Date string "${str}" matched ${format} but resolves to an invalid calendar date (${day}/${month}/${year}).`);
  }

  // Last-resort fallback: standard Date parser. Only accept if it lands
  // on a sensible year (>1900) to avoid e.g. "1" -> 2001-01-01 surprises.
  try {
    const standard = new Date(str);
    if (!Number.isNaN(standard.getTime()) && standard.getUTCFullYear() > 1900) {
      log(`Parsed date "${str}" via standard Date parser: ${standard.toISOString().split('T')[0]}`);
      return standard;
    }
  } catch (_) {
    // fall through
  }

  warn(`Could not parse date "${str}"`);
  return null;
}

/**
 * Like parseDate, but returns `new Date()` when the input is missing or
 * unparseable. Suits upload-timestamp fields where "now" is a sensible
 * default; do NOT use for invoice/statement dates where a wrong date would
 * silently mis-dedupe documents.
 */
function parseDateOrNow(input, logger) {
  const parsed = parseDate(input, logger);
  return parsed || new Date();
}

module.exports = {
  parseDate,
  parseDateOrNow
};
