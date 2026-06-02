#!/usr/bin/env node
/**
 * verify-statement-generate-impact.js
 *
 * READ-ONLY dry-run of a /api/statements/generate call. Parses an ACR11P
 * export, matches each customer to a CORP company, computes the content hash,
 * looks up the existing Statement for (companyId, periodEnd), and reports
 * EXACTLY what the worker WOULD do for each customer.
 *
 * Two pieces of information per customer:
 *   1. underlying state ("class")  - the row's situation independent of flags:
 *        new           : no existing Statement
 *        unchanged     : existing contentHash matches the incoming export
 *        baseline      : existing row has no contentHash yet
 *        correction    : existing contentHash differs from the incoming export
 *        suppressed    : existing source=manual_upload would block a generated correction
 *        unmatched     : no CORP company for this customer number
 *        currency_skip : matched but company.currency != GBP
 *
 *   2. effective action ("action") - what /generate WOULD do given any flags
 *      you passed (--force-overwrite, --silent). For example:
 *        unchanged + no flags                   -> skip (no regen, no email)
 *        unchanged + --force-overwrite          -> regen + email
 *        unchanged + --force-overwrite --silent -> regen + NO email   (cutover)
 *        suppressed + --force-overwrite         -> regen + email      (operator overrides authority)
 *
 * Writes NOTHING to disk or DB. Run BEFORE the first real /generate call so
 * you can inspect per-customer fate. Especially important before a cutover
 * normalisation run, where pairing --force-overwrite with --silent is the
 * difference between mass-emailing 379 customers and not.
 *
 * Usage:
 *   node backend/scripts/verify-statement-generate-impact.js path/to/export.txt
 *   node backend/scripts/verify-statement-generate-impact.js path/to/export.txt --csv > impact.csv
 *
 *   # Preview cutover normalisation pass: regenerate everything onto the new
 *   # renderer, suppress all customer emails. Run THIS first, eyeball the
 *   # action column, then send the same flags to /api/statements/generate.
 *   node backend/scripts/verify-statement-generate-impact.js path/to/export.txt \
 *     --force-overwrite --silent
 */

