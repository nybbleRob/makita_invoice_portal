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
const { calculateDocumentRetentionDates } = require('./documentRetention');

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

/**
 * Find or create a Statement row, slotting the file into the correct format column.
 *
 * @param {object} opts
 * @param {string} opts.matchedCompanyId - Company UUID (must be CORP - caller's responsibility)
 * @param {Date}   opts.statementDate   - Date used as both periodStart and periodEnd
 * @param {object} opts.parsedData      - Parser output containing totalBalance + aging fields
 * @param {string} opts.filePath        - Absolute or relative path to the file just processed
 * @param {object} [opts.fileMeta]      - Optional metadata to record on metadata.parsedData
 * @param {object} [opts.settings]      - Optional Settings instance for retention calc
 * @param {string} [opts.createdById]   - Optional user UUID to record on createdById
 * @param {string} [opts.documentStatus] - Optional documentStatus override
 *
 * @returns {Promise<{ statement: object, isNew: boolean, fileSlot: 'pdf'|'xls'|'unknown' }>}
 */
async function findOrCreateStatement({
  matchedCompanyId,
  statementDate,
  parsedData = {},
  filePath,
  fileMeta = {},
  settings = null,
  createdById = null,
  documentStatus = null
}) {
  if (!matchedCompanyId) {
    throw new Error('findOrCreateStatement: matchedCompanyId is required');
  }
  if (!statementDate || isNaN(new Date(statementDate).getTime())) {
    throw new Error('findOrCreateStatement: statementDate is required and must be a valid Date');
  }

  const fileSlot = classifyStatementFile(filePath);
  const periodEnd = new Date(statementDate);
  const periodStart = new Date(statementDate);

  const existing = await Statement.findOne({
    where: {
      companyId: matchedCompanyId,
      periodEnd: periodEnd
    }
  });

  if (existing) {
    // Second-format pairing path. Slot the file in without overwriting parsed values
    // captured from the first file; flag any disagreement on metadata so it's auditable.
    const updates = {};

    if (fileSlot === 'pdf' && !existing.pdfFileUrl) {
      updates.pdfFileUrl = filePath;
    } else if (fileSlot === 'xls' && !existing.xlsFileUrl) {
      updates.xlsFileUrl = filePath;
    }

    // If the legacy single-slot fileUrl is empty, mirror whichever path we have.
    if (!existing.fileUrl && (updates.pdfFileUrl || updates.xlsFileUrl)) {
      updates.fileUrl = updates.pdfFileUrl || updates.xlsFileUrl;
    }

    // Compare parsed summary values (best-effort; leave conflict flag for ops).
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
          attachedAt: new Date().toISOString()
        };
      }
      if (conflict) {
        newMetadata.parsedDataConflict = true;
        newMetadata.parsedDataConflictAt = new Date().toISOString();
      }
      updates.metadata = newMetadata;
      await existing.update(updates);
    }

    return { statement: existing, isNew: false, fileSlot };
  }

  // First arrival - create the Statement with the parsed values and the correct file slot.
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
      const retention = calculateDocumentRetentionDates({ documentDate: periodEnd }, settings);
      retentionStartDate = retention.retentionStartDate;
      retentionExpiryDate = retention.retentionExpiryDate;
    } catch (err) {
      console.warn(`[statementImport] Could not calculate retention dates: ${err.message}`);
    }
  }

  const statement = await Statement.create({
    statementNumber: generatedStatementNumber,
    companyId: matchedCompanyId,
    periodStart,
    periodEnd,
    openingBalance: 0,
    closingBalance,
    totalDebits: 0,
    totalCredits: 0,
    status: 'sent',
    documentStatus: documentStatus || 'ready',
    fileUrl: filePath,
    pdfFileUrl: fileSlot === 'pdf' ? filePath : null,
    xlsFileUrl: fileSlot === 'xls' ? filePath : null,
    retentionStartDate,
    retentionExpiryDate,
    createdById,
    metadata: {
      ...fileMeta,
      fileSlots: fileSlot === 'unknown'
        ? {}
        : { [fileSlot]: { ...fileMeta, path: filePath, attachedAt: new Date().toISOString() } },
      aging,
      parsedData
    }
  });

  return { statement, isNew: true, fileSlot };
}

module.exports = {
  classifyStatementFile,
  findCorpCompanyByAccountNumber,
  findOrCreateStatement
};
