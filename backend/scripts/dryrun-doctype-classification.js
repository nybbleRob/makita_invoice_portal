/**
 * Dry-run the document type classifier over real PDFs and report where the new
 * logic disagrees with the old.
 *
 * Changes nothing - reads files, classifies, prints. Use it before trusting the
 * new classifier on a live import, and especially to confirm that genuine credit
 * notes and statements still classify correctly.
 *
 * Usage:
 *   node scripts/dryrun-doctype-classification.js /mnt/data/processed/invoices/2026/07/23
 *   node scripts/dryrun-doctype-classification.js /mnt/data/processed/creditnotes --all
 *
 *   --all   list every file, not just the ones where old and new disagree
 */

const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const showAll = argv.includes('--all');
const target = argv.filter(a => !a.startsWith('--'))[0];

if (!target) {
  console.error('Usage: node scripts/dryrun-doctype-classification.js <dir-or-file> [--all]');
  process.exit(1);
}

// ---- OLD logic: whole page, "specificity" precedence, credit note first ----
function classifyOld(textUpper) {
  if (textUpper.includes('CREDIT NOTE') || textUpper.includes('CREDITNOTE')) return 'credit_note';
  if (textUpper.includes('STATEMENT') || textUpper.includes('ACCOUNT STATEMENT') || textUpper.includes('STATEMENT OF ACCOUNT')) return 'statement';
  if (textUpper.includes('INVOICE') || textUpper.includes('TAX INVOICE') || textUpper.includes('INVOICE NUMBER')) return 'invoice';
  if (textUpper.includes('CREDIT') && !textUpper.includes('INVOICE')) {
    if (textUpper.includes(' CN ') || textUpper.match(/\bCN\b/) || textUpper.includes('CREDIT NOTE')) return 'credit_note';
    return 'invoice';
  }
  return 'invoice';
}

// ---- NEW logic: the document's own reference label, then headings ----
// Keep in step with jobs/invoiceImport.js
//   invoice     " INVOICE NO.80007908 PAGE NO.1 INVOICE TO:..."
//   credit note " CREDIT NO.90103648 PAGE NO.1 INVOICE TO:..."
// Both carry "INVOICE TO:", so the bare word INVOICE cannot discriminate.
const HEADER_WINDOW = 400;
const IDENTIFIER_PATTERNS = [
  { type: 'credit_note', re: /\bCREDIT\s*(?:NOTE\s*)?NO\b/ },
  { type: 'invoice',     re: /\bINVOICE\s*NO\b/ },
  { type: 'statement',   re: /\bSTATEMENT\b/ },
];
const HEADING_PATTERNS = [
  { type: 'credit_note', re: /\bCREDIT\s*NOTE\b/ },
  { type: 'statement',   re: /\bSTATEMENT\b/ },
  { type: 'invoice',     re: /\bINVOICE\b/ },
];
function earliest(text, patterns) {
  let best = null;
  for (const { type, re } of patterns) {
    const m = re.exec(text);
    if (m && (!best || m.index < best.at)) best = { type, at: m.index };
  }
  return best ? best.type : null;
}
function classify(text) {
  const byIdentifier = earliest(text, IDENTIFIER_PATTERNS);
  if (byIdentifier) return byIdentifier;
  const byHeading = earliest(text, HEADING_PATTERNS);
  if (byHeading) return byHeading;
  if (/\bCREDIT\b/.test(text) && /\bCN\b/.test(text)) return 'credit_note';
  return null;
}
function classifyNew(textUpper) {
  return classify(textUpper.slice(0, HEADER_WINDOW)) || classify(textUpper) || 'invoice';
}

// Recurse - documents are filed under <type>/<year>/<month>/<day>/, so a
// non-recursive read of the type folder finds nothing at all.
function collect(p) {
  const st = fs.statSync(p);
  if (st.isFile()) return [p];
  const out = [];
  for (const entry of fs.readdirSync(p, { withFileTypes: true })) {
    const full = path.join(p, entry.name);
    if (entry.isDirectory()) out.push(...collect(full));
    else if (entry.name.toLowerCase().endsWith('.pdf')) out.push(full);
  }
  return out.sort();
}

// pdf.js prints font warnings ("TT: undefined function: 32") per file, which
// buries the actual result. Silence them around extraction only.
async function quietly(fn) {
  const { log, warn, error } = console;
  console.log = console.warn = console.error = () => {};
  try {
    return await fn();
  } finally {
    console.log = log; console.warn = warn; console.error = error;
  }
}

(async () => {
  const { extractTextFromPDF } = require('../utils/pdfExtractor');
  const files = collect(target);
  console.log(`Classifying ${files.length} PDF(s)...\n`);

  const counts = { same: 0, changed: 0, error: 0 };
  const byTransition = new Map();
  const byNewType = new Map();
  const changed = [];

  for (const file of files) {
    let textUpper;
    try {
      const r = await quietly(() => extractTextFromPDF(file));
      textUpper = ((r && r.text) || r || '').toUpperCase();
    } catch (e) {
      counts.error++;
      console.log(`  ERROR ${path.basename(file)}: ${e.message}`);
      continue;
    }
    if (!textUpper.trim()) {
      counts.error++;
      console.log(`  NO TEXT ${path.basename(file)}`);
      continue;
    }

    const oldType = classifyOld(textUpper);
    const newType = classifyNew(textUpper);
    byNewType.set(newType, (byNewType.get(newType) || 0) + 1);

    if (oldType === newType) {
      counts.same++;
      if (showAll) console.log(`  same     ${oldType.padEnd(12)} ${path.basename(file)}`);
    } else {
      counts.changed++;
      const key = `${oldType} -> ${newType}`;
      byTransition.set(key, (byTransition.get(key) || 0) + 1);
      changed.push({ file, oldType, newType, head: textUpper.slice(0, 120).replace(/\s+/g, ' ') });
      console.log(`  CHANGED  ${key.padEnd(28)} ${path.basename(file)}`);
    }
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`  unchanged: ${counts.same}`);
  console.log(`  changed:   ${counts.changed}`);
  console.log(`  errors:    ${counts.error}`);

  console.log(`\n=== NEW CLASSIFIER SAYS ===`);
  for (const [t, n] of [...byNewType.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${t}`);
  }
  console.log(`  (run this against a folder of known documents - everything in`);
  console.log(`   creditnotes/ should say credit_note, and so on)`);

  if (byTransition.size) {
    console.log(`\n=== TRANSITIONS ===`);
    for (const [k, v] of [...byTransition.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(v).padStart(4)}  ${k}`);
    }
    console.log(`\n=== WHAT CHANGED (first 20) ===`);
    for (const c of changed.slice(0, 20)) {
      console.log(`\n  ${path.basename(c.file)}`);
      console.log(`    ${c.oldType} -> ${c.newType}`);
      console.log(`    starts: "${c.head}..."`);
    }
    console.log(`\n  Check these are RIGHT. "credit_note -> invoice" on a real invoice is the`);
    console.log(`  bug being fixed. "credit_note -> invoice" on a real CREDIT NOTE is a`);
    console.log(`  regression and needs reporting before this goes live.`);
  } else {
    console.log(`\nNo classification changes on this set.`);
  }

  process.exit(0);
})().catch(e => {
  console.error(`ERROR: ${e.message}`);
  process.exit(1);
});
