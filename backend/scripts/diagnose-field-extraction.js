/**
 * Diagnose why a template zone failed to extract a value from an imported PDF.
 *
 * Runs the SAME extraction the importer runs, against the SAME stored bytes and
 * the SAME template coordinates - so unlike re-uploading a copy to Test Parse,
 * the result is not affected by which file you happened to pick.
 *
 * Usage:
 *   node scripts/diagnose-field-extraction.js --invoice "INV-1784790079712-dca5a39b"
 *   node scripts/diagnose-field-extraction.js --hash dca5a39b
 *   node scripts/diagnose-field-extraction.js --file <fileId> --field invoiceNumber
 *
 * Options:
 *   --field <name>   Standard field to focus on (default: invoiceNumber)
 *   --band <n>       Show every text item in the top n% of page 1 (default: 20)
 */

const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');
const { File, Invoice, Template } = require('../models');
const { mapToStandardName } = require('../utils/standardFields');

const argv = process.argv.slice(2);
const getArg = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};

const targetField = getArg('field', 'invoiceNumber');
const bandPct = parseFloat(getArg('band', '20')) / 100;

async function findFile() {
  const invoiceRef = getArg('invoice');
  const hashPrefix = getArg('hash');
  const fileId = getArg('file');

  if (fileId) return File.findByPk(fileId);

  if (hashPrefix) {
    return File.findOne({ where: { fileHash: { [Op.like]: `${hashPrefix}%` } } });
  }

  if (invoiceRef) {
    const invoice = await Invoice.findOne({ where: { invoiceNumber: invoiceRef } });
    if (!invoice) throw new Error(`No invoice found with number "${invoiceRef}"`);
    console.log(`Invoice ${invoice.id}`);
    // Invoice has no fileId column - placeholder numbers embed the file-hash
    // prefix instead: INV-<ms>-<hash8>
    const m = /^INV-\d+-([0-9a-f]{8})$/i.exec(invoiceRef);
    if (m) {
      console.log(`Falling back to hash prefix from placeholder: ${m[1]}`);
      return File.findOne({ where: { fileHash: { [Op.like]: `${m[1]}%` } } });
    }
    return null;
  }

  throw new Error('Provide one of --invoice, --hash or --file');
}

(async () => {
  const file = await findFile();
  if (!file) throw new Error('Could not locate a File record for that reference');

  console.log('\n=== FILE ===');
  console.log(`  id:       ${file.id}`);
  console.log(`  fileName: ${file.fileName}`);
  console.log(`  hash:     ${file.fileHash}`);
  console.log(`  status:   ${file.status}`);
  console.log(`  path:     ${file.filePath}`);

  const abs = path.isAbsolute(file.filePath)
    ? file.filePath
    : path.join(__dirname, '..', file.filePath);

  if (!fs.existsSync(abs)) throw new Error(`Stored PDF is missing on disk: ${abs}`);
  const pdfBuffer = fs.readFileSync(abs);
  console.log(`  bytes:    ${pdfBuffer.length}`);

  const template = await Template.findTemplateByFileType('pdf', 'invoice');
  if (!template) throw new Error('No PDF invoice template found');
  console.log(`\n=== TEMPLATE ===\n  ${template.name || template.id} (${template.templateType})`);

  // Locate the zone for the requested field
  let zoneFieldName = null;
  let zone = null;
  for (const [fieldId, coords] of Object.entries(template.coordinates || {})) {
    if ((mapToStandardName(fieldId) || fieldId) === targetField && coords?.normalized) {
      zoneFieldName = fieldId;
      zone = coords.normalized;
      break;
    }
  }
  if (!zone) throw new Error(`Template has no normalized zone for "${targetField}"`);

  console.log(`\n=== ZONE for ${targetField} (${zoneFieldName}) ===`);
  console.log(`  left=${zone.left} top=${zone.top} right=${zone.right} bottom=${zone.bottom} page=${zone.page || 1}`);

  // Run the real extractor
  const { extractTextFromNormalizedRegion, getCachedPageData } = require('../utils/pdfCoordinates');
  const pageNum = zone.page || 1;

  let extracted = null;
  try {
    extracted = await extractTextFromNormalizedRegion(pdfBuffer, {
      left: zone.left, top: zone.top, right: zone.right, bottom: zone.bottom, page: pageNum,
    });
  } catch (e) {
    console.log(`\n  EXTRACTOR THREW: ${e.message}`);
  }
  console.log(`\n=== RESULT ===\n  extracted: ${extracted ? `"${extracted}"` : '(empty - this is the bug)'}`);

  // Dump every text item in the top band so we can see where the value actually sits.
  // pdfjs-dist 5.x is ESM, so load it the same way pdfCoordinates.js does.
  let pdfjsLib;
  try {
    const m = await import('pdfjs-dist/legacy/build/pdf.mjs');
    pdfjsLib = m.default || m;
  } catch (e) {
    const m = await import('pdfjs-dist');
    pdfjsLib = m.default || m;
  }
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(pdfBuffer) }).promise;
  const { viewport, textContent } = await getCachedPageData(pdf, pageNum);
  const W = viewport.width, H = viewport.height;

  console.log(`\n=== PAGE ${pageNum} of ${pdf.numPages} ===`);
  console.log(`  size: ${W.toFixed(2)} x ${H.toFixed(2)} pt   rotation: ${viewport.rotation}`);

  console.log(`\n=== TEXT ITEMS IN TOP ${(bandPct * 100).toFixed(0)}% (normalized) ===`);
  console.log('   inZone  nx      ny      text');
  const rows = [];
  for (const item of textContent.items) {
    if (!item.str || !item.str.trim()) continue;
    const nx = item.transform[4] / W;
    const ny = 1 - (item.transform[5] / H);
    if (ny > bandPct) continue;
    const inZone = nx >= zone.left && nx <= zone.right && ny >= zone.top && ny <= zone.bottom;
    rows.push({ nx, ny, inZone, str: item.str.trim(), width: item.width });
  }
  rows.sort((a, b) => a.ny - b.ny || a.nx - b.nx);
  for (const r of rows) {
    console.log(`   ${r.inZone ? ' YES  ' : '  .   '}  ${r.nx.toFixed(4)}  ${r.ny.toFixed(4)}  "${r.str}"`);
  }

  // If nothing matched, say how far off the nearest plausible value was
  if (!extracted) {
    console.log('\n=== NEAREST MISSES ===');
    const near = rows
      .filter(r => !r.inZone && /\d{4,}/.test(r.str))
      .map(r => {
        const dx = r.nx < zone.left ? zone.left - r.nx : r.nx > zone.right ? r.nx - zone.right : 0;
        const dy = r.ny < zone.top ? zone.top - r.ny : r.ny > zone.bottom ? r.ny - zone.bottom : 0;
        return { ...r, dx, dy, dist: Math.hypot(dx, dy) };
      })
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 5);
    for (const n of near) {
      const parts = [];
      if (n.dx) parts.push(`${(n.dx * W).toFixed(1)}pt horizontally`);
      if (n.dy) parts.push(`${(n.dy * H).toFixed(1)}pt vertically`);
      console.log(`   "${n.str}" at (${n.nx.toFixed(4)}, ${n.ny.toFixed(4)}) - outside by ${parts.join(' and ') || '0'}`);
    }
  }

  process.exit(0);
})().catch(err => {
  console.error(`\nERROR: ${err.message}`);
  process.exit(1);
});
