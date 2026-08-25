/**
 * Shared runner for the ACR11P (.TXT / tab-delimited) statement export.
 *
 * This is called from two places:
 *
 *   1. The admin sandbox route  (`POST /api/statements/generate`) — silent=true
 *      is forced by the route, so re-running against the same test export never
 *      emails customers. Used for smoke testing the generator without side
 *      effects.
 *
 *   2. The FTP file import job  (`backend/jobs/fileImport.js`) — silent=false,
 *      i.e. the production path. Statements generated here will notify
 *      customers who have `sendStatementEmail = true`, respecting their
 *      per-format attachment preferences.
 *
 * Both entry points must stay in lockstep on the parse/archive/enqueue steps,
 * which is the whole reason this helper exists.
 *
 * Content-hash correction detection, currency guard, CORP-only routing, and
 * manual-upload authority all live in the per-customer worker
 * (`backend/jobs/statementGenerate.js`) — this file just parses and fans out.
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const { parseExportText } = require('./parse');
const { statementGenerateQueue } = require('../../config/queue');
const { PROCESSED_STATEMENTS, getDatedFolder } = require('../../config/storage');
const importStore = require('../../utils/importStore');
const { registerBatch } = require('../batchNotificationService');
const { logActivity, ActivityType } = require('../activityLogger');

/**
 * Heuristic: does the given text look like an ACR11P export?
 *
 * The parser requires exactly 26 tab-delimited fields per non-blank line.
 * We short-circuit before that with a very cheap sniff so an accidental
 * `notes.txt` in the FTP folder doesn't parse-and-fail — we can early-return
 * a clean "not an ACR11P" and let the caller mark the file as unallocated.
 *
 * A single non-blank first line with 25+ tabs is a strong enough signal —
 * no legitimate non-ACR11P text file we've ever seen has that shape.
 *
 * @param {string} text
 * @returns {boolean}
 */
function looksLikeAcr11pExport(text) {
  if (typeof text !== 'string' || text.length === 0) return false;
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (line.length === 0) continue;
    const tabs = (line.match(/\t/g) || []).length;
    return tabs >= 25; // First non-blank line decides it.
  }
  return false;
}

/**
 * Parse, archive, and fan out an ACR11P export into per-customer generation
 * jobs. Does NOT do the actual PDF/XLSX generation — that happens in the
 * `statement-generate` worker.
 *
 * @param {Object}  args
 * @param {Buffer}  args.buffer              - Raw file contents.
 * @param {string}  args.fileHash            - sha256 of the file, for job payload.
 * @param {string}  args.originalFileName    - Original .TXT filename (for archive + audit).
 * @param {string}  args.source              - Source tag (activity log + batch).
 *                                             e.g. 'admin-sandbox-statement-generate'
 *                                                | 'ftp_import_statement_generate'
 * @param {boolean} [args.silent=false]      - If true, per-customer jobs skip
 *                                             customer notifications entirely.
 *                                             Sandbox path forces true; FTP path
 *                                             leaves it false (production).
 * @param {boolean} [args.forceOverwrite=false] - Bypass content-hash + manual-upload
 *                                             authority in the per-customer worker.
 *                                             Only exposed on the sandbox UI.
 * @param {Object}  [args.actor]             - Actor for activity log entry.
 * @param {string}  [args.actor.userId]
 * @param {string}  [args.actor.userEmail]
 * @param {string}  [args.actor.userRole]
 * @param {string}  [args.actor.ipAddress]
 * @param {string}  [args.actor.userAgent]
 * @param {Object}  [args.extraJobData]      - Merged into every per-customer job payload.
 *                                             Used by the FTP path to carry ftpFolder /
 *                                             sourceFileId so downstream can trace back.
 *
 * @returns {Promise<{
 *   importId: string,
 *   statementDate: string | null,
 *   totalCustomers: number,
 *   archivePath: string | null,
 *   validation: {
 *     parsedLines: number,
 *     malformedLines: Array<{lineNumber: number, reason: string}>,
 *     unknownTerms: Array<{lineNumber: number, customerNo: string, terms: string}>
 *   }
 * }>}
 *
 * @throws {Error} If parsing fails OR the export contains no valid customer rows.
 *                 The `.code` property is set for programmatic handling:
 *                   - 'ACR11P_PARSE_ERROR' — malformed input at the parser level
 *                   - 'ACR11P_EMPTY'       — parsed OK but zero customers
 */
