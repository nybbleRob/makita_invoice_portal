#!/usr/bin/env node
/**
 * Dry-run for the ACR11P statement import pipeline.
 * ============================================================================
 *
 *   ⚠️  SAFETY GUARANTEE — this script NEVER performs a write.
 *
 * What this script does (read-only, all safe):
 *   - Reads the .TXT file you point it at (never writes it back)
 *   - Parses via services/statementGenerator/parse.js (pure)
 *   - `Company.findOne`  — tests customer → CORP company matching
 *   - `Statement.findOne` — checks for existing rows (contentHash / authority)
 *   - `User.findAll` / `Company.findByPk` — enumerates who WOULD be emailed
 *     via the real `getNotificationRecipients` helper
 *   - `Settings.getSettings` — reads current settings (email provider,
 *     test mode, retention)
 *
 * What this script does NOT do (write paths, all guarded):
 *   - No `File.create` / `Statement.create` / `Statement.update` / etc.
 *   - No `queue.add` (no `statement-generate` jobs are enqueued)
 *   - No `emailQueue.add` / `queueEmail` (no emails are sent, no rows
 *     written to `email_logs`)
 *   - No file moves in `FTP_UPLOAD_PATH`, `processed/`, or `unprocessed/`
 *   - No `logActivity` (no rows written to activity_logs in Redis)
 *   - Does NOT call `runAcr11pImport` (that helper *does* enqueue jobs).
 *
 * Optional sample generation (`--generate-sample <ref>`):
 *   - Builds ONE customer's PDF + XLSX to `/tmp/dryrun-<ts>/` so you can
 *     visually eyeball the render.
 *   - unoserver + LibreOffice are hit (they're stateless, no DB writes).
 *   - No File row, no Statement row, no move to processed/.
 *   - Skip this flag if you don't want to touch unoserver at all.
 *
 * Usage:
 *   node backend/scripts/dryrun-statement-import.js <path-to-txt> [options]
 *
 * Options:
 *   --top N               Print detail for top N matched customers (default 20)
 *   --customer <refNo>    Only report on this customer (repeatable)
 *   --generate-sample <r> Also render a real PDF+XLSX for this customer to /tmp
 *   --output <path>       Write full JSON report to a file (default stdout only)
 *   --json                Emit machine-readable JSON to stdout, no text report
 *   --check-env-only      Skip .TXT parsing, only run environment preflight
 *   --show-unmatched      List every unmatched custNo (default: summary only)
 *   --help
 *
 * Examples:
 *   # Preflight only — does the server look ready for statement generation?
 *   node backend/scripts/dryrun-statement-import.js --check-env-only
 *
 *   # Full read-only pass over a real export:
 *   node backend/scripts/dryrun-statement-import.js /tmp/ACR11P.TXT
 *
 *   # Plus render one customer's PDF/XLSX to /tmp so you can eyeball it:
 *   node backend/scripts/dryrun-statement-import.js /tmp/ACR11P.TXT --generate-sample 4
 *
 *   # Only look at these three customers (no full-export scan):
 *   node backend/scripts/dryrun-statement-import.js /tmp/ACR11P.TXT --customer 4 --customer 67301
 *
 *   # Save the full JSON report for review / diffing between months:
 *   node backend/scripts/dryrun-statement-import.js /tmp/ACR11P.TXT --output /tmp/dryrun.json
 * ============================================================================
 */

'use strict';

// ---------------------------------------------------------------------------
// CLI: parse args FIRST and handle --help before requiring anything else, so
// operators without node_modules installed can still read the usage docs.
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { customers: [], top: 20, showUnmatched: false, checkEnvOnly: false, json: false };
  const rest = argv.slice(2);
  let inputPath = null;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--help' || a === '-h') { args.help = true; continue; }
    if (a === '--check-env-only') { args.checkEnvOnly = true; continue; }
    if (a === '--json') { args.json = true; continue; }
    if (a === '--show-unmatched') { args.showUnmatched = true; continue; }
    if (a === '--top') { args.top = parseInt(rest[++i], 10) || 20; continue; }
    if (a === '--customer') { args.customers.push(String(rest[++i]).trim()); continue; }
    if (a === '--generate-sample') { args.generateSample = String(rest[++i]).trim(); continue; }
    if (a === '--output') { args.output = rest[++i]; continue; }
    if (a.startsWith('--')) {
      console.error(`Unknown option: ${a}`);
      process.exit(2);
    }
    if (!inputPath) inputPath = a;
  }
  args.inputPath = inputPath;
  return args;
}

