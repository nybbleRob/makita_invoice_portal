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

// ---- NEW logic: earliest match wins, top of document first ----
// Keep in step with jobs/invoiceImport.js
const HEADER_WINDOW = 400;
const TYPE_PATTERNS = [
  { type: 'credit_note', re: /\bCREDIT\s*NOTE\b/ },
  { type: 'statement',   re: /\bSTATEMENT\b/ },
  { type: 'invoice',     re: /\bINVOICE\b/ },
];
function classify(text) {
  let best = null;
  for (const { type, re } of TYPE_PATTERNS) {
    const m = re.exec(text);
    if (m && (!best || m.index < best.at)) best = { type, at: m.index };
  }
  if (best) return best.type;
  if (/\bCREDIT\b/.test(text) && /\bCN\b/.test(text)) return 'credit_note';
  return null;
}
function classifyNew(textUpper) {
  return classify(textUpper.slice(0, HEADER_WINDOW)) || classify(textUpper) || 'invoice';
}

function collect(p) {
  const st = fs.statSync(p);
  if (st.isFile()) return [p];
  return fs.readdirSync(p).filter(f => f.toLowerCase().endsWith('.pdf')).map(f => path.join(p, f)).sort();
}

(async () => {
  const { extractTextFromPDF } = require('../utils/pdfExtractor');
  const files = collect(target);
  console.log(`Classifying ${files.length} PDF(s)...\n`);

  const counts = { same: 0, changed: 0, error: 0 };
  const byTransition = new Map();
  const changed = [];

  for (const file of files) {
    let textUpper;
    try {
      const r = await extractTextFromPDF(file);
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