async function runAcr11pImport(args) {
  const {
    buffer,
    fileHash,
    originalFileName,
    source,
    silent = false,
    forceOverwrite = false,
    actor = {},
    extraJobData = {}
  } = args;

  if (!Buffer.isBuffer(buffer)) {
    throw new Error('runAcr11pImport: buffer is required and must be a Buffer');
  }
  if (!source) {
    throw new Error('runAcr11pImport: source tag is required (used for audit + batch attribution)');
  }

  const text = buffer.toString('utf8');

  // Parse. Parse errors are surfaced as ACR11P_PARSE_ERROR so callers can
  // distinguish "bad file" from "unexpected system error".
  let parsed;
  try {
    parsed = parseExportText(text);
  } catch (parseErr) {
    const err = new Error(`Failed to parse ACR11P export: ${parseErr.message}`);
    err.code = 'ACR11P_PARSE_ERROR';
    err.cause = parseErr;
    throw err;
  }

  const customers = parsed.customerList;
  if (customers.length === 0) {
    const err = new Error('ACR11P export contained no valid customer rows.');
    err.code = 'ACR11P_EMPTY';
    err.validation = parsed.validation;
    throw err;
  }

  const importId = uuidv4();
  const statementDateIso = parsed.statementDate; // YYYY-MM-DD or null

  // Archive the source .TXT next to the generated PDF/XLSX outputs.
  // Non-fatal on failure — the worker uses the in-memory customer payload,
  // the archive is only for post-hoc "which export produced this batch?" audit.
  const archiveDate = statementDateIso ? new Date(statementDateIso) : new Date();
  const archiveDir = getDatedFolder(PROCESSED_STATEMENTS, archiveDate);
  const safeBase = path.basename(
    originalFileName || 'acr11p_export',
    path.extname(originalFileName || '.txt')
  );
  const ext = path.extname(originalFileName || '.txt') || '.txt';
  const archiveName = `${safeBase}_${importId}${ext}`;
  const archivePath = path.join(archiveDir, archiveName);
  try {
    if (!fs.existsSync(archiveDir)) {
      fs.mkdirSync(archiveDir, { recursive: true });
    }
    fs.writeFileSync(archivePath, buffer);
  } catch (archiveErr) {
    console.warn(`[Acr11pImporter] Could not archive export to ${archivePath}: ${archiveErr.message}`);
  }

  // Audit entry BEFORE enqueuing so if anything downstream fails, the operator
  // can still trace what triggered it.
  try {
    await logActivity({
      type: ActivityType.FILE_UPLOAD,
      userId: actor.userId || null,
      userEmail: actor.userEmail || 'system',
      userRole: actor.userRole || null,
      action: (() => {
        const bits = [
          `Statement generation from ACR11P (${customers.length} customer${customers.length === 1 ? '' : 's'})`
        ];
        if (silent) bits.push('silent');
        if (forceOverwrite) bits.push('forceOverwrite');
        return bits.join(', ');
      })(),
      details: {
        importId,
        fileName: originalFileName || null,
        fileHash: fileHash || null,
        customerCount: customers.length,
        statementDate: statementDateIso,
        malformedLines: parsed.validation.malformedLines.length,
        unknownTermsCount: parsed.validation.unknownTerms.length,
        source,
        documentType: 'statement',
        silent,
        forceOverwrite
      },
      companyId: null,
      companyName: null,
      ipAddress: actor.ipAddress || null,
      userAgent: actor.userAgent || null
    });
  } catch (auditErr) {
    console.warn(`[Acr11pImporter] Activity log write failed (non-fatal): ${auditErr.message}`);
  }

  // Import session + batch registration so the existing /import/:importId
  // status + results endpoints and the batch notification fan-out both work
  // unchanged. The batch is what makes "one summary email per recipient per
  // export" possible even though we fan out to N per-customer jobs.
  await importStore.createImport(
    importId,
    customers.length,
    archivePath ? [archivePath] : [],
    actor.userId || null
  );
  try {
    await registerBatch(importId, customers.length, {
      userId: actor.userId || null,
      userEmail: actor.userEmail || 'system',
      source
    });
  } catch (batchErr) {
    // Batch registration is best-effort: if Redis is briefly unavailable we
    // still want the jobs to run and files to land; they just won't be
    // batched into a summary email. Log loudly.
    console.warn(`[Acr11pImporter] registerBatch failed (non-fatal): ${batchErr.message}`);
  }

  const enqueuedAt = new Date().toISOString();
  for (const cust of customers) {
    await statementGenerateQueue.add(
      'statement-generate',
      {
        importId,
        userId: actor.userId || null,
        source,
        enqueuedAt,
        exportFileHash: fileHash || null,
        exportFileName: originalFileName || null,
        exportArchivePath: archivePath,
        statementDateIso,
        forceOverwrite,
        silent,
        customer: cust,
        ...extraJobData
      },
      {
        priority: 1,
        attempts: 2,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: false
      }
    );
  }

  return {
    importId,
    statementDate: statementDateIso,
    totalCustomers: customers.length,
    archivePath,
    validation: {
      parsedLines: parsed.validation.parsedLines,
      malformedLines: parsed.validation.malformedLines,
      unknownTerms: parsed.validation.unknownTerms
    }
  };
}

module.exports = {
  runAcr11pImport,
  looksLikeAcr11pExport
};
