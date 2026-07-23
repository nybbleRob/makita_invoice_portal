/**
 * Check whether PDFs share a pdf.js fingerprint.
 *
 * getCachedPageData() in utils/pdfCoordinates.js caches parsed page data in a
 * module-level Map keyed by `${pdf.fingerprints[0]}-${pageNum}`. That Map is
 * never cleared or bounded, and the queue worker is long-lived. So if two PDFs
 * report the same fingerprint, the second one to be parsed receives the FIRST
 * one's viewport and textContent - every zone is then read off the wrong
 * document, which produces either wrong values or empty ones.
 *
 * pdf.js derives the fingerprint from the /ID entry in the PDF trailer, falling
 * back to a hash of the document's first bytes. Documents produced in one run by
 * the same generator frequently carry an identical /ID.
 *
 * Usage:
 *   node scripts/check-pdf-fingerprints.js /mnt/data/processed/invoices/2026/07/23
 *   node scripts/check-pdf-fingerprints.js /mnt/data/processed/invoices/2026/07/23 --deep
 *
 * --deep also reports, per collision group, whether the cached page would
 * actually have differed (i.e. whether real data corruption was possible).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const args = process.argv.slice(2).filter(a => a !== '--deep');
const deep = process.argv.includes('--deep');
const target = args[0];

if (!target) {
  console.error('Usage: node scripts/check-pdf-fingerprints.js <dir-or-file> [--deep]');
  process.exit(1);
}

async function loadPdfjs() {
  try {
    const m = await import('pdfjs-dist/legacy/build/pdf.mjs');
    return m.default || m;
  } catch (e) {
    const m = await import('pdfjs-dist');
    return m.default || m;
  }
}

function collectPdfs(p) {
  const st = fs.statSync(p);
  if (st.isFile()) return [p];
  return fs.readdirSync(p)
    .filter(f => f.toLowerCase().endsWith('.pdf'))
    .map(f => path.join(p, f))
    .sort();
}

(async () => {
  const pdfjsLib = await loadPdfjs();
  const files = collectPdfs(target);
  if (!files.length) {
    console.log('No PDFs found.');
    process.exit(0);
  }
  console.log(`Checking ${files.length} PDF(s)...\n`);

  const byFingerprint = new Map();

  for (const file of files) {
    const buf = fs.readFileSync(file);
    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    let fp, pages;
    try {
      const pdf = await pdfjsLib.getDocument({
        data: new Uint8Array(buf),
        verbosity: 0,
      }).promise;
      fp = (pdf.fingerprints && pdf.fingerprints[0]) || '(none)';
      pages = pdf.numPages;

      if (deep) {
        const page = await pdf.getPage(1);
        const tc = await page.getTextContent();
        const firstStrings = tc.items
          .filter(i => i.str && i.str.trim())
          .slice(0, 6)
          .map(i => i.str.trim())
          .join(' | ');
        if (!byFingerprint.has(fp)) byFingerprint.set(fp, []);
        byFingerprint.get(fp).push({ file, sha, pages, firstStrings });
        continue;
      }
    } catch (e) {
      console.log(`  ERROR reading ${path.basename(file)}: ${e.message}`);
      continue;
    }
    if (!byFingerprint.has(fp)) byFingerprint.set(fp, []);
    byFingerprint.get(fp).push({ file, sha, pages });
  }

  const collisions = [...byFingerprint.entries()].filter(([, v]) => v.length > 1);

  console.log(`Distinct fingerprints: ${byFingerprint.size} across ${files.length} file(s)`);

  if (!collisions.length) {
    console.log('\nNo fingerprint collisions. The shared page cache is safe for this set.');
    process.exit(0);
  }

  console.log(`\n*** ${collisions.length} FINGERPRINT COLLISION GROUP(S) ***`);
  console.log('Files sharing a fingerprint contaminate each other via the page cache.\n');

  for (const [fp, entries] of collisions) {
    console.log(`fingerprint ${fp}  (${entries.length} files)`);
    for (const e of entries) {
      console.log(`   ${path.basename(e.file)}`);
      console.log(`      sha256 ${e.sha.substring(0, 16)}...  pages=${e.pages}`);
      if (deep && e.firstStrings) console.log(`      page1: ${e.firstStrings}`);
    }
    if (deep) {
      const distinctContent = new Set(entries.map(e => e.firstStrings)).size;
      const distinctBytes = new Set(entries.map(e => e.sha)).size;
      if (distinctBytes > 1 && distinctContent > 1) {
        console.log(`   >>> ${distinctBytes} distinct documents share this fingerprint`);
        console.log(`   >>> whichever parses SECOND is read off the FIRST one's page`);
      } else if (distinctBytes === 1) {
        console.log(`   (identical bytes - duplicate file, harmless for the cache)`);
      }
    }
    console.log('');
  }

  process.exit(2);
})().catch(err => {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
});
