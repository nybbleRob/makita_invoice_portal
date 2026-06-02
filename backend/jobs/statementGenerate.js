/**
 * Per-customer statement generation job.
 *
 * Receives one customer's parsed payload from the ACR11P export uploaded via
 * `POST /api/statements/generate`. Generates the branded PDF + the simple
 * XLSX, matches the customer to a CORP company, calls `findOrCreateStatement`
 * (so dedupe on (companyId, periodEnd) lines up with the existing pipeline),
 * records File rows, and notifies the batch tracker so the downstream
 * notification fan-out runs unchanged.
 *
 * Failure modes that are routine, not alerts:
 *   - non-CORP / unknown customer number  -> File stored under unprocessed/failed
 *     with failureReason `company_not_found`. No Statement row, no email. By
 *     design (the export contains every customer; some are not in our DB).
 *   - Company currency not GBP            -> same, with reason `currency_mismatch`.
 *
 * Hard failures (re-thrown so BullMQ retries):
 *   - PDF/XLSX generation crashed (template missing, LibreOffice not installed,
 *     openpyxl missing, Python sidecar timed out).
 *   - Database error creating Statement/File.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const {
  File, Settings, User
} = require('../models');
const {
  PROCESSED_STATEMENTS,
  UNPROCESSED_FAILED,
  getDatedFolder
} = require('../config/storage');
const {
  findCorpCompanyByAccountNumber,
  findOrCreateStatement
} = require('../utils/statementImport');
const { logActivity, ActivityType } = require('../services/activityLogger');
const { buildExcel } = require('../services/statementGenerator/excel');
const { buildPdf } = require('../services/statementGenerator/pdf');
const { isoDate } = require('../services/statementGenerator/parse');
const { computeStatementContentHash } = require('../services/statementGenerator/contentHash');

// Unoserver pool wiring. The Python sidecar calls `unoconvert`, which talks to
// a running `unoserver` listener (single-threaded LibreOffice behind the
// scenes). One listener serialises concurrent calls and is the cause of the
// "conversion timed out after 180s" failures we saw under load.
//
// To scale we run N unoservers on different ports and round-robin per-job
// across them. Configure via env:
//   UNOSERVER_PORTS=2002,2004,2006,2008  (preferred; explicit list)
//   UNOSERVER_PORT=2002                  (fallback; single listener)
// If neither is set, we leave the port unset and the Python sidecar uses the
// unoconvert client default (2002).
//
// Worker concurrency MUST match the number of listeners (one job per
// listener). The queue worker enforces this hint at startup.
function parseUnoserverPorts() {
  const list = process.env.UNOSERVER_PORTS;
  if (list && String(list).trim()) {
    const ports = String(list)
      .split(/[\s,]+/)
      .map(p => parseInt(p, 10))
      .filter(p => Number.isFinite(p) && p > 0 && p < 65536);
    if (ports.length > 0) return ports;
  }
  const single = parseInt(process.env.UNOSERVER_PORT, 10);
  if (Number.isFinite(single) && single > 0 && single < 65536) return [single];
  return [];
}

const UNOSERVER_PORTS = parseUnoserverPorts();
let _unoserverRoundRobinIdx = 0;

function pickUnoserverPort() {
  if (UNOSERVER_PORTS.length === 0) return null;
  const idx = _unoserverRoundRobinIdx % UNOSERVER_PORTS.length;
  _unoserverRoundRobinIdx = (_unoserverRoundRobinIdx + 1) % UNOSERVER_PORTS.length;
  return UNOSERVER_PORTS[idx];
}

const { Statement } = require('../models');

/**
 * Parse YYYY-MM-DD (or any value Date() understands) into a Date. Falls back
 * to `now` if the input is missing/invalid - mirrors the safety net the
 * existing pipeline's parseDate uses, so dedupe behaviour stays consistent
 * across the two flows.
 */
