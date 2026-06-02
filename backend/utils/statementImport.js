/**
 * Statement import helper.
 *
 * Centralises the dedupe + dual-file-slot logic so all four current Statement.create
 * call-sites (jobs/fileImport.js, jobs/invoiceImport.js, routes/files.js, routes/statements.js)
 * go through one path.
 *
 * Routing safety guarantees:
 *  - Statements only ever match Company.type = 'CORP'. If no CORP matches the
 *    provided accountNumber, no Statement is created and the caller is told so.
 *  - When a second-format file arrives for the same (companyId, periodEnd), we update
 *    the existing row in place: write the file path into pdfFileUrl or xlsFileUrl
 *    based on extension, never overwrite the other slot, never overwrite the parsed
 *    summary values that were captured from the first file.
 *  - The caller learns whether the row was newly created via `isNew`, so it can
 *    avoid sending a duplicate notification when the second-format pair arrives.
 */

const path = require('path');
const { Statement, Company } = require('../models');
const { calculateStatementRetentionDates } = require('./documentRetention');

/**
 * Classify a file path or filename as 'pdf', 'xls', or 'unknown'.
 */
function classifyStatementFile(filePathOrName) {
  if (!filePathOrName) return 'unknown';
  const ext = path.extname(String(filePathOrName)).toLowerCase().replace('.', '');
  if (ext === 'pdf') return 'pdf';
  if (ext === 'xls' || ext === 'xlsx' || ext === 'xlsm') return 'xls';
  return 'unknown';
}

/**
 * Resolve a CORP company by its accountNumber (referenceNo).
 * Returns the Company instance or null when no CORP match exists.
 */
async function findCorpCompanyByAccountNumber(accountNumber) {
  if (accountNumber === null || accountNumber === undefined) return null;
  const refNo = String(accountNumber).trim();
  if (!refNo) return null;

  return Company.findOne({
    where: {
      referenceNo: refNo,
      type: 'CORP'
    }
  });
}

/**
 * Coerce raw parsed values (which may be number or string) to a Number, falling
 * back to 0 for empty/invalid input. Used to normalise summary values regardless
 * of whether the upstream parser stored a Number (Excel auto-discovery) or a
 * String (PDF coordinate extraction).
 */