const fs = require('fs');
const path = require('path');

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.error('Usage: node verify-statement-generate-impact.js <export.txt> [--csv] [--force-overwrite] [--silent]');
    process.exit(1);
  }

  const positional = args.find((a) => !a.startsWith('--'));
  if (!positional) {
    console.error('ERROR: missing export file path.');
    process.exit(1);
  }
  const exportPath = path.resolve(positional);
  const asCsv = args.includes('--csv');
  const forceOverwrite = args.includes('--force-overwrite');
  const silent = args.includes('--silent');

  if (!fs.existsSync(exportPath)) {
    console.error(`ERROR: export file not found: ${exportPath}`);
    process.exit(1);
  }

  // Lazy-load so the script bails out cleanly on missing dependencies / DB
  // config rather than throwing at import time.
  const { parseExportFile, isoDate } = require('../services/statementGenerator/parse');
  const { computeStatementContentHash } = require('../services/statementGenerator/contentHash');
  const { findCorpCompanyByAccountNumber } = require('../utils/statementImport');
  const { Statement, sequelize } = require('../models');

  console.error(`Parsing ${exportPath}...`);
  const parsed = parseExportFile(exportPath);
  const customers = parsed.customerList;
  const statementDateIso = parsed.statementDate;

  console.error(`Parsed ${customers.length} customer(s); statement date ${statementDateIso || '(none)'}.`);
  console.error(`Validation: parsedLines=${parsed.validation.parsedLines}, malformedLines=${parsed.validation.malformedLines.length}, unknownTerms=${parsed.validation.unknownTerms.length}`);
  console.error(`Flags: forceOverwrite=${forceOverwrite}, silent=${silent}`);

  // Maps the underlying state + flag combination onto the effective action
  // the worker would actually take. Keep this aligned with the gates in
  // backend/jobs/statementGenerate.js (short-circuit + shouldNotify).
  function deriveAction(classification) {
    if (classification === 'unmatched' || classification === 'currency_skip' || classification === 'error') {
      return 'skip';
    }
    if (classification === 'new') {
      return silent ? 'create + silent' : 'create + email';
    }
    if (classification === 'unchanged') {
      if (forceOverwrite) return silent ? 'regen + silent' : 'regen + email';
      return 'skip (unchanged)';
    }
    if (classification === 'baseline') {
      if (forceOverwrite) return silent ? 'regen + silent' : 'regen + email';
      return 'skip (baseline, file preserved)';
    }
    if (classification === 'correction') {
      return silent ? 'regen + silent' : 'regen + email';
    }
    if (classification === 'suppressed') {
      if (forceOverwrite) return silent ? 'regen + silent (auth bypassed)' : 'regen + email (auth bypassed)';
      return 'skip (manual authority blocks)';
    }
    return 'unknown';
  }

  const periodEnd = statementDateIso ? new Date(statementDateIso) : new Date();

  const rows = [];
  const counts = {
    new: 0,
    unchanged: 0,
    baseline: 0,
    correction: 0,
    suppressed: 0,
    unmatched: 0,
    currency_skip: 0
  };
  const actionCounts = {};

  let i = 0;
  for (const customer of customers) {
    i += 1;
    if (!asCsv && i % 50 === 0) {
      console.error(`  ...${i}/${customers.length}`);
    }

    const custNo = String(customer.custNo).trim();
    const contentHash = computeStatementContentHash(customer);

    let classification = 'unknown';
    let companyId = null;
    let companyName = null;
    let companyCurrency = null;
    let existingHash = null;
    let existingSource = null;
    let statementId = null;
    let pdfFileUrl = null;
    let xlsFileUrl = null;
    let note = '';

    try {
      const company = await findCorpCompanyByAccountNumber(custNo);
      if (!company) {
        classification = 'unmatched';
        note = 'No CORP company found for this account number.';
      } else {
        companyId = company.id;
        companyName = company.name;
        companyCurrency = (company.currency || 'GBP').toString().toUpperCase();

        if (companyCurrency !== 'GBP') {
          classification = 'currency_skip';
          note = `Company currency=${companyCurrency}, expected GBP.`;
        } else {
          const existing = await Statement.findOne({
            where: { companyId: company.id, periodEnd }
          });
          if (!existing) {
            classification = 'new';
            note = 'No existing Statement for this (company, periodEnd); would create + notify.';
          } else {
            statementId = existing.id;
            pdfFileUrl = existing.pdfFileUrl || null;
            xlsFileUrl = existing.xlsFileUrl || null;
            const meta = existing.metadata || {};
            existingHash = meta.contentHash || null;
            existingSource = meta.source || 'manual_upload';

            if (existingHash && existingHash === contentHash) {
              classification = 'unchanged';
              note = 'contentHash matches; worker would short-circuit, no regen, no email.';
            } else if (!existingHash) {
              classification = 'baseline';
              note = `No contentHash on existing row (source=${existingSource}); worker would stamp the hash, leave files in place, no email.`;
            } else if (existingSource === 'manual_upload') {
              classification = 'suppressed';
              note = 'contentHash differs but existing source=manual_upload; manual-authority would block the correction (run with forceOverwrite to override).';
            } else {
              classification = 'correction';
              note = 'contentHash differs and existing source=generated; worker would regenerate, replace files, and email.';
            }
          }
        }
      }
    } catch (err) {
      classification = 'error';
      note = `Lookup failed: ${err.message}`;
    }

    counts[classification] = (counts[classification] || 0) + 1;
    const action = deriveAction(classification);
    actionCounts[action] = (actionCounts[action] || 0) + 1;

    rows.push({
      custNo,
      custName: customer.custName || '',
      companyId,
      companyName: companyName || '',
      companyCurrency: companyCurrency || '',
      contentHash: contentHash ? contentHash.slice(0, 16) : '',
      existingHash: existingHash ? existingHash.slice(0, 16) : '',
      existingSource: existingSource || '',
      statementId: statementId || '',
      classification,
      action,
      pdfFileUrl: pdfFileUrl || '',
      xlsFileUrl: xlsFileUrl || '',
      note
    });
  }

  if (asCsv) {
    const headers = Object.keys(rows[0] || { custNo: '', classification: '' });
    process.stdout.write(headers.join(',') + '\n');
    for (const row of rows) {
      const escaped = headers.map((h) => {
        const v = row[h] == null ? '' : String(row[h]);
        return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
      });
      process.stdout.write(escaped.join(',') + '\n');
    }
  } else {
    console.log('');
    console.log('=== Per-customer impact ===');
    const padded = (s, n) => (s + '').padEnd(n).slice(0, n);
    console.log(padded('custNo', 10), padded('class', 13), padded('action', 32), padded('source', 14), padded('cust hash', 18), padded('company', 24));
    console.log('-'.repeat(116));
    for (const r of rows) {
      console.log(
        padded(r.custNo, 10),
        padded(r.classification, 13),
        padded(r.action, 32),
        padded(r.existingSource || '-', 14),
        padded(r.contentHash || '-', 18),
        padded(r.companyName || '-', 24)
      );
    }
  }

  const total = rows.length;
  console.error('');
  console.error('=== Underlying state ===');
  for (const [k, v] of Object.entries(counts)) {
    if (v > 0) console.error(`  ${k.padEnd(15)} ${v.toString().padStart(5)}  (${((v / total) * 100).toFixed(1)}%)`);
  }
  console.error('');
  console.error(`=== Effective action${forceOverwrite || silent ? ' (with --force-overwrite' + (silent ? ' --silent' : '') + ')' : ''} ===`);
  const orderedActions = Object.entries(actionCounts).sort(([, a], [, b]) => b - a);
  for (const [k, v] of orderedActions) {
    console.error(`  ${k.padEnd(36)} ${v.toString().padStart(5)}  (${((v / total) * 100).toFixed(1)}%)`);
  }
  const wouldEmail = (actionCounts['create + email'] || 0)
    + (actionCounts['regen + email'] || 0)
    + (actionCounts['regen + email (auth bypassed)'] || 0);
  console.error('');
  console.error(`  Customers that WOULD receive an email: ${wouldEmail}`);
  console.error(`  ${'TOTAL'.padEnd(36)} ${total.toString().padStart(5)}`);
  console.error('');
  console.error('Reminders:');
  console.error('  - "baseline"       : existing customer-facing file is PRESERVED. No regen.');
  console.error('  - "unchanged"      : nothing happens. No regen.');
  console.error('  - "correction"     : files WOULD be replaced.');
  console.error('  - "suppressed"     : manual-upload-authoritative blocks the generated overwrite.');
  console.error('  - "new"            : a new Statement row WOULD be created.');
  console.error('  - --force-overwrite: bypass content-hash short-circuit AND manual authority.');
  console.error('  - --silent         : never email, even on a real correction or a new statement.');
  console.error('  - cutover preset   : --force-overwrite --silent  (migrate everyone onto the');
  console.error('                       new renderer in one pass with zero customer emails).');

  try {
    await sequelize.close();
  } catch (_) { /* best effort */ }
}

main().catch((err) => {
  console.error('FATAL:', err && err.stack || err);
  process.exit(1);
});
