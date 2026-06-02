#!/usr/bin/env node
/**
 * Verification harness for the new statement generator.
 *
 * Runs the parallel-validation step from
 * `.cursor/plans/statement_generator_from_export_*.plan.md`:
 *
 *   1. Parse an ACR11P export (no DB writes, no jobs, no emails).
 *   2. Print parse stats - total/valid/malformed lines, unknown terms.
 *   3. For each requested customer (default: 14, 33), generate XLSX + PDF into
 *      a temp directory using the same modules the worker uses.
 *   4. Print parsed totals vs. summary balance so per-page sums can be diffed
 *      to the penny against the current pipeline.
 *
 * The script is read-only against the database (it does NOT touch Statement,
 * File, or notifications). Safe to run on production data.
 *
 * Usage:
 *   node backend/scripts/verify-statement-generator.js <export.txt> [custNos]
 *   node backend/scripts/verify-statement-generator.js ./ACR11P.TXT
 *   node backend/scripts/verify-statement-generator.js ./ACR11P.TXT 14,33,127
 *
 * Env overrides:
 *   STATEMENT_TEMPLATE_PATH=/path/to/ACR11P.xlsx
 *   STATEMENT_PDF_RENDERER=unoconvert|soffice|auto
 *   UNOSERVER_PORT=2003
 *   VERIFY_OUTPUT_DIR=/tmp/verify   (overrides default /tmp/stmtgen_verify)
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const { parseExportFile } = require('../services/statementGenerator/parse');
const { buildExcel } = require('../services/statementGenerator/excel');
const { buildPdf } = require('../services/statementGenerator/pdf');

function fail(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

function fmtGbp(n) {
  return Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function main() {
  const [, , exportPath, custCsv] = process.argv;
  if (!exportPath) {
    fail('usage: verify-statement-generator.js <export.txt> [custNos]');
  }
  if (!fs.existsSync(exportPath)) {
    fail(`export file not found: ${exportPath}`);
  }

  const selectedCustNos = (custCsv || '14,33')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const outDir = process.env.VERIFY_OUTPUT_DIR
    || path.join(os.tmpdir(), 'stmtgen_verify');
  fs.mkdirSync(outDir, { recursive: true });

  console.log('=== Statement Generator Verification ===');
  console.log(`source       : ${path.basename(exportPath)}`);
  console.log(`output dir   : ${outDir}`);
  console.log(`customers    : ${selectedCustNos.join(', ')}`);
  console.log();

  const t0 = Date.now();
  const parsed = parseExportFile(exportPath);
  const parseMs = Date.now() - t0;

  const totalInvoices = parsed.customerList.reduce((s, c) => s + c.lines.length, 0);
  const grandBalance = parsed.customerList.reduce((s, c) => s + (c.aging?.totalBal || 0), 0);

  console.log('--- Parse summary ---');
  console.log(`customers parsed : ${parsed.customers.size}`);
  console.log(`invoice lines    : ${totalInvoices}`);
  console.log(`sum of balances  : £${fmtGbp(grandBalance)}`);
  console.log(`statement date   : ${parsed.statementDate || '(not detected)'}`);
  console.log(`malformed lines  : ${parsed.validation.malformedLines.length}`);
  console.log(`unknown terms    : ${parsed.validation.unknownTerms.length}`);
  console.log(`parse time       : ${parseMs} ms`);

  if (parsed.validation.malformedLines.length > 0) {
    console.log('\n--- Malformed lines (first 10) ---');
    for (const m of parsed.validation.malformedLines.slice(0, 10)) {
      console.log(`  line ${m.lineNumber}: ${m.reason}`);
    }
  }

  if (parsed.validation.unknownTerms.length > 0) {
    console.log('\n--- Unknown payment terms (first 10) ---');
    for (const u of parsed.validation.unknownTerms.slice(0, 10)) {
      console.log(`  line ${u.lineNumber} cust=${u.customerNo}: "${u.terms}"`);
    }
  }

  console.log('\n--- Generating samples ---');
  const renderer = process.env.STATEMENT_PDF_RENDERER || 'auto';
  console.log(`renderer (pdf)   : ${renderer}`);

  const date = parsed.statementDate || new Date().toISOString().slice(0, 10);

  for (const custNo of selectedCustNos) {
    const cust = parsed.customers.get(custNo);
    if (!cust) {
      console.log(`  [${custNo}] NOT FOUND in export`);
      continue;
    }

    const xlsxPath = path.join(outDir, `${custNo}_Statement_${date}.xlsx`);
    const pdfPath = path.join(outDir, `${custNo}_Statement_${date}.pdf`);

    const lineSum = cust.lines.reduce((s, l) => s + l.gross, 0);
    const match = Math.abs(lineSum - (cust.aging?.totalBal || 0)) < 0.01;

    console.log(`  [${custNo}] ${cust.custName || ''}`);
    console.log(`        invoices=${cust.lines.length} pages=${cust.pages.length}`);
    console.log(`        page totals=[${cust.pages.map((p) => fmtGbp(p.pageTotal)).join(', ')}]`);
    console.log(`        sum(gross)=£${fmtGbp(lineSum)}  totalBalance=£${fmtGbp(cust.aging?.totalBal || 0)}  match=${match}`);

    try {
      const tXlsx = Date.now();
      await buildExcel(cust, xlsxPath);
      console.log(`        xlsx OK (${Date.now() - tXlsx}ms): ${xlsxPath}`);
    } catch (err) {
      console.log(`        xlsx FAILED: ${err.message}`);
    }

    if (process.env.SKIP_PDF === '1') {
      console.log('        pdf  SKIPPED (SKIP_PDF=1)');
      continue;
    }

    try {
      const tPdf = Date.now();
      const summary = await buildPdf(cust, pdfPath, {
        renderer: renderer === 'auto' ? undefined : renderer,
        unoPort: process.env.UNOSERVER_PORT ? parseInt(process.env.UNOSERVER_PORT, 10) : undefined
      });
      console.log(`        pdf  OK (${Date.now() - tPdf}ms, ${summary.pages || cust.pages.length} pages via ${summary.renderer || renderer}): ${pdfPath}`);
    } catch (err) {
      console.log(`        pdf  FAILED: ${err.message}`);
    }
  }

  console.log();
  console.log('--- Done ---');
  console.log('Next steps (parallel-validation):');
  console.log('  1. Compare each generated PDF against the existing pipeline\'s PDF');
  console.log('     for the same customer + statement date. Both should match to');
  console.log('     the penny: page count, page totals, aging row, credit notes');
  console.log('     (red parentheses).');
  console.log('  2. Compare XLSX cell-by-cell using your spreadsheet diff of choice.');
  console.log('  3. Once happy, switch notifications onto the new pipeline.');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