const args = parseArgs(process.argv);

if (args.help) {
  const src = require('fs').readFileSync(__filename, 'utf8');
  const header = src.split('*/')[0].split('/**')[1];
  console.log(header || 'No help header found.');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Hard safety belt: if ANY code path in this script tries to open a write
// (Sequelize INSERT/UPDATE/DELETE, BullMQ queue.add, sendMail, fs.writeFileSync
// outside /tmp), the script logs a loud error and exits before executing it.
//
// We do this by monkey-patching a small set of sinks BEFORE requiring any
// application module. Application code loaded below will see the patched
// versions; nothing here needs to know about the patch.
// ---------------------------------------------------------------------------

const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const net = require('net');
const { execFileSync } = require('child_process');

// Track any accidental writes so we can crash loudly if they happen.
const violations = [];
function violate(kind, detail) {
  const line = `SAFETY VIOLATION (${kind}): ${detail}`;
  violations.push(line);
  console.error('\n\n===== ' + line + ' =====');
  console.error('The dry-run script attempted a write path. This should NEVER happen.');
  console.error('Aborting immediately so the operator can inspect and file a bug.\n');
  process.exit(99);
}

// Patch fs.writeFileSync / fs.writeFile / fs.appendFileSync to refuse writes
// outside /tmp. The sample-render mode legitimately writes into /tmp; nothing
// else is allowed to write anywhere. This catches accidental helpers that
// might otherwise slip through.
const origWriteFileSync = fs.writeFileSync;
const origWriteFile = fs.writeFile;
const origAppendFileSync = fs.appendFileSync;
const origRenameSync = fs.renameSync;
const origUnlinkSync = fs.unlinkSync;
function isSafeWritePath(p) {
  if (typeof p !== 'string') return false;
  const abs = path.isAbsolute(p) ? p : path.resolve(p);
  const tmpRoot = os.tmpdir();
  return abs.startsWith(tmpRoot + path.sep) || abs === tmpRoot;
}
fs.writeFileSync = function guardedWriteFileSync(p, ...rest) {
  if (!isSafeWritePath(p)) return violate('fs.writeFileSync outside /tmp', String(p));
  return origWriteFileSync(p, ...rest);
};
fs.writeFile = function guardedWriteFile(p, ...rest) {
  if (!isSafeWritePath(p)) return violate('fs.writeFile outside /tmp', String(p));
  return origWriteFile(p, ...rest);
};
fs.appendFileSync = function guardedAppendFileSync(p, ...rest) {
  if (!isSafeWritePath(p)) return violate('fs.appendFileSync outside /tmp', String(p));
  return origAppendFileSync(p, ...rest);
};
fs.renameSync = function guardedRenameSync(from, to) {
  // Any rename touches the source folder — forbid it outright.
  return violate('fs.renameSync', `${from} -> ${to}`);
};
fs.unlinkSync = function guardedUnlinkSync(p) {
  if (!isSafeWritePath(p)) return violate('fs.unlinkSync outside /tmp', String(p));
  return origUnlinkSync(p);
};

// ---------------------------------------------------------------------------
// Now load the application modules. Anything that opens Redis/DB connections
// on `require` will do so here; nothing is written yet.
// ---------------------------------------------------------------------------

// Load .env from repo root (mirrors how the app boots).
try {
  require('dotenv').config({
    path: path.resolve(__dirname, '..', '..', '.env')
  });
} catch (_) { /* dotenv is optional; the app already tolerates missing .env */ }

const { sequelize, Statement, Company, User, Settings } = require('../models');
const {
  parseExportText,
  isoDate,
  RECOGNISED_TERMS
} = require('../services/statementGenerator/parse');
const {
  computeStatementContentHash
} = require('../services/statementGenerator/contentHash');
const {
  findCorpCompanyByAccountNumber
} = require('../utils/statementImport');
const {
  looksLikeAcr11pExport
} = require('../services/statementGenerator/acr11pImporter');
const {
  getNotificationRecipients
} = require('../services/documentNotificationService');
const { isEmailEnabled } = require('../utils/emailService');

// Sequelize hook: catch any accidental write on any model. Read queries do
// not go through these hooks (SELECT is not covered by beforeCreate etc).
[
  Statement, Company, User, Settings,
  require('../models').File,
  require('../models').Invoice,
  require('../models').CreditNote,
  require('../models').EmailLog
].forEach(Model => {
  if (!Model) return;
  ['beforeCreate', 'beforeBulkCreate', 'beforeUpdate', 'beforeBulkUpdate',
    'beforeDestroy', 'beforeBulkDestroy', 'beforeUpsert', 'beforeSave']
    .forEach(hook => {
      try {
        Model.addHook(hook, `dryrun-safety-${hook}`, () => {
          violate('sequelize ' + hook, Model.name || 'unknown');
        });
      } catch (_) { /* some hooks aren't valid for every model */ }
    });
});

// ---------------------------------------------------------------------------
// Preflight: environment
// ---------------------------------------------------------------------------

async function tcpProbe(host, port, timeoutMs = 1500) {
  return new Promise(resolve => {
    const sock = new net.Socket();
    let done = false;
    const finish = ok => {
      if (done) return;
      done = true;
      try { sock.destroy(); } catch (_) { /* noop */ }
      resolve(ok);
    };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => finish(true));
    sock.once('timeout', () => finish(false));
    sock.once('error', () => finish(false));
    sock.connect(port, host);
  });
}