function toStatementDate(iso) {
  if (!iso) return new Date();
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function safeUnlink(p) {
  if (!p) return;
  try { fs.unlinkSync(p); } catch (_) { /* best effort */ }
}

/**
 * Generated statement files live at a deterministic path
 * (`{custNo}_Statement_{date}.{ext}`), so re-runs of the same customer/date
 * always target the same path. Key the File row by `filePath` rather than
 * `fileHash` so a regenerated file with different bytes updates the existing
 * row in place instead of stranding the old row pointing at the now-overwritten
 * disk file. Soft-deleted rows are restored. Falls back to a hash lookup if no
 * row matches by path (covers older rows imported before this change).
 */
async function upsertFileRow(fields) {
  let existing = null;
  if (fields.filePath) {
    existing = await File.findOne({
      where: { filePath: fields.filePath },
      paranoid: false
    });
  }
  if (!existing && fields.fileHash) {
    existing = await File.findOne({
      where: { fileHash: fields.fileHash },
      paranoid: false
    });
  }
  if (existing) {
    await existing.update({ ...fields, deletedAt: null });
    return existing;
  }
  return File.create(fields);
}

/**
 * Resolve `Company.currency` if the column exists. Returns 'GBP' when the
 * column isn't defined on the model (current schema state) so the guard is a
 * no-op until a currency column is added.
 */
function getCompanyCurrency(company) {
  if (!company) return null;
  const raw = company.currency;
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return 'GBP';
  }
  return String(raw).trim().toUpperCase();
}

