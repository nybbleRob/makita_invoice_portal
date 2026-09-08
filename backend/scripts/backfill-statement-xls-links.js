#!/usr/bin/env node
/**
 * backfill-statement-xls-links.js
 *
 * Repairs statements that have a PDF but no XLS attached.
 *
 * Cause: findOrCreateStatement's content-hash no-op used to fire before the
 * empty-slot check. statementGenerate calls it twice with the same
 * contentHash - PDF first, then XLSX - so the PDF call created the row and
 * stamped the hash, and the XLSX call short-circuited as a "no change".
 * The XLSX was still generated and still has a File row; the Statement just
 * never pointed at it, so the portal showed no XLS download and
 * notifications had no XLS to attach.
 *
 * The generator writes both formats to the same folder with the same base
 * name ({custNo}_Statement_{YYYY-MM-DD}.pdf / .xlsx), so the XLSX path is
 * derived from pdfFileUrl by swapping the extension, then verified on disk
 * before anything is written.
 *
 * DRY RUN BY DEFAULT. Nothing is written without --apply.
 * Never sends a notification: this only links files that already exist.
 *
 * Usage:
 *   node backend/scripts/backfill-statement-xls-links.js           # report only
 *   node backend/scripts/backfill-statement-xls-links.js --apply   # write links
 */

const fs = require('fs');
const path = require('path');
const { sequelize } = require('../config/database');
const { Statement } = require('../models');

const APPLY = process.argv.includes('--apply');

async function main() {
  await sequelize.authenticate();

  const candidates = await Statement.findAll({
    where: sequelize.literal(`"xlsFileUrl" IS NULL AND "pdfFileUrl" IS NOT NULL`),
    order: [['periodEnd', 'ASC'], ['createdAt', 'ASC']]
  });

  console.log('');
  console.log(APPLY
    ? '⚙️  APPLY MODE - statement rows will be updated.'
    : '🔍 DRY RUN - nothing will be written. Re-run with --apply to commit.');
  console.log(`Statements with a PDF but no XLS: ${candidates.length}`);
  console.log('');

  if (candidates.length === 0) {
    console.log('✅ Nothing to repair.');
    return;
  }

  let linked = 0;
  let missingOnDisk = 0;
  const missing = [];

  for (const stmt of candidates) {
    const pdfPath = stmt.pdfFileUrl;
    const ext = path.extname(pdfPath);

    // Only derive when the PDF really is a .pdf; anything else is a shape we
    // did not generate and should not guess at.
    if (ext.toLowerCase() !== '.pdf') {
      missingOnDisk++;
      missing.push({ id: stmt.id, reason: `unexpected extension ${ext}`, pdfPath });
      continue;
    }

    const xlsxPath = pdfPath.slice(0, -ext.length) + '.xlsx';

    if (!fs.existsSync(xlsxPath)) {
      missingOnDisk++;
      missing.push({ id: stmt.id, reason: 'xlsx not on disk', pdfPath });
      continue;
    }

    linked++;
    if (APPLY) {
      const metadata = { ...(stmt.metadata || {}) };
      if (!metadata.fileSlots) metadata.fileSlots = {};
      metadata.fileSlots.xls = {
        ...(metadata.fileSlots.xls || {}),
        path: xlsxPath,
        processingMethod: 'generated_xlsx',
        attachedAt: new Date().toISOString(),
        backfilled: true,
        backfillReason: 'content-hash no-op stranded the XLS slot on creation'
      };
      await stmt.update({ xlsFileUrl: xlsxPath, metadata });
    } else if (linked <= 5) {
      console.log(`  would link: ${path.basename(xlsxPath)}`);
    }
  }

  console.log('');
  console.log(`  XLS found and ${APPLY ? 'linked' : 'linkable'} : ${linked}`);
  console.log(`  XLS missing on disk           : ${missingOnDisk}`);

  if (missing.length > 0) {
    console.log('');
    console.log('  These need regenerating rather than relinking:');
    for (const m of missing.slice(0, 20)) {
      console.log(`    ${m.id}  ${m.reason}`);
    }
    if (missing.length > 20) console.log(`    ... and ${missing.length - 20} more`);
  }

  console.log('');
  if (!APPLY && linked > 0) {
    console.log('Re-run with --apply to write these links.');
  } else if (APPLY) {
    console.log('✅ Done. No notifications were sent - this only linked existing files.');
  }
}

main()
  .then(async () => { await sequelize.close(); process.exit(0); })
  .catch(async (err) => {
    console.error('');
    console.error('❌ Backfill failed:', err.message);
    try { await sequelize.close(); } catch (_) {}
    process.exit(1);
  });
