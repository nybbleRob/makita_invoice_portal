/**
 * Generate the simple-layout XLSX statement (one sheet named after the customer
 * no.) for a parsed customer. Reproduces the existing "{cust} Statement
 * {date}.xlsx" exactly: Arial font, embedded logo, matching column widths/row
 * heights and cell alignment.
 *
 * Ported from the validated prototype `Statement Generator/excel.js`.
 */

const path = require('path');
const ExcelJS = require('exceljs');
const { isoDate } = require('./parse');

const DEFAULT_LOGO_PATH = path.join(__dirname, '..', '..', 'assets', 'statement-template', 'makita_logo.png');
const C = { horizontal: 'center' };

/**
 * Build the XLSX for a single customer and write it to `outPath`.
 *
 * @param {object} cust - parsed customer object from `parseExportText`
 * @param {string} outPath - absolute path where the .xlsx should be written
 * @param {object} [opts]
 * @param {string} [opts.logoPath] - override the logo path (defaults to bundled asset)
 */
async function buildExcel(cust, outPath, opts = {}) {
  const logoPath = opts.logoPath || process.env.STATEMENT_LOGO_PATH || DEFAULT_LOGO_PATH;

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(String(cust.custNo));

  const arial = (size, bold = false) => ({ name: 'Arial', size, bold });
  const BODY = arial(10);
  const HEAD = arial(10, true);

  ws.getColumn('A').width = 15.71;
  ws.getColumn('B').width = 13;
  ws.getColumn('C').width = 13;
  ws.getColumn('D').width = 13;
  ws.getColumn('E').width = 13;
  ws.getColumn('F').width = 18.71;
  ws.getColumn('G').width = 9.14;
  ws.getRow(1).height = 23.25;
  ws.getRow(2).height = 12.75;
  ws.getRow(3).height = 12.75;

  ws.getCell('A1').value = 'STATEMENT';
  ws.getCell('A1').font = arial(18, true);

  const logoId = wb.addImage({ filename: logoPath, extension: 'png' });
  ws.addImage(logoId, { tl: { col: 0, row: 3 }, ext: { width: 129, height: 43 } });

  const custNoVal = /^\d+$/.test(String(cust.custNo)) ? Number(cust.custNo) : cust.custNo;
  const accountBlock = [
    ['E4', 'Account', HEAD, null],
    ['F4', custNoVal, BODY, null],
    ['E5', 'Date', HEAD, null],
    // Date stored as text so the YYYY-MM-DD format is preserved verbatim.
    ['F5', isoDate(cust.stmtDate), BODY, '@']
  ];
  for (const [ref, val, font, fmt] of accountBlock) {
    const cell = ws.getCell(ref);
    cell.value = val;
    cell.font = font;
    cell.alignment = C;
    if (fmt) cell.numFmt = fmt;
  }

  const head = ['Invoice No:', 'Invoice Date', 'Due Date', 'Net Amount', 'Vat Amount', 'Gross Amount'];
  head.forEach((h, i) => {
    const cell = ws.getCell(8, i + 1);
    cell.value = h;
    cell.font = HEAD;
    cell.alignment = C;
    cell.border = { bottom: { style: 'thin' } };
  });

  let r = 9;
  for (const ln of cust.lines) {
    ws.getCell(r, 1).value = /^\d+$/.test(ln.invNo) ? Number(ln.invNo) : ln.invNo;
    ws.getCell(r, 2).value = isoDate(ln.invDate);
    ws.getCell(r, 3).value = isoDate(ln.dueDate);
    ws.getCell(r, 4).value = ln.net;
    ws.getCell(r, 5).value = ln.vat;
    ws.getCell(r, 6).value = ln.gross;
    for (let col = 1; col <= 6; col++) ws.getCell(r, col).font = BODY;
    for (const col of [1, 2, 3]) ws.getCell(r, col).alignment = C;
    for (const col of [4, 5, 6]) ws.getCell(r, col).numFmt = '#,##0.00';
    r++;
  }

  const hr = r + 1;
  const headers = ['CURRENT', 'Overdue 1-30', 'Overdue 31 - 60', 'Overdue 61 - 90', 'Overdue 91+', 'Total Balance GBP'];
  headers.forEach((h, i) => {
    const cell = ws.getCell(hr, i + 1);
    cell.value = h;
    cell.font = HEAD;
    cell.alignment = C;
  });

  const a = cust.aging;
  const agingValues = [a.current, a.od1_30, a.od31_60, a.od61_90, a.od91, a.totalBal];
  agingValues.forEach((v, i) => {
    const cell = ws.getCell(hr + 1, i + 1);
    cell.value = v;
    cell.font = BODY;
    cell.numFmt = '#,##0.00';
    // A..E centred; F (total) keeps default right-alignment via the number format.
    if (i < 5) cell.alignment = C;
  });

  // Force Arial on empty cells in the used range. The original Makita workbook
  // carries Arial as the latent style on blanks; ExcelJS defaults blanks to
  // Calibri which makes the file fail a cell-for-cell font diff.
  for (let row = 1; row <= hr + 1; row++) {
    for (let col = 1; col <= 6; col++) {
      const cell = ws.getCell(row, col);
      if (cell.value === null || cell.value === undefined) cell.font = BODY;
    }
  }

  await wb.xlsx.writeFile(outPath);
  return outPath;
}

module.exports = {
  buildExcel,
  DEFAULT_LOGO_PATH
};