async function processStatementGenerate(job) {
  const startTime = Date.now();
  const {
    importId,
    userId,
    customer,
    statementDateIso,
    exportFileHash,
    exportFileName,
    exportArchivePath,
    forceOverwrite = false,
    silent = false
  } = job.data;

  if (!customer || !customer.custNo) {
    throw new Error('statement-generate: job payload missing customer.custNo');
  }

  const custNo = String(customer.custNo).trim();
  const stmtDateIso = statementDateIso || (customer.stmtDate ? isoDate(customer.stmtDate) : null);
  const stmtDate = toStatementDate(stmtDateIso);

  // Deterministic per-customer content hash over header + aging + sorted invoice
  // lines. Used to detect "this customer's data hasn't changed since last run"
  // BEFORE we pay the cost of LibreOffice and ExcelJS - and, more importantly,
  // so a re-run against unchanged BPCS data produces no notification (PDF/XLSX
  // file bytes are NOT reliable here because of embedded creation timestamps).
  const contentHash = computeStatementContentHash(customer);

  console.log(
    `📄 [StmtGen ${importId}] custNo=${custNo} ` +
    `pages=${(customer.pages || []).length} ` +
    `contentHash=${contentHash ? contentHash.slice(0, 12) : 'none'} ` +
    `unoPool=[${UNOSERVER_PORTS.join(',') || 'default'}]` +
    `${forceOverwrite ? ' forceOverwrite=true' : ''}` +
    `${silent ? ' silent=true' : ''}`
  );

  const dateForName = stmtDateIso || new Date().toISOString().slice(0, 10);
  const baseName = `${custNo}_Statement_${dateForName}`;
  const xlsxName = `${baseName}.xlsx`;
  const pdfName = `${baseName}.pdf`;

  // Declared in the outer scope so the catch block can clean up staged files
  // regardless of where the failure occurred inside the try.
  let xlsxStagedPath = null;
  let pdfStagedPath = null;
  let xlsxFinalPath = null;
  let pdfFinalPath = null;

  try {
    // 1. Match company FIRST (cheap; no file generation yet).
    const company = await findCorpCompanyByAccountNumber(custNo);

    // 2. Currency guard at match time (per plan: cannot be done at parse time
    // because the export has no currency field).
    //
    // IMPORTANT: failureReason is an ENUM on the files table, allowed values
    // are 'unallocated' | 'parsing_error' | 'validation_error' | 'duplicate'
    // | 'other'. The detailed reason ('company_not_found' / 'currency_mismatch')
    // goes into metadata.specificFailureReason where it can be arbitrary.
    // This mirrors the invoice import flow in jobs/invoiceImport.js.
    let failureReason = null;
    let specificFailureReason = null;
    if (company) {
      const currency = getCompanyCurrency(company);
      if (currency !== 'GBP') {
        failureReason = 'unallocated';
        specificFailureReason = 'currency_mismatch';
        console.warn(
          `⚠️  [StmtGen ${importId}] custNo=${custNo} matched company ${company.id} ` +
          `has currency=${currency}, expected GBP - routing to unallocated.`
        );
      }
    } else {
      failureReason = 'unallocated';
      specificFailureReason = 'company_not_found';
      console.log(
        `ℹ️  [StmtGen ${importId}] custNo=${custNo} did not match any CORP company - ` +
        `unallocated (expected for non-portal customers).`
      );
    }

    const matched = company && !failureReason;

    // 3. PRE-GENERATION SHORT-CIRCUITS. Two cases, both decided WITHOUT
    //    paying the cost of LibreOffice / ExcelJS and WITHOUT touching any
    //    files on disk:
    //
    //    A. UNCHANGED: existing Statement has a contentHash that matches the
    //       incoming customer's contentHash. No regeneration, no File rows,
    //       no Statement update, no notification.
    //
    //    B. BASELINE: existing Statement has no contentHash (either created
    //       by the legacy FTP-import pipeline, or had its hash explicitly
    //       cleared by /reset-source-to-generated). Stamp the hash so future
    //       runs can compare cleanly, but DO NOT regenerate - the existing
    //       customer-facing PDF/XLSX (whatever the old pipeline produced or
    //       was manually uploaded) is left in place. No notification.
    //
    //    Both bypass when forceOverwrite=true, which falls through to the
    //    normal generation path. The smoking-gun guarantee is "re-run an
    //    identical export -> no emails": case A delivers that once everyone
    //    is hashed; case B delivers it for the first prod run, when no row
    //    has a hash yet, by being a true no-op (not a silent file swap).
    const buildShortCircuitResult = (existingStatement, kind) => ({
      success: true,
      fileName: pdfName,
      fileId: null,
      xlsFileId: null,
      companyId: company.id,
      companyName: company.name || null,
      customerName: customer.custName || null,
      documentId: existingStatement.id,
      documentType: 'statement',
      status: 'parsed',
      isDuplicate: false,
      accountNumber: custNo,
      amount: customer.aging?.totalBal ?? 0,
      pages: (customer.pages || []).length,
      processingTime: Date.now() - startTime,
      timestamp: new Date().toISOString(),
      skipNotification: true,
      contentUnchanged: kind === 'unchanged',
      baselined: kind === 'baseline',
      correction: false,
      suppressedByAuthority: false,
      isNew: false
    });

    const recordShortCircuit = async (result) => {
      await job.updateProgress(100);
      const importStoreSC = require('../utils/importStore');
      await importStoreSC.addResult(importId, result);
      try {
        const { recordJobCompletion } = require('../services/batchNotificationService');
        await recordJobCompletion(importId, result);
      } catch (batchError) {
        console.warn(`⚠️  [StmtGen ${importId}] Failed to record batch completion (short-circuit):`, batchError.message);
      }
    };

    if (matched && !forceOverwrite && contentHash) {
      const existingStatement = await Statement.findOne({
        where: { companyId: company.id, periodEnd: stmtDate }
      });
      if (existingStatement) {
        const existingMeta = existingStatement.metadata || {};
        const existingHash = existingMeta.contentHash || null;

        if (existingHash && existingHash === contentHash) {
          console.log(
            `⏭️  [StmtGen ${importId}] custNo=${custNo} content unchanged (contentHash matches existing) - ` +
            `skipping regeneration and notification.`
          );
          const result = buildShortCircuitResult(existingStatement, 'unchanged');
          await recordShortCircuit(result);
          return result;
        }

        if (!existingHash) {
          const newMeta = {
            ...existingMeta,
            contentHash,
            contentHashBaselinedAt: new Date().toISOString()
          };
          await existingStatement.update({ metadata: newMeta });
          console.log(
            `📌 [StmtGen ${importId}] custNo=${custNo} baselined contentHash on existing pre-content-hash row - ` +
            `no regeneration, existing files preserved, no notification.`
          );
          const result = buildShortCircuitResult(existingStatement, 'baseline');
          await recordShortCircuit(result);
          return result;
        }

        // existingHash differs -> fall through to the normal generation path.
      }
    }

    // 4. Set up paths/dirs (only reached when we need to actually generate).
    const dateForFolder = stmtDateIso ? new Date(stmtDateIso) : new Date();
    const processedDir = getDatedFolder(PROCESSED_STATEMENTS, dateForFolder);
    const failedFolderName = `${dateForFolder.getFullYear()}-${String(dateForFolder.getMonth() + 1).padStart(2, '0')}-${String(dateForFolder.getDate()).padStart(2, '0')}`;
    const failedDir = path.join(UNPROCESSED_FAILED, failedFolderName);
    if (!fs.existsSync(failedDir)) {
      fs.mkdirSync(failedDir, { recursive: true });
    }

    xlsxStagedPath = path.join(processedDir, xlsxName);
    pdfStagedPath = path.join(processedDir, pdfName);

    let xlsxHash = null;
    let pdfHash = null;
    let xlsxSize = 0;
    let pdfSize = 0;

    // 5. Generate XLSX and PDF.
    await buildExcel(customer, xlsxStagedPath);
    const xlsxBuf = fs.readFileSync(xlsxStagedPath);
    xlsxHash = sha256(xlsxBuf);
    xlsxSize = xlsxBuf.length;

    // Pick a unoserver port for this job (round-robin across UNOSERVER_PORTS).
    // With one listener and concurrency=1 this is always the same port; with N
    // listeners + concurrency=N each running job hits its own listener so no
    // queuing happens inside LibreOffice.
    const pdfStart = Date.now();
    const pageCount = (customer.pages || []).length;
    const pickedPort = pickUnoserverPort();
    try {
      await buildPdf(customer, pdfStagedPath, pickedPort ? { unoPort: pickedPort } : undefined);
    } catch (pdfErr) {
      const elapsedMs = Date.now() - pdfStart;
      throw new Error(
        `PDF generation failed for custNo=${custNo} after ${elapsedMs}ms ` +
        `(pages=${pageCount}, unoPort=${pickedPort || 'default'}): ${pdfErr.message}`
      );
    }
    const pdfElapsedMs = Date.now() - pdfStart;
    if (pdfElapsedMs > 60_000) {
      console.warn(
        `🐢 [StmtGen ${importId}] custNo=${custNo} pdf took ${pdfElapsedMs}ms ` +
        `(pages=${pageCount}, unoPort=${pickedPort || 'default'}) - consider adding ` +
        `more unoservers (UNOSERVER_PORTS) or reducing STATEMENT_GENERATE_CONCURRENCY.`
      );
    }
    const pdfBuf = fs.readFileSync(pdfStagedPath);
    pdfHash = sha256(pdfBuf);
    pdfSize = pdfBuf.length;

    await job.updateProgress(50);

    // 6. If unmatched, move files to the failed folder.
    if (!matched) {
      xlsxFinalPath = path.join(failedDir, xlsxName);
      pdfFinalPath = path.join(failedDir, pdfName);
      if (xlsxStagedPath !== xlsxFinalPath) {
        try { fs.renameSync(xlsxStagedPath, xlsxFinalPath); }
        catch (_) { fs.copyFileSync(xlsxStagedPath, xlsxFinalPath); safeUnlink(xlsxStagedPath); }
      }
      if (pdfStagedPath !== pdfFinalPath) {
        try { fs.renameSync(pdfStagedPath, pdfFinalPath); }
        catch (_) { fs.copyFileSync(pdfStagedPath, pdfFinalPath); safeUnlink(pdfStagedPath); }
      }
    } else {
      xlsxFinalPath = xlsxStagedPath;
      pdfFinalPath = pdfStagedPath;
    }

    // 5. Record File rows for both formats (mirrors the existing pipeline so
    //    the Files admin view shows generated outputs alongside imported ones).
    const fileBaseMeta = {
      source: 'manual-upload-statement-generate',
      importId,
      generatedFrom: exportFileName || null,
      exportFileHash: exportFileHash || null,
      exportArchivePath: exportArchivePath || null,
      customerNo: custNo,
      statementDate: stmtDateIso,
      isDuplicate: false
    };

    const fileStatus = matched ? 'parsed' : 'unallocated';

    const xlsxFile = await upsertFileRow({
      fileName: xlsxName,
      fileHash: xlsxHash,
      filePath: xlsxFinalPath,
      fileSize: xlsxSize,
      fileType: 'statement',
      status: fileStatus,
      failureReason,
      parsedData: { custNo, statementDate: stmtDateIso },
      processingMethod: 'generated_xlsx',
      customerId: matched ? company.id : null,
      uploadedById: userId || null,
      metadata: {
        ...fileBaseMeta,
        format: 'xlsx',
        specificFailureReason: specificFailureReason || undefined,
        storagePath: xlsxFinalPath
      }
    });

    const pdfFile = await upsertFileRow({
      fileName: pdfName,
      fileHash: pdfHash,
      filePath: pdfFinalPath,
      fileSize: pdfSize,
      fileType: 'statement',
      status: fileStatus,
      failureReason,
      parsedData: { custNo, statementDate: stmtDateIso },
      processingMethod: 'generated_pdf',
      customerId: matched ? company.id : null,
      uploadedById: userId || null,
      metadata: {
        ...fileBaseMeta,
        format: 'pdf',
        specificFailureReason: specificFailureReason || undefined,
        storagePath: pdfFinalPath
      }
    });

    // 6. If matched, create/update the Statement row via the central helper.
    //    Two calls so dedupe + slot logic is identical to the existing flow:
    //    first call creates the row with the PDF slot filled; second call
    //    sees the row and slots in the XLS file. Across both calls we collect
    //    `isNew` / `replaced` / `suppressedByAuthority` to drive the single
    //    notification decision the batch dispatcher reads off `skipNotification`.
    let statement = null;
    let isNew = false;
    let anyReplaced = false;
    let anySuppressedByAuthority = false;

    if (matched) {
      const settings = await Settings.getSettings();
      const parsedData = {
        statementDate: stmtDateIso,
        totalBalance: customer.aging?.totalBal ?? 0,
        currentAmount: customer.aging?.current ?? 0,
        overdue1To30: customer.aging?.od1_30 ?? 0,
        overdue31To60: customer.aging?.od31_60 ?? 0,
        overdue61To90: customer.aging?.od61_90 ?? 0,
        overdue91Plus: customer.aging?.od91 ?? 0
      };

      const pdfResult = await findOrCreateStatement({
        matchedCompanyId: company.id,
        statementDate: stmtDate,
        parsedData,
        filePath: pdfFinalPath,
        fileMeta: {
          source: 'manual-upload-statement-generate',
          fileName: pdfName,
          processingMethod: 'generated_pdf',
          fileHash: pdfHash,
          fileId: pdfFile.id
        },
        settings,
        createdById: userId || null,
        documentStatus: 'ready',
        source: 'generated',
        fileHash: pdfHash,
        contentHash,
        forceOverwrite
      });
      statement = pdfResult.statement;
      isNew = pdfResult.isNew;
      anyReplaced = anyReplaced || pdfResult.replaced;
      anySuppressedByAuthority = anySuppressedByAuthority || pdfResult.suppressedByAuthority;

      const xlsResult = await findOrCreateStatement({
        matchedCompanyId: company.id,
        statementDate: stmtDate,
        parsedData,
        filePath: xlsxFinalPath,
        fileMeta: {
          source: 'manual-upload-statement-generate',
          fileName: xlsxName,
          processingMethod: 'generated_xlsx',
          fileHash: xlsxHash,
          fileId: xlsxFile.id
        },
        settings,
        createdById: userId || null,
        documentStatus: 'ready',
        source: 'generated',
        fileHash: xlsxHash,
        contentHash,
        forceOverwrite
      });
      statement = xlsResult.statement;
      isNew = isNew || xlsResult.isNew;
      anyReplaced = anyReplaced || xlsResult.replaced;
      anySuppressedByAuthority = anySuppressedByAuthority || xlsResult.suppressedByAuthority;

      if (anySuppressedByAuthority) {
        console.warn(
          `⚠️  [StmtGen ${importId}] custNo=${custNo} statement for periodEnd=${stmtDateIso} is manual-authoritative; ` +
          `generated files retained on disk but Statement row was NOT updated. The shadow File rows will be cleaned ` +
          `up as orphans on the next nightly sweep.`
        );
      }

      // Update file rows now we know the document id.
      await xlsxFile.update({
        metadata: { ...(xlsxFile.metadata || {}), documentId: statement.id, documentType: 'statement' }
      });
      await pdfFile.update({
        metadata: { ...(pdfFile.metadata || {}), documentId: statement.id, documentType: 'statement' }
      });
    }

    // Suppress the per-statement notification unless something materially changed:
    // - First creation (isNew)
    // - Genuine correction (replaced)
    // A byte-identical re-run, or a generated re-run blocked by an existing
    // manual upload, both fall through with skipNotification=true.
    //
    // The operator-supplied `silent` flag is an unconditional override:
    // regenerate the files and update the row as normal but never fire the
    // customer notification. Built for cutover normalisation runs where we
    // want every statement on the new renderer without spamming inboxes
    // about a render-engine swap that didn't change any values.
    const shouldNotify = matched
      && (isNew || anyReplaced)
      && !anySuppressedByAuthority
      && !silent;
    const skipNotificationFlag = !shouldNotify;

    await job.updateProgress(100);

    const processingTime = Date.now() - startTime;

    const result = {
      success: true,
      fileName: pdfName,
      // Surface BOTH files via the existing importStore result shape; the
      // primary fileId is the PDF (matches what the manual import flow
      // surfaces for statements first).
      fileId: matched ? pdfFile.id : pdfFile.id,
      xlsFileId: xlsxFile.id,
      companyId: matched ? company.id : null,
      companyName: matched ? (company.name || null) : null,
      customerName: customer.custName || null,
      documentId: statement ? statement.id : null,
      documentType: 'statement',
      status: fileStatus,
      isDuplicate: false,
      accountNumber: custNo,
      amount: customer.aging?.totalBal ?? 0,
      pages: (customer.pages || []).length,
      processingTime,
      timestamp: new Date().toISOString(),
      skipNotification: skipNotificationFlag,
      // Audit-friendly flags so the import-results UI can show what happened
      // even when no notification fires.
      correction: anyReplaced && !anySuppressedByAuthority,
      suppressedByAuthority: anySuppressedByAuthority,
      // Surfaces the cutover/silent mode in the import-results UI, so an
      // operator can confirm at a glance that customers were NOT emailed
      // on an intentional silent regeneration.
      silent,
      // Surface unallocated reason so the import results page can show it.
      specificFailureReason: specificFailureReason || undefined,
      failureReason: failureReason || undefined,
      // True when the Statement row was newly created by this run (false on
      // re-generation of an existing periodEnd).
      isNew
    };

    // 7. Record in importStore + batch tracker. Two side-effects:
    //    - import session progress (used by the frontend status poll)
    //    - batch notification fan-out (sends the "new statement" email + PDF/XLS
    //      attachments per user preference once all jobs in the batch finish)
    const importStore = require('../utils/importStore');
    await importStore.addResult(importId, result);

    try {
      const { recordJobCompletion } = require('../services/batchNotificationService');
      await recordJobCompletion(importId, result);
    } catch (batchError) {
      console.warn(`⚠️  [StmtGen ${importId}] Failed to record batch completion:`, batchError.message);
    }

    // Activity log (matched: success; unmatched: documented but not flagged).
    try {
      let user = null;
      if (userId) user = await User.findByPk(userId);
      await logActivity({
        type: ActivityType.FILE_IMPORT,
        userId: userId || null,
        userEmail: user?.email || 'system',
        userRole: user?.role || 'system',
        action: matched
          ? `Generated statement for ${custNo} (matched to ${company.name})`
          : `Generated statement for ${custNo} (unallocated: ${specificFailureReason})`,
        details: {
          importId,
          custNo,
          companyId: matched ? company.id : null,
          documentId: statement ? statement.id : null,
          pages: result.pages,
          processingTime,
          specificFailureReason: specificFailureReason || null
        },
        companyId: matched ? company.id : null,
        companyName: matched ? company.name : null,
        ipAddress: null,
        userAgent: 'system_queue'
      });
    } catch (logError) {
      console.error(`⚠️  [StmtGen ${importId}] Failed to log activity:`, logError.message);
    }

    return result;
  } catch (error) {
    // Best-effort cleanup: unlink any staged/final files we managed to write
    // before the failure so a retry doesn't trip the File.fileHash unique
    // constraint on a half-written file. Final paths and staged paths can be
    // the same value or different (matched vs unmatched branch); the existence
    // check handles both.
    for (const p of [xlsxStagedPath, xlsxFinalPath, pdfStagedPath, pdfFinalPath]) {
      if (p && fs.existsSync(p)) safeUnlink(p);
    }

    const processingTime = Date.now() - startTime;
    const errorMessage = error.message || 'Unknown error';
    console.error(`❌ [StmtGen ${importId}] custNo=${custNo} failed:`, errorMessage);

    const errorResult = {
      success: false,
      fileName: pdfName,
      accountNumber: custNo,
      customerName: customer?.custName || null,
      pages: (customer?.pages || []).length,
      error: errorMessage,
      errorDetails: (error.stack || '').substring(0, 500),
      processingTime,
      timestamp: new Date().toISOString()
    };

    try {
      const importStore = require('../utils/importStore');
      await importStore.addResult(importId, errorResult);
    } catch (storeErr) {
      console.warn(`⚠️  [StmtGen ${importId}] Failed to record failure in importStore:`, storeErr.message);
    }

    try {
      const { recordJobCompletion } = require('../services/batchNotificationService');
      await recordJobCompletion(importId, errorResult);
    } catch (batchError) {
      console.warn(`⚠️  [StmtGen ${importId}] Failed to record batch failure:`, batchError.message);
    }

    throw error;
  }
}

module.exports = {
  processStatementGenerate,
  UNOSERVER_PORTS
};