function coerceNumber(raw) {
  if (raw === null || raw === undefined || raw === '') return 0;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const cleaned = String(raw).replace(/[£$€¥₹,\s]/g, '');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function parseDateValue(raw) {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Find or create a Statement row, slotting the file into the correct format column.
 *
 * Handles four arrival cases against an existing (companyId, periodEnd) row:
 *  1. Same slot, byte-identical to the slot's recorded hash      -> no-op.
 *  2. Same slot, different content -> CORRECTION: overwrite the slot, refresh
 *     aging / closingBalance / parsedData, return `replaced: true` so the caller
 *     re-fires the notification. Suppressed when an existing manual upload would
 *     be overwritten by a generated re-run (manual is authoritative).
 *  3. Other slot empty -> second-format pairing: fill the empty slot, leave
 *     parsed values from the first file intact, audit any disagreement on
 *     `metadata.parsedDataConflict`.
 *  4. No existing row -> create.
 *
 * @param {object} opts
 * @param {string} opts.matchedCompanyId - Company UUID (must be CORP - caller's responsibility)
 * @param {Date}   opts.statementDate   - Date used as both periodStart and periodEnd
 * @param {object} opts.parsedData      - Parser output containing totalBalance + aging fields
 * @param {string} opts.filePath        - Absolute or relative path to the file just processed
 * @param {object} [opts.fileMeta]      - Optional metadata to record on metadata.fileSlots
 * @param {object} [opts.settings]      - Optional Settings instance for retention calc
 * @param {string} [opts.createdById]   - Optional user UUID to record on createdById
 * @param {string} [opts.documentStatus] - Optional documentStatus override
 * @param {string} [opts.source]        - 'manual_upload' (default) or 'generated'. Drives authority on corrections.
 * @param {string} [opts.fileHash]      - SHA-256 (or any stable hex hash) of the file bytes; enables byte-identical no-op detection on the manual-upload path.
 * @param {string} [opts.contentHash]   - Deterministic hash of the parsed statement content (header + aging + sorted invoices). Used on the generated path so that re-runs against unchanged BPCS data are correctly recognised as no-ops despite PDF/XLSX byte differences from embedded timestamps.
 * @param {boolean} [opts.forceOverwrite] - When true, bypass the manual-upload-is-authoritative suppression so a generated run can overwrite a manually-uploaded statement. Operator escape, not a default.
 *
 * @returns {Promise<{
 *   statement: object,
 *   isNew: boolean,
 *   fileSlot: 'pdf'|'xls'|'unknown',
 *   replaced: boolean,                 // true when a correction overwrote the slot
 *   contentChanged: boolean,           // true when incoming content differs from the recorded baseline
 *   suppressedByAuthority: boolean,    // true when a generated re-run was blocked by an existing manual upload
 *   baselined: boolean                 // true when an existing pre-content-hash row had its baseline stamped silently
 * }>}
 */
async function findOrCreateStatement({
  matchedCompanyId,
  statementDate,
  parsedData = {},
  filePath,
  fileMeta = {},
  settings = null,
  createdById = null,
  documentStatus = null,
  source = 'manual_upload',
  fileHash = null,
  contentHash = null,
  forceOverwrite = false
}) {
  if (!matchedCompanyId) {
    throw new Error('findOrCreateStatement: matchedCompanyId is required');
  }
  if (!statementDate || isNaN(new Date(statementDate).getTime())) {
    throw new Error('findOrCreateStatement: statementDate is required and must be a valid Date');
  }

  const fileSlot = classifyStatementFile(filePath);
  const parsedPeriodStart = parseDateValue(parsedData.periodStart || parsedData.statementPeriodStart);
  const parsedPeriodEnd = parseDateValue(parsedData.periodEnd || parsedData.statementPeriodEnd || parsedData.statementDate);
  const periodEnd = parsedPeriodEnd || new Date(statementDate);
  let periodStart = parsedPeriodStart || new Date(periodEnd);
  if (periodStart.getTime() > periodEnd.getTime()) {
    periodStart = new Date(periodEnd);
  }

  const existing = await Statement.findOne({
    where: {
      companyId: matchedCompanyId,
      periodEnd: periodEnd
    }
  });

  if (existing) {
    const existingMeta = existing.metadata || {};
    const existingSource = existingMeta.source || 'manual_upload';
    const slotUrlField = fileSlot === 'pdf' ? 'pdfFileUrl' : (fileSlot === 'xls' ? 'xlsFileUrl' : null);
    const slotPreviouslyOccupied = slotUrlField ? Boolean(existing[slotUrlField]) : false;

    // Generated path uses the deterministic content hash (parsed header +
    // aging + sorted invoice lines) to decide no-op vs correction. The
    // PDF/XLSX byte hash CANNOT be used here because LibreOffice/ExcelJS
    // stamp creation timestamps inside the files, so every regeneration is
    // byte-different even when the underlying BPCS data is identical.
    //
    // forceOverwrite bypasses BOTH the no-op AND the baseline branches:
    // the operator has explicitly asked to regenerate, so we fall straight
    // through to the slot-update logic regardless of hash state.
    if (source === 'generated' && contentHash && !forceOverwrite) {
      const existingContentHash = existingMeta.contentHash || null;

      if (existingContentHash && existingContentHash === contentHash) {
        // True no-op: BPCS data unchanged since the last generated stamp.
        // No file overwrite, no parsed-data refresh, no notification.
        return {
          statement: existing,
          isNew: false,
          fileSlot,
          replaced: false,
          contentChanged: false,
          suppressedByAuthority: false,
          baselined: false
        };
      }

      if (!existingContentHash) {
        // BASELINE: existing row was created before content-hash tracking
        // existed (or by the manual-upload path that doesn't compute one).
        // Silently stamp the hash so the *next* generated run can compare
        // cleanly. No correction, no notification - this is a one-time
        // migration event per Statement, not a content change. The
        // authority rule still applies if it would suppress, since we
        // still aren't going to overwrite the file or refresh values.
        const newMetadata = { ...existingMeta, contentHash };
        await existing.update({ metadata: newMetadata });
        return {
          statement: existing,
          isNew: false,
          fileSlot,
          replaced: false,
          contentChanged: false,
          suppressedByAuthority: false,
          baselined: true
        };
      }

      // contentHash differs -> real content change. Fall through to the
      // slot logic below, which writes the new files, refreshes parsed
      // values, and re-fires the notification (subject to authority).
    }

    if (slotPreviouslyOccupied) {
      // CASE 1/2: same slot occupied.
      //   - Manual path: dedupe on byte hash (a re-uploaded identical PDF
      //     is genuinely byte-identical, so this still works there).
      //   - Generated path: contentHash already established a change above,
      //     so we don't need a second byte-hash compare; treat as correction.
      if (source === 'manual_upload') {
        const recordedHash = ((existingMeta.fileSlots || {})[fileSlot] || {}).fileHash || null;
        const sameContent = !!(fileHash && recordedHash && fileHash === recordedHash);
        if (sameContent) {
          return {
            statement: existing,
            isNew: false,
            fileSlot,
            replaced: false,
            contentChanged: false,
            suppressedByAuthority: false,
            baselined: false
          };
        }
      }

      // Authority rule: a manual portal upload is authoritative over a CSV/FTP-generated
      // statement for the same period. Bypassed when forceOverwrite=true (operator escape).
      const suppressed = existingSource === 'manual_upload' && source === 'generated' && !forceOverwrite;
      if (suppressed) {
        console.warn(
          `[findOrCreateStatement] Suppressing generated correction for companyId=${matchedCompanyId}, ` +
          `periodEnd=${periodEnd.toISOString()}, slot=${fileSlot}; manual upload is authoritative ` +
          `(pass forceOverwrite=true to override).`
        );
        return {
          statement: existing,
          isNew: false,
          fileSlot,
          replaced: false,
          contentChanged: true,
          suppressedByAuthority: true,
          baselined: false
        };
      }

      const incomingClosingBalance = coerceNumber(
        parsedData.totalBalance != null ? parsedData.totalBalance : parsedData.amount
      );
      const incomingAging = {
        currentAmount: coerceNumber(parsedData.currentAmount),
        overdue1To30: coerceNumber(parsedData.overdue1To30),
        overdue31To60: coerceNumber(parsedData.overdue31To60),
        overdue61To90: coerceNumber(parsedData.overdue61To90),
        overdue91Plus: coerceNumber(parsedData.overdue91Plus),
        totalBalance: incomingClosingBalance
      };

      const newMetadata = { ...existingMeta };
      newMetadata.fileSlots = { ...(existingMeta.fileSlots || {}) };
      newMetadata.fileSlots[fileSlot] = {
        ...fileMeta,
        path: filePath,
        fileHash: fileHash || null,
        attachedAt: new Date().toISOString()
      };
      newMetadata.aging = incomingAging;
      newMetadata.parsedData = parsedData;
      newMetadata.source = source;
      newMetadata.lastCorrectedAt = new Date().toISOString();
      if (contentHash) {
        newMetadata.contentHash = contentHash;
      }
      // The previous parsedDataConflict marker (set when a second-format pairing
      // disagreed with the first file) is now resolved by the correction itself.
      delete newMetadata.parsedDataConflict;
      delete newMetadata.parsedDataConflictAt;

      const updates = {
        [slotUrlField]: filePath,
        fileUrl: filePath,
        closingBalance: incomingClosingBalance,
        metadata: newMetadata
      };
      await existing.update(updates);

      return {
        statement: existing,
        isNew: false,
        fileSlot,
        replaced: true,
        contentChanged: true,
        suppressedByAuthority: false,
        baselined: false
      };
    }

    // CASE 3: other slot empty -> second-format pairing path (existing behaviour).
    // Slot the file in without overwriting parsed values captured from the first file;
    // flag any disagreement on metadata so it's auditable.
    const updates = {};

    if (fileSlot === 'pdf' && !existing.pdfFileUrl) {
      updates.pdfFileUrl = filePath;
    } else if (fileSlot === 'xls' && !existing.xlsFileUrl) {
      updates.xlsFileUrl = filePath;
    }

    if (!existing.fileUrl && (updates.pdfFileUrl || updates.xlsFileUrl)) {
      updates.fileUrl = updates.pdfFileUrl || updates.xlsFileUrl;
    }

    const incomingSummary = {
      totalBalance: coerceNumber(parsedData.totalBalance),
      currentAmount: coerceNumber(parsedData.currentAmount),
      overdue1To30: coerceNumber(parsedData.overdue1To30),
      overdue31To60: coerceNumber(parsedData.overdue31To60),
      overdue61To90: coerceNumber(parsedData.overdue61To90),
      overdue91Plus: coerceNumber(parsedData.overdue91Plus)
    };
    const existingAging = (existing.metadata && existing.metadata.aging) || {};
    const conflict = Object.entries(incomingSummary).some(([k, v]) => {
      const prev = coerceNumber(existingAging[k]);
      return Math.abs(prev - v) > 0.01;
    });

    if (Object.keys(updates).length > 0 || conflict) {
      const newMetadata = { ...(existing.metadata || {}) };
      if (!newMetadata.fileSlots) newMetadata.fileSlots = {};
      if (fileSlot === 'pdf' || fileSlot === 'xls') {
        newMetadata.fileSlots[fileSlot] = {
          ...fileMeta,
          path: filePath,
          fileHash: fileHash || null,
          attachedAt: new Date().toISOString()
        };
      }
      if (conflict) {
        newMetadata.parsedDataConflict = true;
        newMetadata.parsedDataConflictAt = new Date().toISOString();
      }
      if (contentHash && !newMetadata.contentHash) {
        // First sighting of a content hash (e.g. PDF created the row, XLS
        // arrives here as the second-format pairing). Stamp it so future
        // generated runs can compare.
        newMetadata.contentHash = contentHash;
      }
      updates.metadata = newMetadata;
      await existing.update(updates);
    }

    return {
      statement: existing,
      isNew: false,
      fileSlot,
      replaced: false,
      contentChanged: false,
      suppressedByAuthority: false,
      baselined: false
    };
  }

  // CASE 4: first arrival - create the Statement with the parsed values and the correct file slot.
  const closingBalance = coerceNumber(parsedData.totalBalance != null ? parsedData.totalBalance : parsedData.amount);
  const aging = {
    currentAmount: coerceNumber(parsedData.currentAmount),
    overdue1To30: coerceNumber(parsedData.overdue1To30),
    overdue31To60: coerceNumber(parsedData.overdue31To60),
    overdue61To90: coerceNumber(parsedData.overdue61To90),
    overdue91Plus: coerceNumber(parsedData.overdue91Plus),
    totalBalance: closingBalance
  };

  const fileIdSlice = (fileMeta.fileId || '').toString().substring(0, 8);
  const statementDateIso = periodEnd.toISOString().split('T')[0];
  const generatedStatementNumber = `STMT-${matchedCompanyId}-${statementDateIso}${fileIdSlice ? '-' + fileIdSlice : ''}`;

  let retentionStartDate = null;
  let retentionExpiryDate = null;
  if (settings) {
    try {
      const retention = calculateStatementRetentionDates({ periodEnd }, settings);
      retentionStartDate = retention.retentionStartDate;
      retentionExpiryDate = retention.retentionExpiryDate;
    } catch (err) {
      console.warn(`[statementImport] Could not calculate retention dates: ${err.message}`);
    }
  }

  const slotEntry = (fileSlot === 'pdf' || fileSlot === 'xls')
    ? { [fileSlot]: { ...fileMeta, path: filePath, fileHash: fileHash || null, attachedAt: new Date().toISOString() } }
    : {};

  const statement = await Statement.create({
    statementNumber: generatedStatementNumber,
    companyId: matchedCompanyId,
    periodStart,
    periodEnd,
    openingBalance: 0,
    closingBalance,
    totalDebits: 0,
    totalCredits: 0,
    // Legacy workflow status retained for compatibility with old rows; UI uses documentStatus.
    status: 'draft',
    documentStatus: documentStatus || 'ready',
    fileUrl: filePath,
    pdfFileUrl: fileSlot === 'pdf' ? filePath : null,
    xlsFileUrl: fileSlot === 'xls' ? filePath : null,
    retentionStartDate,
    retentionExpiryDate,
    createdById,
    metadata: {
      ...fileMeta,
      source,
      contentHash: contentHash || null,
      fileSlots: slotEntry,
      aging,
      parsedData
    }
  });

  return {
    statement,
    isNew: true,
    fileSlot,
    replaced: false,
    contentChanged: false,
    suppressedByAuthority: false,
    baselined: false
  };
}

module.exports = {
  classifyStatementFile,
  findCorpCompanyByAccountNumber,
  findOrCreateStatement
};
