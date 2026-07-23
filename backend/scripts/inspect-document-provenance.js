/**
 * Show how a document actually came to exist: whether it was created directly by
 * the importer, or landed in Unallocated first and was allocated by hand.
 *
 * The two routes mint placeholder invoice numbers differently:
 *   jobs/invoiceImport.js:1134   getParsedValue(parsedData,'invoiceNumber') || parsedData.invoiceNumber
 *   routes/unallocated.js:1164   parsedData.invoiceNumber || parsedData.documentNumber
 * The second does no fieldLabels mapping, so it can mint a placeholder even when
 * the value was extracted correctly under a template-prefixed key.
 *
 * Tells them apart using markers that persist regardless of log retention:
 *   - file.metadata.previousFilePath  set ONLY by the allocation handler
 *   - file.processingMethod           which parser produced parsedData
 *   - the activity log (Redis) entry  unallocated_allocated, incl. who did it
 *
 * Usage:
 *   node scripts/inspect-document-provenance.js --hash dca5a39b
 *   node scripts/inspect-document-provenance.js --invoice "INV-1784790079712-dca5a39b"
 */

const { Op } = require('sequelize');
const { File, Invoice, CreditNote } = require('../models');

const argv = process.argv.slice(2);
const getArg = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : d;
};

const j = (v) => JSON.stringify(v, null, 2);

(async () => {
  const invoiceRef = getArg('invoice');
  let hashPrefix = getArg('hash');

  if (!hashPrefix && invoiceRef) {
    const m = /^INV-\d+-([0-9a-f]{8})$/i.exec(invoiceRef);
    if (m) hashPrefix = m[1];
  }
  if (!hashPrefix) throw new Error('Provide --hash <prefix> or --invoice <number>');

  const file = await File.findOne({ where: { fileHash: { [Op.like]: `${hashPrefix}%` } } });
  if (!file) throw new Error(`No File with hash prefix ${hashPrefix}`);

  console.log('=== FILE ===');
  console.log(`  fileName:         ${file.fileName}`);
  console.log(`  status:           ${file.status}`);
  console.log(`  failureReason:    ${file.failureReason || '(none)'}`);
  console.log(`  processingMethod: ${file.processingMethod || '(none)'}`);
  console.log(`  uploadedAt:       ${file.uploadedAt ? file.uploadedAt.toISOString() : '(none)'}`);
  console.log(`  processedAt:      ${file.processedAt ? file.processedAt.toISOString() : '(none)'}`);
  console.log(`  manuallyEditedBy: ${file.manuallyEditedById || '(none)'}`);

  const meta = file.metadata || {};
  console.log('\n=== ALLOCATION MARKER ===');
  if (meta.previousFilePath) {
    console.log('  *** WENT THROUGH UNALLOCATED ***');
    console.log(`  metadata.previousFilePath = ${meta.previousFilePath}`);
    console.log('  Only routes/unallocated.js sets this - the file was allocated by a user,');
    console.log('  so the placeholder came from unallocated.js:1164, not the importer.');
  } else {
    console.log('  No metadata.previousFilePath - created directly by the importer.');
    console.log('  The placeholder therefore came from jobs/invoiceImport.js:1134.');
  }
  if (Object.keys(meta).length) console.log(`\n  full metadata: ${j(meta)}`);

  if (Array.isArray(file.editLog) && file.editLog.length) {
    console.log(`\n=== EDIT LOG (${file.editLog.length}) ===`);
    console.log(j(file.editLog));
  }

  console.log('\n=== PARSED DATA (as stored at import) ===');
  const pd = file.parsedData;
  if (!pd) {
    console.log('  (null - nothing was stored)');
  } else {
    console.log(j(pd));
    console.log('\n  --- interpretation ---');
    const direct = pd.invoiceNumber;
    const hasLabels = !!pd.fieldLabels;
    console.log(`  parsedData.invoiceNumber : ${direct !== undefined ? `"${direct}"` : '(absent)'}`);
    console.log(`  parsedData.fieldLabels   : ${hasLabels ? 'present' : 'ABSENT'}`);
    if (!hasLabels) {
      console.log('    ^ getParsedValue() returns undefined immediately when fieldLabels is');
      console.log('      absent, regardless of what else is present.');
    }
    const prefixed = Object.keys(pd).filter(k => /invoice_?number/i.test(k) && k !== 'invoiceNumber');
    if (prefixed.length) {
      console.log(`  template-prefixed keys   : ${prefixed.map(k => `${k}="${pd[k]}"`).join(', ')}`);
      console.log('    ^ unallocated.js reads only the bare key, so these would be missed.');
    }
    if (direct) {
      console.log('\n  >>> The number WAS extracted. Extraction is not the bug - whichever');
      console.log('  >>> consumer created the document failed to read it.');
    } else {
      console.log('\n  >>> The number was NOT in parsedData. Extraction genuinely failed at');
      console.log('  >>> import time, even though it succeeds on the stored bytes now.');
    }
  }

  // Matching document rows
  console.log('\n=== DOCUMENT ROWS ===');
  for (const [label, model, field] of [['Invoice', Invoice, 'invoiceNumber'], ['CreditNote', CreditNote, 'creditNoteNumber']]) {
    const rows = await model.findAll({
      where: { [field]: { [Op.like]: `%${hashPrefix}%` } },
      limit: 5,
    }).catch(() => []);
    for (const r of rows) {
      console.log(`  ${label} ${r.id}`);
      console.log(`     ${field}: ${r[field]}`);
      console.log(`     createdAt:  ${r.createdAt ? r.createdAt.toISOString() : '?'}`);
      console.log(`     updatedAt:  ${r.updatedAt ? r.updatedAt.toISOString() : '?'}`);
      const m = /^INV-(\d+)-/.exec(r[field] || '');
      if (m) {
        const minted = new Date(parseInt(m[1], 10));
        console.log(`     placeholder minted at: ${minted.toISOString()}`);
        if (file.uploadedAt) {
          const gap = (minted - new Date(file.uploadedAt)) / 1000;
          console.log(`     gap from file upload:  ${gap.toFixed(1)}s`);
          console.log(gap < 60
            ? '     ^ same import run - consistent with the automated importer.'
            : '     ^ well after import - consistent with a later manual allocation.');
        }
      }
    }
  }

  // Activity log (Redis) - look for an allocation event naming this file
  console.log('\n=== ACTIVITY LOG (Redis) ===');
  try {
    const { redis } = require('../config/redis');
    const ids = await redis.zrevrange('activity:index', 0, 3000);
    let hits = 0;
    for (const id of ids) {
      const entry = await redis.hgetall(`activity:logs:${id}`);
      if (!entry || !Object.keys(entry).length) continue;
      const blob = JSON.stringify(entry);
      if (!blob.includes(file.fileName) && !blob.includes(hashPrefix)) continue;
      hits++;
      console.log(`  [${entry.timestamp || '?'}] ${entry.type}`);
      console.log(`     by:     ${entry.userEmail || entry.userId || '(system)'}`);
      console.log(`     action: ${entry.action || ''}`);
      if (entry.details) console.log(`     details: ${entry.details}`);
    }
    if (!hits) {
      console.log('  No entries reference this file in the last 3000 log records.');
      console.log('  (Logs are pruned after 14 days - absence is not proof for older files.)');
    }
  } catch (e) {
    console.log(`  Could not read activity logs: ${e.message}`);
  }

  process.exit(0);
})().catch(err => {
  console.error(`\nERROR: ${err.message}`);
  process.exit(1);
});