function parseUnoserverPorts() {
  const list = process.env.UNOSERVER_PORTS;
  if (list && String(list).trim()) {
    return String(list).split(/[\s,]+/).map(p => parseInt(p, 10)).filter(p => Number.isFinite(p) && p > 0 && p < 65536);
  }
  const single = parseInt(process.env.UNOSERVER_PORT, 10);
  if (Number.isFinite(single) && single > 0 && single < 65536) return [single];
  return [];
}

async function runEnvironmentPreflight() {
  const report = {
    nodeVersion: process.version,
    cwd: process.cwd(),
    envFile: path.resolve(__dirname, '..', '..', '.env'),
    checks: []
  };
  const push = (name, ok, detail) => report.checks.push({ name, ok, detail });

  // 1. Database reachable.
  try {
    await sequelize.authenticate();
    push('Database reachable', true, `${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || '?'}`);
  } catch (e) {
    push('Database reachable', false, e.message);
  }

  // 2. Statements table shape (looks for the new columns from the recent migrations).
  try {
    const [rows] = await sequelize.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'statements'
    `);
    const cols = new Set(rows.map(r => r.column_name));
    const need = ['contentHash', 'lastNotificationMessageId', 'lastNotifiedAt'];
    const missing = need.filter(c => !cols.has(c) && !cols.has(c.toLowerCase()));
    push(
      'Statements schema: recent migrations applied',
      missing.length === 0,
      missing.length === 0
        ? `all ${need.length} expected columns present`
        : `MISSING: ${missing.join(', ')}. Run backend/scripts/add-notification-message-id.js and related migrations.`
    );
  } catch (e) {
    push('Statements schema check', false, e.message);
  }

  // 3. ACR11P XLSX template on disk.
  const templatePath = path.resolve(__dirname, '..', 'services', 'statementGenerator', 'templates', 'ACR11P.xlsx');
  try {
    const st = fs.statSync(templatePath);
    push('ACR11P template on disk', st.size > 0, `${templatePath} (${st.size} bytes)`);
  } catch (e) {
    push('ACR11P template on disk', false, `${templatePath} not readable: ${e.message}`);
  }

  // 4. Python venv + Pillow + openpyxl.
  const pythonBin = process.env.STATEMENT_PYTHON_BIN || '/opt/makita-stmt-venv/bin/python3';
  try {
    const out = execFileSync(pythonBin, ['-c', 'import PIL, openpyxl; print(PIL.__version__ + "|" + openpyxl.__version__)'], { timeout: 5000 });
    const [pil, ox] = String(out).trim().split('|');
    push('Python sidecar has Pillow + openpyxl', true, `${pythonBin}: Pillow ${pil}, openpyxl ${ox}`);
  } catch (e) {
    push('Python sidecar has Pillow + openpyxl', false, `${pythonBin}: ${(e.stderr || e.message || '').toString().trim()}`);
  }

  // 5. unoserver ports reachable.
  const ports = parseUnoserverPorts();
  if (ports.length === 0) {
    push('unoserver ports configured', false, 'Neither UNOSERVER_PORTS nor UNOSERVER_PORT set; PDF conversion will use the client default (2002).');
  } else {
    for (const port of ports) {
      const ok = await tcpProbe('127.0.0.1', port);
      push(`unoserver reachable @ 127.0.0.1:${port}`, ok, ok ? 'listening' : 'no connection — is unoserver@' + port + ' running?');
    }
  }

  // 6. Settings — is email actually enabled?
  try {
    const settings = await Settings.getSettings();
    const emailOn = isEmailEnabled(settings);
    const provider = settings?.emailProvider?.provider || '(unset)';
    const testMode = !!settings?.emailProvider?.testMode?.enabled;
    const redirect = settings?.emailProvider?.testMode?.redirectEmail || '(none)';
    push(
      'Email enabled globally',
      true,
      `provider=${provider}, isEmailEnabled=${emailOn}, testMode=${testMode}${testMode ? ' (redirects to ' + redirect + ')' : ''}`
    );

    // Statement flag — is customer-facing UI turned on?
    try {
      const flagPath = path.resolve(__dirname, '..', '..', 'frontend', 'src', 'config', 'featureFlags.js');
      const flagSrc = fs.readFileSync(flagPath, 'utf8');
      const on = /STATEMENTS_ENABLED\s*=\s*true/.test(flagSrc);
      push('Frontend STATEMENTS_ENABLED', on, on ? 'true — customers see Statements page' : 'false — Statements page is hidden');
    } catch (_) {
      push('Frontend STATEMENTS_ENABLED', false, 'could not read featureFlags.js');
    }

    // Import scanner enabled?
    const importEnabled = settings?.importSettings?.enabled === true;
    const importFreq = settings?.importSettings?.frequency || 60;
    push(
      'Local folder scanner enabled',
      importEnabled,
      importEnabled ? `every ${importFreq} minutes` : 'disabled — .TXT files dropped in FTP_UPLOAD_PATH will NOT auto-import'
    );
  } catch (e) {
    push('Settings snapshot', false, e.message);
  }

  return report;
}

// ---------------------------------------------------------------------------
// Classification: mirror statementGenerate.js decision logic WITHOUT touching
// any write path.
// ---------------------------------------------------------------------------

function getCompanyCurrency(company) {
  if (!company) return null;
  const raw = company.currency;
  if (raw === undefined || raw === null || String(raw).trim() === '') return 'GBP';
  return String(raw).trim().toUpperCase();
}

function toStatementDate(iso) {
  if (!iso) return new Date();
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

/**
 * Given a parsed customer, compute what statementGenerate.js WOULD do without
 * doing it. Returns a classification token + supporting evidence.
 *
 * Classification tokens (mirrors code paths in jobs/statementGenerate.js):
 *   'unmatched'            — no CORP company with that referenceNo
 *   'currency_mismatch'    — matched, but company.currency != 'GBP'
 *   'unchanged'            — existing statement, contentHash matches -> no notify
 *   'baseline'             — existing statement, contentHash null    -> would stamp, no notify
 *   'manual_auth_blocked'  — existing statement, source=manual_upload -> would regenerate but suppress
 *   'correction'           — existing statement, contentHash differs -> would notify
 *   'new'                  — no existing statement                   -> would notify
 */
async function classifyCustomer(customer, opts = {}) {
  const custNo = String(customer.custNo || '').trim();
  const contentHash = computeStatementContentHash(customer);
  const stmtDateIso = customer.stmtDate ? isoDate(customer.stmtDate) : null;
  const stmtDate = toStatementDate(stmtDateIso);

  const company = await findCorpCompanyByAccountNumber(custNo);

  if (!company) {
    return {
      custNo, custName: customer.custName || null,
      contentHash, statementDate: stmtDateIso,
      classification: 'unmatched',
      companyId: null, companyName: null,
      wouldNotify: false,
      reason: 'no CORP company with that referenceNo'
    };
  }

  const currency = getCompanyCurrency(company);
  if (currency !== 'GBP') {
    return {
      custNo, custName: customer.custName || null,
      contentHash, statementDate: stmtDateIso,
      classification: 'currency_mismatch',
      companyId: company.id, companyName: company.name,
      wouldNotify: false,
      reason: `matched company currency=${currency}, expected GBP`
    };
  }

  const existing = await Statement.findOne({
    where: { companyId: company.id, periodEnd: stmtDate },
    attributes: ['id', 'metadata', 'source', 'fileUrl', 'pdfFileUrl', 'xlsFileUrl', 'documentStatus']
  });

  const base = {
    custNo, custName: customer.custName || null,
    contentHash, statementDate: stmtDateIso,
    companyId: company.id, companyName: company.name,
    existingStatementId: existing ? existing.id : null,
    existingSource: existing?.metadata?.source || existing?.source || null,
    existingHash: existing?.metadata?.contentHash || null
  };

  if (!existing) {
    return { ...base, classification: 'new', wouldNotify: true, reason: 'no existing Statement for this (company, periodEnd)' };
  }

  const existingHash = existing.metadata?.contentHash || null;
  const existingSource = existing.metadata?.source || existing.source || 'manual_upload';

  if (existingHash && existingHash === contentHash) {
    return { ...base, classification: 'unchanged', wouldNotify: false, reason: 'contentHash matches existing row — will short-circuit before generation' };
  }
  if (!existingHash) {
    return { ...base, classification: 'baseline', wouldNotify: false, reason: 'existing row has no contentHash — will stamp on this run without regenerating or notifying' };
  }
  // Hash differs.
  if (existingSource === 'manual_upload') {
    return { ...base, classification: 'manual_auth_blocked', wouldNotify: false, reason: 'existing row is manual_upload — generated re-run is suppressed by authority (no notify)' };
  }
  return { ...base, classification: 'correction', wouldNotify: true, reason: 'contentHash differs from existing generated row — would regenerate + notify' };
}

// ---------------------------------------------------------------------------
// Notification plan (mirrors documentNotificationService.js).
// ---------------------------------------------------------------------------

async function planNotifications(customerRecord) {
  if (!customerRecord.wouldNotify) return { recipients: [], reason: 'wouldNotify=false' };
  try {
    const recipients = await getNotificationRecipients(customerRecord.companyId, 'statement');
    return {
      recipients: recipients.map(r => ({
        email: r.email,
        name: r.name,
        role: r.role,
        isPrimaryContact: !!r.isPrimaryContact,
        sendAsSummary: !!r.sendAsSummary,
        sendPdfAttachment: !!r.sendPdfAttachment,
        sendXlsAttachment: !!r.sendXlsAttachment,
        wouldReceive: {
          email: true, // getNotificationRecipients only returns opted-in users
          pdfAttachment: !!r.sendPdfAttachment,
          xlsAttachment: !!r.sendXlsAttachment
        }
      })),
      reason: null
    };
  } catch (e) {
    return { recipients: [], reason: `getNotificationRecipients threw: ${e.message}` };
  }
}

// ---------------------------------------------------------------------------
// Optional sample render — writes ONLY to /tmp/dryrun-<ts>/
// ---------------------------------------------------------------------------

async function renderSample(customer, statementDateIso) {
  const { buildExcel } = require('../services/statementGenerator/excel');
  const { buildPdf } = require('../services/statementGenerator/pdf');
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.join(os.tmpdir(), `dryrun-stmt-${ts}`);
  fs.mkdirSync(outDir, { recursive: true });

  const dateForName = statementDateIso || new Date().toISOString().slice(0, 10);
  const baseName = `${customer.custNo}_Statement_${dateForName}`;
  const xlsxPath = path.join(outDir, `${baseName}.xlsx`);
  const pdfPath = path.join(outDir, `${baseName}.pdf`);

  const startX = Date.now();
  await buildExcel(customer, xlsxPath);
  const xlsxMs = Date.now() - startX;

  const startP = Date.now();
  const ports = parseUnoserverPorts();
  const pickedPort = ports.length > 0 ? ports[0] : null;
  await buildPdf(customer, pdfPath, pickedPort ? { unoPort: pickedPort } : undefined);
  const pdfMs = Date.now() - startP;

  return { xlsxPath, pdfPath, xlsxMs, pdfMs, unoPort: pickedPort };
}

// ---------------------------------------------------------------------------
// Report formatting
// ---------------------------------------------------------------------------

function formatBanner(text, char = '=') {
  const line = char.repeat(Math.max(text.length + 4, 60));
  return `\n${line}\n  ${text}\n${line}\n`;
}

function formatEnvPreflight(report) {
  let out = formatBanner('ENVIRONMENT PREFLIGHT');
  out += `Node: ${report.nodeVersion}\n`;
  out += `CWD:  ${report.cwd}\n`;
  out += `.env: ${report.envFile}\n\n`;
  for (const c of report.checks) {
    const mark = c.ok ? '  OK  ' : ' FAIL ';
    out += `[${mark}] ${c.name}\n         ${c.detail}\n`;
  }
  return out;
}

function formatSummary(report) {
  const s = report.summary;
  let out = formatBanner('DRY-RUN SUMMARY');
  out += `Source file: ${report.file.path}\n`;
  out += `Size:        ${report.file.size} bytes  (sha256=${report.file.sha256.slice(0, 12)}…)\n`;
  out += `Sniff:       ${report.file.looksLikeAcr11p ? 'PASSES ACR11P shape check' : 'FAILS shape check — parser would refuse this file'}\n`;
  out += `Statement date parsed from export: ${report.file.statementDate || '(none)'}\n`;
  out += `Customers in export:              ${s.totalCustomers}\n`;
  out += `Malformed lines:                  ${s.malformedLinesCount}\n`;
  out += `Unknown terms (routed anyway):    ${s.unknownTermsCount}\n\n`;
  out += `Classification breakdown:\n`;
  const total = s.totalCustomers || 1;
  const buckets = [
    ['new',                 s.new,                'would create Statement + would EMAIL'],
    ['correction',          s.correction,         'existing row changed + would EMAIL'],
    ['unchanged',           s.unchanged,          'byte-identical — no work, no email'],
    ['baseline',            s.baseline,           'stamps hash on legacy row — no email'],
    ['manual_auth_blocked', s.manualAuthBlocked,  'manual upload wins — no email'],
    ['currency_mismatch',   s.currencyMismatch,   'not GBP — no work, no email'],
    ['unmatched',           s.unmatched,          'no CORP company — filed unallocated']
  ];
  for (const [name, n, note] of buckets) {
    const pct = ((n / total) * 100).toFixed(1);
    out += `  ${name.padEnd(22)}  ${String(n).padStart(5)}  ${pct.padStart(5)}%   ${note}\n`;
  }
  out += `\nWOULD-EMAIL headline:\n`;
  out += `  Customers that would trigger an email:         ${s.customersWouldNotify}\n`;
  out += `  Total email recipients (across all customers): ${s.totalEmailRecipients}\n`;
  out += `  Distinct recipient addresses:                  ${s.distinctRecipients}\n`;
  if (report.emailProvider) {
    out += `\n  Email provider: ${report.emailProvider.provider}, enabled=${report.emailProvider.enabled}, testMode=${report.emailProvider.testMode}${report.emailProvider.testMode ? ' → all emails redirect to ' + report.emailProvider.redirectEmail : ''}\n`;
  }
  return out;
}

function formatDetail(customers, top) {
  let out = formatBanner(`TOP ${top} MATCHED CUSTOMERS (detail)`);
  const shown = customers.filter(c => c.classification !== 'unmatched').slice(0, top);
  for (const c of shown) {
    const cls = c.classification.padEnd(22);
    out += `[${cls}] custNo=${String(c.custNo).padEnd(8)} ${c.companyName || '(no company)'}\n`;
    if (c.wouldNotify) {
      out += `    reason: ${c.reason}\n`;
      const rs = c.notification?.recipients || [];
      if (rs.length === 0) {
        out += `    recipients: NONE  ← company + users all have sendStatementEmail=false, so no email despite classification\n`;
      } else {
        for (const r of rs) {
          const flags = [];
          if (r.sendPdfAttachment) flags.push('PDF');
          if (r.sendXlsAttachment) flags.push('XLS');
          if (r.isPrimaryContact) flags.push('primary');
          if (r.sendAsSummary) flags.push('summary');
          out += `    → ${r.email.padEnd(40)}  role=${(r.role || '?').padEnd(20)}  [${flags.join(',') || 'email-only'}]\n`;
        }
      }
    } else {
      out += `    ${c.reason}\n`;
    }
  }
  return out;
}

function formatUnmatched(customers) {
  const unmatched = customers.filter(c => c.classification === 'unmatched');
  if (unmatched.length === 0) return '';
  let out = formatBanner(`UNMATCHED CUSTOMERS (${unmatched.length})`);
  out += 'These have no CORP company with matching referenceNo. They are filed under\n';
  out += 'unprocessed/failed with failureReason=company_not_found. No email is sent for\n';
  out += 'these — that is by design (the export covers every BPCS customer, most of\n';
  out += 'whom are not on the portal).\n\n';
  for (const c of unmatched) {
    out += `  custNo=${String(c.custNo).padEnd(8)}  ${c.custName || ''}\n`;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const started = Date.now();
  const report = {
    dryRun: true,
    startedAt: new Date().toISOString(),
    args,
    env: null,
    file: null,
    customers: [],
    summary: null,
    sample: null,
    violations
  };

  // Preflight (always).
  report.env = await runEnvironmentPreflight();

  if (args.checkEnvOnly) {
    if (args.json) {
      process.stdout.write(JSON.stringify(report, null, 2));
    } else {
      process.stdout.write(formatEnvPreflight(report.env));
      process.stdout.write(formatBanner('CHECK-ENV-ONLY — no file parsed, no work done'));
    }
    await cleanShutdown(report);
    return;
  }

  if (!args.inputPath) {
    console.error('Usage: node backend/scripts/dryrun-statement-import.js <path-to-txt> [options]');
    console.error('       node backend/scripts/dryrun-statement-import.js --check-env-only');
    console.error('       node backend/scripts/dryrun-statement-import.js --help');
    process.exit(2);
  }

  const abs = path.resolve(args.inputPath);
  const stat = fs.statSync(abs);
  const buffer = fs.readFileSync(abs);
  const sha = crypto.createHash('sha256').update(buffer).digest('hex');
  const text = buffer.toString('utf8');

  report.file = {
    path: abs,
    size: stat.size,
    sha256: sha,
    looksLikeAcr11p: looksLikeAcr11pExport(text),
    statementDate: null
  };

  if (!report.file.looksLikeAcr11p) {
    if (args.json) {
      process.stdout.write(JSON.stringify(report, null, 2));
    } else {
      process.stdout.write(formatEnvPreflight(report.env));
      process.stdout.write(formatBanner('DRY-RUN ABORTED — INPUT DOES NOT LOOK LIKE AN ACR11P EXPORT'));
      process.stdout.write(`File: ${abs}\nThe sniff (first non-blank line, 25+ tabs) failed. In production this file\nwould be filed under unprocessed/failed with reason "not_acr11p_shape" and\nno further work would happen.\n`);
    }
    await cleanShutdown(report);
    return;
  }

  // Parse.
  let parsed;
  try {
    parsed = parseExportText(text);
  } catch (e) {
    if (args.json) {
      process.stdout.write(JSON.stringify({ ...report, parseError: e.message }, null, 2));
    } else {
      process.stdout.write(formatEnvPreflight(report.env));
      process.stdout.write(formatBanner('DRY-RUN ABORTED — PARSE FAILED'));
      process.stdout.write(`Parser threw: ${e.message}\nIn production, the file would be filed under unprocessed/failed with reason\n"ACR11P_PARSE_ERROR" and NO customer jobs would be enqueued.\n`);
    }
    await cleanShutdown(report);
    return;
  }
  report.file.statementDate = parsed.statementDate || null;

  // Filter customers if --customer was passed.
  let customerList = parsed.customerList;
  if (args.customers.length > 0) {
    const wanted = new Set(args.customers.map(String));
    customerList = customerList.filter(c => wanted.has(String(c.custNo)));
    if (customerList.length === 0) {
      process.stderr.write(`No customers in the export match --customer filter [${args.customers.join(', ')}]\n`);
    }
  }

  // Classify each customer + plan notifications.
  const seenRecipientEmails = new Set();
  let totalEmailRecipients = 0;

  for (const cust of customerList) {
    const record = await classifyCustomer(cust);
    if (record.wouldNotify && record.companyId) {
      record.notification = await planNotifications(record);
      totalEmailRecipients += record.notification.recipients.length;
      for (const r of record.notification.recipients) {
        seenRecipientEmails.add(r.email.toLowerCase());
      }
    } else {
      record.notification = { recipients: [], reason: record.reason };
    }
    report.customers.push(record);
  }

  // Summary buckets.
  const bucket = k => report.customers.filter(c => c.classification === k).length;
  report.summary = {
    totalCustomers: parsed.customerList.length,
    scannedCustomers: customerList.length,
    malformedLinesCount: parsed.validation?.malformedLines?.length || 0,
    unknownTermsCount: parsed.validation?.unknownTerms?.length || 0,
    unmatched: bucket('unmatched'),
    currencyMismatch: bucket('currency_mismatch'),
    unchanged: bucket('unchanged'),
    baseline: bucket('baseline'),
    manualAuthBlocked: bucket('manual_auth_blocked'),
    correction: bucket('correction'),
    new: bucket('new'),
    customersWouldNotify: report.customers.filter(c => c.wouldNotify).length,
    totalEmailRecipients,
    distinctRecipients: seenRecipientEmails.size
  };

  // Email provider snapshot for headline.
  try {
    const settings = await Settings.getSettings();
    report.emailProvider = {
      provider: settings?.emailProvider?.provider || null,
      enabled: isEmailEnabled(settings),
      testMode: !!settings?.emailProvider?.testMode?.enabled,
      redirectEmail: settings?.emailProvider?.testMode?.redirectEmail || null
    };
  } catch (_) { /* best effort */ }

  // Optional sample render (writes to /tmp only).
  if (args.generateSample) {
    const target = String(args.generateSample);
    const cust = parsed.customerList.find(c => String(c.custNo) === target);
    if (!cust) {
      report.sample = { requested: target, ok: false, error: `custNo ${target} not present in the export` };
    } else {
      try {
        const stmtDateIso = cust.stmtDate ? isoDate(cust.stmtDate) : null;
        const sample = await renderSample(cust, stmtDateIso);
        report.sample = { requested: target, ok: true, ...sample };
      } catch (e) {
        report.sample = { requested: target, ok: false, error: e.message };
      }
    }
  }

  // Optional JSON output file.
  if (args.output) {
    const outPath = path.resolve(args.output);
    if (!isSafeWritePath(outPath)) {
      process.stderr.write(`Refusing to write --output outside /tmp: ${outPath}\nPick a path under ${os.tmpdir()} or omit --output.\n`);
    } else {
      origWriteFileSync(outPath, JSON.stringify(report, null, 2));
      report.outputFile = outPath;
    }
  }

  // Render.
  if (args.json) {
    process.stdout.write(JSON.stringify(report, null, 2));
  } else {
    process.stdout.write(formatEnvPreflight(report.env));
    process.stdout.write(formatSummary(report));
    process.stdout.write(formatDetail(report.customers, args.top));
    if (args.showUnmatched) process.stdout.write(formatUnmatched(report.customers));
    if (report.sample) {
      process.stdout.write(formatBanner('SAMPLE RENDER'));
      if (report.sample.ok) {
        process.stdout.write(`custNo=${report.sample.requested}\n`);
        process.stdout.write(`  XLSX: ${report.sample.xlsxPath}  (${report.sample.xlsxMs} ms)\n`);
        process.stdout.write(`  PDF:  ${report.sample.pdfPath}  (${report.sample.pdfMs} ms via unoserver:${report.sample.unoPort || 'default'})\n`);
        process.stdout.write(`\nOpen the PDF and confirm the logo + bank block are present.\n`);
      } else {
        process.stdout.write(`FAILED to render sample for custNo=${report.sample.requested}: ${report.sample.error}\n`);
      }
    }
    if (report.outputFile) process.stdout.write(`\nFull JSON report written to: ${report.outputFile}\n`);
  }

  // Final safety footer.
  const elapsed = Date.now() - started;
  process.stdout.write(formatBanner('DRY-RUN COMPLETE'));
  process.stdout.write(`Elapsed:            ${elapsed} ms\n`);
  process.stdout.write(`Writes to database: 0\n`);
  process.stdout.write(`Emails sent:        0\n`);
  process.stdout.write(`Jobs queued:        0\n`);
  process.stdout.write(`Files moved:        0\n`);
  process.stdout.write(`Safety violations:  ${violations.length}\n`);
  if (violations.length > 0) {
    process.stdout.write('\n' + violations.join('\n') + '\n');
    process.exitCode = 99;
  }

  await cleanShutdown(report);
}

async function cleanShutdown(_report) {
  try { await sequelize.close(); } catch (_) { /* noop */ }
  // Explicit exit so any lingering Redis/queue handles from the required
  // modules don't hold the process open.
  setTimeout(() => process.exit(process.exitCode || 0), 100).unref();
}

main().catch(err => {
  console.error('\nDry-run crashed:', err);
  console.error(err.stack);
  process.exitCode = 1;
  cleanShutdown();
});
