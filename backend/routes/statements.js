const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { Statement, Company, File, Sequelize, Settings } = require('../models');
const { calculateDocumentRetentionDates } = require('../utils/documentRetention');
const { Op } = Sequelize;
const auth = require('../middleware/auth');
const { checkDocumentAccess, buildCompanyFilter } = require('../middleware/documentAccess');
const { getDescendantCompanyIds } = require('../utils/companyHierarchy');
const { logActivity, ActivityType } = require('../services/activityLogger');
const { requirePermission } = require('../middleware/permissions');
const { invoiceImportQueue, statementGenerateQueue } = require('../config/queue');
const { ensureStorageDirs, getStorageDir } = require('../config/storage');
const router = express.Router();

// Multer storage for statement imports (PDF + Excel) — mirrors the invoice import pattern
ensureStorageDirs();
const tempImportsDir = getStorageDir('temp');
const importStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, tempImportsDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname) || '.pdf';
    cb(null, `import-${uniqueSuffix}${ext}`);
  }
});
const STATEMENT_ALLOWED_EXTS = ['.pdf', '.xlsx', '.xls'];
const importUpload = multer({
  storage: importStorage,
  limits: { fileSize: 10 * 1024 * 1024, files: 500 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (STATEMENT_ALLOWED_EXTS.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF and Excel files (.pdf, .xlsx, .xls) are allowed for statement imports.'), false);
    }
  }
});

// Separate multer config for the ACR11P export generator. Accepts a single
// tab-delimited .TXT (or .csv) file. Limit is larger than the per-file PDF
// limit because the export covers all customers in one upload.
const STATEMENT_EXPORT_ALLOWED_EXTS = ['.txt', '.csv'];
const STATEMENT_EXPORT_MAX_BYTES = 50 * 1024 * 1024; // 50 MB
const exportUpload = multer({
  storage: importStorage,
  limits: { fileSize: STATEMENT_EXPORT_MAX_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (STATEMENT_EXPORT_ALLOWED_EXTS.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only tab-delimited .TXT or .csv export files are allowed.'), false);
    }
  }
});

/**
 * Resolve a stored file path to the actual on-disk path, supporting both absolute
 * paths (production) and paths relative to the backend root (legacy).
 */
function resolveStatementFile(storedPath) {
  if (!storedPath) return null;
  let resolved = storedPath;
  if (!path.isAbsolute(storedPath)) {
    const candidate = path.join(__dirname, '..', storedPath);
    resolved = fs.existsSync(candidate) ? candidate : storedPath;
  }
  return fs.existsSync(resolved) ? resolved : null;
}

/**
 * Mark a statement as viewed/downloaded according to the same documentStatus rules
 * the invoice routes use, then persist. Returns the (possibly updated) statement.
 */
async function markStatementAccess(statement, kind, req) {
  const settings = await Settings.getSettings();
  const onlyExternal = settings.onlyExternalUsersChangeDocumentStatus;
  const canUpdateStatus = !onlyExternal || req.user.role === 'external_user';
  const now = new Date();

  if (kind === 'view') {
    if (canUpdateStatus && !statement.viewedAt) {
      statement.viewedAt = now;
      if (statement.documentStatus === 'ready' || statement.documentStatus === 'review') {
        statement.documentStatus = 'viewed';
      }
      await statement.save();
    }
  } else if (kind === 'download') {
    if (canUpdateStatus) {
      if (!statement.downloadedAt) statement.downloadedAt = now;
      statement.documentStatus = 'downloaded';
      if (!statement.viewedAt) statement.viewedAt = now;

      const metadata = statement.metadata || {};
      if (!metadata.downloadedBy) {
        metadata.downloadedBy = req.user.userId;
        metadata.downloadedByEmail = req.user.email;
        metadata.downloadedByName = req.user.name || req.user.email;
      }
      statement.metadata = metadata;
      await statement.save();
    }
  }

  return statement;
}

// Apply auth and company-scoped document access checks to all routes.
// Route-level permissions for create/edit/delete/import mirror invoices/credit notes.
router.use(auth);
router.use(checkDocumentAccess);

// Get all statements (filtered by user's accessible companies)
router.get('/', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      search = '',
      companyId,
      companyIds,
      status,
      startDate,
      endDate,
      sortBy = 'periodEnd',
      sortOrder = 'DESC',
      retentionFilter
    } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;
    
    const whereConditions = buildCompanyFilter(req.accessibleCompanyIds);
    
    // Company filter - support both single and multiple IDs
    // IMPORTANT: Expand parent company IDs to include all descendants (branches)
    if (companyIds) {
      // Handle comma-separated string or array
      const ids = Array.isArray(companyIds) ? companyIds : companyIds.split(',').map(id => id.trim()).filter(id => id);
      if (ids.length > 0) {
        // Expand each company ID to include its descendants (for parent companies)
        const expandedIds = new Set();
        for (const id of ids) {
          expandedIds.add(id);
          const descendants = await getDescendantCompanyIds(id, false);
          descendants.forEach(d => expandedIds.add(d));
        }
        whereConditions.companyId = { [Op.in]: Array.from(expandedIds) };
      }
    } else if (companyId) {
      // Single company ID - also expand to include descendants
      const expandedIds = new Set([companyId]);
      const descendants = await getDescendantCompanyIds(companyId, false);
      descendants.forEach(d => expandedIds.add(d));
      whereConditions.companyId = { [Op.in]: Array.from(expandedIds) };
    }
    
    // Document status filter (ready_new, viewed, downloaded, queried, review) - same as invoices/credit notes
    if (status && status !== 'all') {
      const statusConditions = [];
      if (status === 'ready_new') {
        statusConditions.push({
          documentStatus: 'ready',
          viewedAt: null
        });
      } else if (status === 'viewed') {
        statusConditions.push({
          [Op.or]: [
            { documentStatus: 'viewed' },
            Sequelize.literal(`("Statement"."viewedAt" IS NOT NULL AND "Statement"."downloadedAt" IS NULL)`)
          ]
        });
      } else if (status === 'downloaded') {
        statusConditions.push({
          [Op.or]: [
            { documentStatus: 'downloaded' },
            Sequelize.literal(`"Statement"."downloadedAt" IS NOT NULL`)
          ]
        });
      } else if (status === 'queried') {
        statusConditions.push({ documentStatus: 'queried' });
      } else if (status === 'review') {
        statusConditions.push({ documentStatus: 'review' });
      }

      if (statusConditions.length > 0) {
        whereConditions[Op.and] = whereConditions[Op.and] || [];
        whereConditions[Op.and].push(...statusConditions);
      }
    }
    
    if (startDate || endDate) {
      whereConditions[Op.and] = [];
      if (startDate) {
        whereConditions[Op.and].push({
          periodEnd: { [Op.gte]: new Date(startDate) }
        });
      }
      if (endDate) {
        whereConditions[Op.and].push({
          periodStart: { [Op.lte]: new Date(endDate) }
        });
      }
    }
    
    if (search) {
      whereConditions[Op.or] = [
        { statementNumber: { [Op.iLike]: `%${search}%` } },
        { notes: { [Op.iLike]: `%${search}%` } }
      ];
    }

    // retentionFilter=expiring_soonest only surfaces rows that still have a retention
    // expiry date set. Sort handling below picks up retentionExpiryDate ASC for this case.
    if (retentionFilter === 'expiring_soonest') {
      whereConditions.retentionExpiryDate = { [Op.ne]: null };
    }

    // Whitelist sortable columns to prevent arbitrary SQL column references.
    const sortableFields = new Set([
      'periodEnd', 'periodStart', 'statementNumber', 'status',
      'openingBalance', 'closingBalance', 'createdAt',
      'retentionExpiryDate'
    ]);
    const orderField = sortableFields.has(sortBy) ? sortBy : 'periodEnd';
    const orderDir = String(sortOrder).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const order = [[orderField, orderDir]];
    // Tie-breaker on createdAt so identical sort keys produce stable pagination.
    if (orderField !== 'createdAt') order.push(['createdAt', 'DESC']);

    const { count, rows } = await Statement.findAndCountAll({
      where: whereConditions,
      include: [{
        model: Company,
        as: 'company',
        attributes: ['id', 'name', 'referenceNo', 'type']
      }],
      limit: limitNum,
      offset: offset,
      order
    });
    
    res.json({
      data: rows,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: count,
        pages: Math.ceil(count / limitNum)
      }
    });
  } catch (error) {
    console.error('Error fetching statements:', error);
    res.status(500).json({ message: error.message });
  }
});

// Bulk delete statements - must be declared BEFORE /:id routes so it isn't shadowed.
router.post('/bulk-delete', requirePermission('STATEMENTS_DELETE'), async (req, res) => {
  try {
    const { statementIds, reason } = req.body;

    if (!Array.isArray(statementIds) || statementIds.length === 0) {
      return res.status(400).json({ message: 'No statement IDs provided' });
    }

    if (!reason || reason.trim().length === 0) {
      return res.status(400).json({ message: 'Deletion reason is required for accountability.' });
    }

    if (statementIds.length > 100) {
      return res.status(400).json({ message: 'Maximum 100 statements can be deleted at once' });
    }

    const statements = await Statement.findAll({
      where: {
        id: { [Op.in]: statementIds },
        ...buildCompanyFilter(req.accessibleCompanyIds)
      },
      include: [{
        model: Company,
        as: 'company',
        attributes: ['id', 'name']
      }]
    });

    if (statements.length === 0) {
      return res.status(404).json({ message: 'No accessible statements found' });
    }

    const deletionReason = reason.trim();
    const deleted = [];
    const failed = [];

    for (const statement of statements) {
      try {
        // Best-effort delete physical files (legacy fileUrl + new pdf/xls slots).
        const filesToRemove = new Set([
          statement.fileUrl,
          statement.pdfFileUrl,
          statement.xlsFileUrl
        ].filter(Boolean));

        for (const stored of filesToRemove) {
          const filePath = resolveStatementFile(stored);
          if (filePath) {
            try {
              fs.unlinkSync(filePath);
              console.log(`🗑️  Deleted statement file: ${filePath}`);
            } catch (fileError) {
              console.error(`⚠️  Failed to delete statement file ${filePath}: ${fileError.message}`);
            }
          }
        }

        await statement.destroy({ force: true });

        await logActivity({
          type: ActivityType.STATEMENT_DELETED,
          userId: req.user.userId,
          userEmail: req.user.email,
          userRole: req.user.role,
          action: `Bulk deleted statement ${statement.statementNumber || statement.id}`,
          details: {
            statementId: statement.id,
            statementNumber: statement.statementNumber,
            reason: deletionReason,
            bulkDelete: true
          },
          companyId: statement.companyId,
          companyName: statement.company?.name || null,
          ipAddress: req.ip || req.connection.remoteAddress,
          userAgent: req.get('user-agent')
        });

        deleted.push({
          id: statement.id,
          statementNumber: statement.statementNumber,
          companyName: statement.company?.name || 'Unknown'
        });
      } catch (error) {
        console.error(`❌ Error deleting statement ${statement.id}:`, error.message);
        failed.push({
          id: statement.id,
          statementNumber: statement.statementNumber,
          error: error.message
        });
      }
    }

    res.json({
      message: `Deleted ${deleted.length} of ${statements.length} statement(s)`,
      deleted,
      failed
    });
  } catch (error) {
    console.error('Error bulk deleting statements:', error);
    res.status(500).json({ message: error.message });
  }
});

/**
 * Bulk import statement files (PDF + Excel). Mirrors the invoice import pattern,
 * but accepts XLSX/XLS as well as PDF and tags jobs with forceDocumentType so the
 * worker routes them through the statement-only path (CORP-only company match
 * + findOrCreateStatement).
 *
 * Declared before /:id routes so 'import' isn't matched as a statement id.
 */
router.post('/import',
  requirePermission('STATEMENTS_IMPORT'),
  importUpload.array('files', 500),
  async (req, res) => {
    try {
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No files uploaded. Please select at least one file.',
          error: 'No files provided'
        });
      }

      const invalidFiles = req.files.filter(file => {
        const ext = path.extname(file.originalname).toLowerCase();
        return !STATEMENT_ALLOWED_EXTS.includes(ext);
      });
      if (invalidFiles.length > 0) {
        invalidFiles.forEach(file => {
          if (fs.existsSync(file.path)) {
            try { fs.unlinkSync(file.path); } catch (_) {}
          }
        });
        return res.status(400).json({
          success: false,
          message: `Only PDF/XLSX/XLS files are allowed for statement imports. ${invalidFiles.length} invalid file(s) rejected.`,
          error: 'Invalid file type'
        });
      }

      if (req.files.length > 500) {
        req.files.forEach(file => {
          if (fs.existsSync(file.path)) {
            try { fs.unlinkSync(file.path); } catch (_) {}
          }
        });
        return res.status(400).json({
          success: false,
          message: 'Maximum 500 files allowed for import.',
          error: 'Too many files'
        });
      }

      const importId = uuidv4();
      const userId = req.user.userId;

      await logActivity({
        type: ActivityType.FILE_UPLOAD,
        userId,
        userEmail: req.user.email,
        userRole: req.user.role,
        action: `Uploaded ${req.files.length} statement file(s) for import`,
        details: {
          importId,
          fileCount: req.files.length,
          fileNames: req.files.map(f => f.originalname),
          uploadMethod: 'manual',
          documentType: 'statement'
        },
        companyId: null,
        companyName: null,
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('user-agent')
      });

      // Hash all files first so we can do a single batched duplicate-check query
      const fileHashMap = new Map();
      const fileHashes = [];
      for (const file of req.files) {
        const absolutePath = path.resolve(file.path);
        if (!fs.existsSync(absolutePath)) {
          console.error(`⚠️  File not found after upload: ${absolutePath}`);
          continue;
        }
        try {
          const buffer = fs.readFileSync(absolutePath);
          const fileHash = crypto.createHash('sha256').update(buffer).digest('hex');
          fileHashMap.set(absolutePath, {
            hash: fileHash,
            fileName: path.basename(file.path),
            originalName: file.originalname
          });
          fileHashes.push(fileHash);
        } catch (hashError) {
          console.error(`⚠️  Error calculating hash for ${absolutePath}:`, hashError.message);
        }
      }

      const settings = await Settings.findOne();
      const retentionDays = settings?.fileRetentionDays || null;
      const retentionDate = retentionDays
        ? new Date(Date.now() - (retentionDays * 24 * 60 * 60 * 1000))
        : null;

      const duplicateWhere = { fileHash: { [Op.in]: fileHashes } };
      if (retentionDate) {
        duplicateWhere[Op.or] = [
          { deletedAt: null },
          { deletedAt: { [Op.gte]: retentionDate } }
        ];
      }

      const existingFiles = fileHashes.length > 0
        ? await File.findAll({
            where: duplicateWhere,
            attributes: ['id', 'fileHash', 'fileName', 'status', 'deletedAt', 'filePath'],
            order: [['createdAt', 'DESC']]
          })
        : [];

      const existingHashesMap = new Map();
      for (const existing of existingFiles) {
        if (!existingHashesMap.has(existing.fileHash)) {
          existingHashesMap.set(existing.fileHash, existing);
        }
      }

      const jobsToAdd = [];
      for (const file of req.files) {
        const absolutePath = path.resolve(file.path);
        const fileInfo = fileHashMap.get(absolutePath);
        if (!fileInfo) continue;
        if (!fs.existsSync(absolutePath)) continue;
        const existingFile = existingHashesMap.get(fileInfo.hash);
        jobsToAdd.push({
          absolutePath,
          fileInfo,
          isDuplicate: !!existingFile,
          duplicateFileId: existingFile?.id || null
        });
      }

      const importStore = require('../utils/importStore');
      const { registerBatch } = require('../services/batchNotificationService');
      const filePaths = jobsToAdd.map(j => j.absolutePath);
      await importStore.createImport(importId, jobsToAdd.length, filePaths, userId);
      try {
        await registerBatch(importId, jobsToAdd.length, {
          userId,
          userEmail: req.user.email,
          source: 'manual-upload-statement'
        });
      } catch (batchError) {
        console.warn('Failed to register batch:', batchError.message);
      }

      for (const { absolutePath, fileInfo, isDuplicate, duplicateFileId } of jobsToAdd) {
        await invoiceImportQueue.add('invoice-import', {
          filePath: absolutePath,
          fileName: fileInfo.fileName,
          originalName: fileInfo.originalName,
          importId,
          userId,
          source: 'manual-upload',
          fileHash: fileInfo.hash,
          isDuplicate,
          duplicateFileId,
          // Hint downstream parsers that this batch was uploaded via the statement
          // import flow. The job logic still verifies the parsed documentType,
          // but this hint helps when extraction is ambiguous.
          forceDocumentType: 'statement'
        }, {
          priority: 1,
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: true,
          removeOnFail: false
        });
      }

      res.json({
        success: true,
        importId,
        totalFiles: jobsToAdd.length,
        message: `Statement import started. Processing ${jobsToAdd.length} file(s)...`
      });
    } catch (error) {
      console.error('Error starting statement import:', error);
      if (req.files) {
        req.files.forEach(file => {
          if (fs.existsSync(file.path)) {
            try { fs.unlinkSync(file.path); } catch (_) {}
          }
        });
      }
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to start statement import',
        error: error.message
      });
    }
  });

/**
 * Generate statements from an uploaded ACR11P export.
 *
 * Accepts ONE tab-delimited .TXT file containing every customer's open
 * invoices. Parses inline so we know how many customers to fan out to, then
 * registers one batch and enqueues one `statement-generate` job per customer.
 * Each job produces PDF + XLSX, matches the customer to a CORP company, calls
 * `findOrCreateStatement`, and the existing batch notification path picks up
 * from there.
 *
 * Declared before /:id so 'generate' isn't matched as a statement id.
 */
router.post('/generate',
  requirePermission('STATEMENTS_IMPORT'),
  exportUpload.single('file'),
  async (req, res) => {
    let tempFilePath = null;
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'No file uploaded. Please attach the ACR11P export.',
          error: 'No file provided'
        });
      }

      tempFilePath = path.resolve(req.file.path);
      if (!fs.existsSync(tempFilePath)) {
        return res.status(400).json({
          success: false,
          message: 'Uploaded file is missing on disk',
          error: 'File not found after upload'
        });
      }

      const userId = req.user.userId;
      const buffer = fs.readFileSync(tempFilePath);
      const fileHash = crypto.createHash('sha256').update(buffer).digest('hex');

      // Operator escape: when true, the per-customer worker bypasses the
      // content-hash short-circuit AND the manual-upload-is-authoritative
      // suppression in findOrCreateStatement. Use sparingly; the default
      // (false) is the right answer for nightly regenerations.
      const forceOverwrite = req.body.forceOverwrite === 'true'
        || req.body.forceOverwrite === true
        || req.body.forceOverwrite === '1';

      // Decouples "regenerate" from "notify". When true, the worker will
      // regenerate and replace files as normal but NEVER send a customer
      // notification, even for new statements or genuine corrections.
      // Designed for the cutover normalisation case: pair with
      // forceOverwrite=true to migrate every customer onto the new renderer
      // without spamming 379 inboxes about a render-engine swap that didn't
      // change a penny of their balance. Independent of forceOverwrite; can
      // also be used on its own for "review-only" generation cycles.
      const silent = req.body.silent === 'true'
        || req.body.silent === true
        || req.body.silent === '1';

      // Best-effort dedupe against File records, mirroring the /import flow.
      // We don't refuse on duplicate - just surface it - because re-running
      // the same export to regenerate outputs is a legitimate operation.
      let isDuplicate = false;
      let duplicateFileId = null;
      try {
        const existing = await File.findOne({
          where: { fileHash, deletedAt: null },
          attributes: ['id', 'fileName']
        });
        if (existing) {
          isDuplicate = true;
          duplicateFileId = existing.id;
        }
      } catch (dupErr) {
        console.warn('Duplicate check failed (non-fatal):', dupErr.message);
      }

      const { parseExportText } = require('../services/statementGenerator/parse');
      const text = buffer.toString('utf8');
      let parsed;
      try {
        parsed = parseExportText(text);
      } catch (parseErr) {
        return res.status(400).json({
          success: false,
          message: `Failed to parse export: ${parseErr.message}`,
          error: parseErr.message
        });
      }

      const customers = parsed.customerList;
      if (customers.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Export contained no valid customer rows.',
          error: 'No customers parsed',
          validation: parsed.validation
        });
      }

      const importId = uuidv4();
      const statementDateIso = parsed.statementDate; // YYYY-MM-DD

      await logActivity({
        type: ActivityType.FILE_UPLOAD,
        userId,
        userEmail: req.user.email,
        userRole: req.user.role,
        action: (() => {
          const flags = [];
          if (forceOverwrite) flags.push('forceOverwrite');
          if (silent) flags.push('silent');
          const suffix = flags.length ? ` (${flags.join(', ')})` : '';
          return `Uploaded ACR11P export for generation${suffix} (${customers.length} customers)`;
        })(),
        details: {
          importId,
          fileName: req.file.originalname,
          fileHash,
          customerCount: customers.length,
          statementDate: statementDateIso,
          malformedLines: parsed.validation.malformedLines.length,
          unknownTermsCount: parsed.validation.unknownTerms.length,
          uploadMethod: 'manual',
          documentType: 'statement',
          source: 'manual-upload-statement-generate',
          forceOverwrite,
          silent
        },
        companyId: null,
        companyName: null,
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('user-agent')
      });

      const importStore = require('../utils/importStore');
      const { registerBatch } = require('../services/batchNotificationService');

      // One "import session" tracking per-customer results, and one batch for
      // notification fan-out. Both keyed by importId so the existing
      // /import/:importId status + results endpoints work unchanged.
      await importStore.createImport(importId, customers.length, [tempFilePath], userId);
      try {
        await registerBatch(importId, customers.length, {
          userId,
          userEmail: req.user.email,
          source: 'manual-upload-statement-generate'
        });
      } catch (batchError) {
        console.warn('Failed to register batch:', batchError.message);
      }

      // Move the source TXT to processed/statements/YYYY/MM/DD so per-customer
      // jobs all reference the same archived export, not the temp file (which
      // would be tidied up before the slowest job finishes).
      const { PROCESSED_STATEMENTS, getDatedFolder } = require('../config/storage');
      const archiveDate = statementDateIso ? new Date(statementDateIso) : new Date();
      const archiveDir = getDatedFolder(PROCESSED_STATEMENTS, archiveDate);
      const archiveName = `${path.basename(req.file.originalname, path.extname(req.file.originalname))}_${importId}${path.extname(req.file.originalname)}`;
      const archivePath = path.join(archiveDir, archiveName);
      try {
        fs.copyFileSync(tempFilePath, archivePath);
      } catch (copyErr) {
        console.warn(`Could not archive export to ${archivePath}: ${copyErr.message}`);
      }

      const enqueuedAt = new Date().toISOString();
      for (const cust of customers) {
        await statementGenerateQueue.add('statement-generate', {
          importId,
          userId,
          source: 'manual-upload-statement-generate',
          enqueuedAt,
          exportFileHash: fileHash,
          exportFileName: req.file.originalname,
          exportArchivePath: archivePath,
          statementDateIso,
          forceOverwrite,
          silent,
          customer: cust
        }, {
          priority: 1,
          attempts: 2,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: true,
          removeOnFail: false
        });
      }

      // Tidy the temp upload now - we archived it above and the worker uses
      // the in-memory customer payload, not the source file.
      try { fs.unlinkSync(tempFilePath); } catch (_) { /* best effort */ }
      tempFilePath = null;

      res.json({
        success: true,
        importId,
        totalCustomers: customers.length,
        statementDate: statementDateIso,
        validation: {
          parsedLines: parsed.validation.parsedLines,
          malformedLines: parsed.validation.malformedLines.length,
          unknownTerms: parsed.validation.unknownTerms.length
        },
        isDuplicate,
        duplicateFileId,
        forceOverwrite,
        silent,
        message: (() => {
          const flags = [];
          if (forceOverwrite) flags.push('forceOverwrite');
          if (silent) flags.push('silent');
          const suffix = flags.length ? ` (${flags.join(', ')})` : '';
          return `Statement generation queued for ${customers.length} customer(s)${suffix}.`;
        })()
      });
    } catch (error) {
      console.error('Error starting statement generation:', error);
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        try { fs.unlinkSync(tempFilePath); } catch (_) { /* best effort */ }
      }
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to start statement generation',
        error: error.message
      });
    }
  });

// Statement import status (declared before /:id)
router.get('/import/:importId', async (req, res) => {
  try {
    const importStore = require('../utils/importStore');
    const importSession = await importStore.getImport(req.params.importId);
    if (!importSession) {
      return res.status(404).json({ success: false, message: 'Import session not found' });
    }
    res.json({
      success: true,
      import: {
        importId: importSession.importId,
        totalFiles: importSession.totalFiles,
        processedFiles: importSession.processedFiles || 0,
        downloadedFiles: importSession.downloadedFiles || 0,
        currentFile: importSession.currentFile || null,
        status: importSession.status,
        cancelled: importSession.cancelled || false,
        createdAt: importSession.createdAt,
        completedAt: importSession.completedAt
      }
    });
  } catch (error) {
    console.error('Error fetching statement import status:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Statement import results (declared before /:id)
router.get('/import/:importId/results', async (req, res) => {
  try {
    const importStore = require('../utils/importStore');
    const importSession = await importStore.getImport(req.params.importId);
    if (!importSession) {
      return res.status(404).json({ success: false, message: 'Import session not found' });
    }

    const successful = importSession.results.filter(r => r.success).length;
    const failed = importSession.results.filter(r => !r.success).length;
    const matched = importSession.results.filter(r => r.companyId).length;
    const duplicates = importSession.results.filter(r => r.isDuplicate).length;
    const unallocated = importSession.results.filter(r => r.success && !r.companyId && !r.isDuplicate).length;
    const totalProcessingTime = importSession.results.reduce((sum, r) => sum + (r.processingTime || 0), 0);
    const avgProcessingTime = importSession.results.length > 0
      ? totalProcessingTime / importSession.results.length
      : 0;

    res.json({
      success: true,
      import: {
        importId: importSession.importId,
        totalFiles: importSession.totalFiles,
        processedFiles: importSession.processedFiles,
        status: importSession.status,
        createdAt: importSession.createdAt,
        completedAt: importSession.completedAt,
        summary: {
          successful,
          failed,
          matched,
          unallocated,
          duplicates,
          avgProcessingTime: Math.round(avgProcessingTime)
        },
        results: importSession.results
      }
    });
  } catch (error) {
    console.error('Error fetching statement import results:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get single statement
router.get('/:id', async (req, res) => {
  try {
    const statement = await Statement.findByPk(req.params.id, {
      include: [{
        model: Company,
        as: 'company',
        attributes: ['id', 'name', 'referenceNo', 'type', 'globalSystemEmail']
      }]
    });
    
    if (!statement) {
      return res.status(404).json({ message: 'Statement not found' });
    }
    
    // Double-check access to this specific statement's company
    if (req.accessibleCompanyIds !== null && 
        !req.accessibleCompanyIds.includes(statement.companyId)) {
      return res.status(403).json({ 
        message: 'Access denied. You do not have access to this statement.' 
      });
    }
    
    // Only update status if setting allows all users OR user is external_user
    // When setting is enabled, ONLY external users can change status (no exceptions)
    const settings = await Settings.getSettings();
    const canUpdateStatus = !settings.onlyExternalUsersChangeDocumentStatus || req.user.role === 'external_user';
    
    // Mark as viewed if not already
    if (canUpdateStatus && !statement.viewedAt) {
      statement.viewedAt = new Date();
      if (statement.documentStatus === 'ready' || statement.documentStatus === 'review') {
        statement.documentStatus = 'viewed';
      }
      await statement.save();
    }
    
    // Log statement view
    await logActivity({
      type: ActivityType.STATEMENT_VIEWED,
      userId: req.user.userId,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: `Viewed statement ${statement.statementNumber || statement.id}`,
      details: { 
        statementId: statement.id,
        statementNumber: statement.statementNumber,
        companyId: statement.companyId
      },
      companyId: statement.companyId,
      companyName: statement.company?.name || null,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent')
    });
    
    res.json(statement);
  } catch (error) {
    console.error('Error fetching statement:', error);
    res.status(500).json({ message: error.message });
  }
});

// Create statement (permission parity with invoice/credit-note edit/create routes)
router.post('/', requirePermission('STATEMENTS_EDIT'), async (req, res) => {
  try {
    const {
      statementNumber,
      companyId,
      periodStart,
      periodEnd,
      openingBalance,
      closingBalance,
      totalDebits,
      totalCredits,
      transactions,
      status,
      documentStatus,
      notes,
      fileUrl,
      metadata
    } = req.body;
    
    // Validate required fields
    if (!statementNumber || !companyId || !periodStart || !periodEnd) {
      return res.status(400).json({ 
        message: 'statementNumber, companyId, periodStart, and periodEnd are required' 
      });
    }
    
    // Check if statement number already exists
    const existingStatement = await Statement.findOne({
      where: { statementNumber }
    });
    
    if (existingStatement) {
      return res.status(400).json({ message: 'Statement number already exists' });
    }
    
    // Verify company exists
    const company = await Company.findByPk(companyId);
    if (!company) {
      return res.status(400).json({ message: 'Company not found' });
    }
    
    // Get settings for retention calculation
    const settings = await Settings.getSettings();
    
    // Prepare document data for retention calculation
    // For statements, use periodEnd as the invoice date equivalent
    const documentDataForRetention = {
      periodEnd: new Date(periodEnd),
      createdAt: new Date(),
      documentStatus: 'ready'
    };
    
    // Calculate retention dates
    const retentionDates = calculateDocumentRetentionDates(documentDataForRetention, settings);
    
    const statement = await Statement.create({
      statementNumber,
      companyId,
      periodStart,
      periodEnd,
      openingBalance: openingBalance || 0,
      closingBalance: closingBalance || 0,
      totalDebits: totalDebits || 0,
      totalCredits: totalCredits || 0,
      transactions: transactions || [],
      status: status || 'draft',
      notes,
      fileUrl,
      metadata: metadata || {},
      createdById: req.user.userId,
      retentionStartDate: retentionDates.retentionStartDate,
      retentionExpiryDate: retentionDates.retentionExpiryDate
    });
    
    // Reload with company
    await statement.reload({
      include: [{
        model: Company,
        as: 'company',
        attributes: ['id', 'name', 'referenceNo', 'type']
      }]
    });
    
    res.status(201).json(statement);
  } catch (error) {
    console.error('Error creating statement:', error);
    res.status(400).json({ message: error.message });
  }
});

// Update statement (permission parity with invoice/credit-note edit routes)
router.put('/:id', requirePermission('STATEMENTS_EDIT'), async (req, res) => {
  try {
    const statement = await Statement.findByPk(req.params.id);
    
    if (!statement) {
      return res.status(404).json({ message: 'Statement not found' });
    }
    
    // Check access to this statement's company
    if (req.accessibleCompanyIds !== null && 
        !req.accessibleCompanyIds.includes(statement.companyId)) {
      return res.status(403).json({ 
        message: 'Access denied. You do not have access to this statement.' 
      });
    }
    
    const {
      statementNumber,
      companyId,
      periodStart,
      periodEnd,
      openingBalance,
      closingBalance,
      totalDebits,
      totalCredits,
      transactions,
      status,
      notes,
      fileUrl,
      metadata,
      editReason
    } = req.body;
    
    // Track changes to mirror the invoice/credit-note edit-history pattern.
    const changes = {};
    const recordChange = (field, newVal) => {
      if (newVal === undefined) return;
      const oldVal = statement[field];
      const same =
        (oldVal instanceof Date && newVal && new Date(newVal).getTime() === oldVal.getTime()) ||
        oldVal === newVal ||
        (oldVal != null && newVal != null && JSON.stringify(oldVal) === JSON.stringify(newVal));
      if (!same) {
        changes[field] = { from: oldVal, to: newVal };
        statement[field] = newVal;
      }
    };

    if (statementNumber && statementNumber !== statement.statementNumber) {
      // Composite-unique on (companyId, periodEnd) is the primary dedupe key, but we
      // still keep statementNumber human-friendly: warn on re-use within the same company.
      const existingStatement = await Statement.findOne({
        where: { statementNumber, companyId: statement.companyId, id: { [Op.ne]: statement.id } }
      });
      if (existingStatement) {
        return res.status(400).json({ message: 'Statement number already exists for this company' });
      }
    }

    recordChange('statementNumber', statementNumber);
    recordChange('companyId', companyId);
    recordChange('periodStart', periodStart);
    recordChange('periodEnd', periodEnd);
    recordChange('openingBalance', openingBalance);
    recordChange('closingBalance', closingBalance);
    recordChange('totalDebits', totalDebits);
    recordChange('totalCredits', totalCredits);
    recordChange('transactions', transactions);
    recordChange('status', status);
    recordChange('documentStatus', documentStatus);
    recordChange('notes', notes);
    recordChange('fileUrl', fileUrl);
    recordChange('metadata', metadata);

    if (Object.keys(changes).length > 0) {
      if (!editReason || editReason.trim().length === 0) {
        return res.status(400).json({
          message: 'Edit reason is required when making changes to a statement.'
        });
      }
      statement.editedBy = req.user.userId;
      statement.editReason = editReason.trim();
      const editHistory = statement.editHistory || [];
      editHistory.push({
        timestamp: new Date().toISOString(),
        editedBy: req.user.userId,
        editedByName: req.user.name || req.user.email || 'Unknown',
        reason: editReason.trim(),
        changes
      });
      statement.editHistory = editHistory;

      await logActivity({
        type: ActivityType.STATEMENT_EDITED,
        userId: req.user.userId,
        userEmail: req.user.email,
        userRole: req.user.role,
        action: `Edited statement ${statement.statementNumber || statement.id}`,
        details: {
          statementId: statement.id,
          statementNumber: statement.statementNumber,
          changes,
          reason: editReason.trim()
        },
        companyId: statement.companyId,
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('user-agent')
      });
    }

    await statement.save();
    
    // Reload with company
    await statement.reload({
      include: [{
        model: Company,
        as: 'company',
        attributes: ['id', 'name', 'referenceNo', 'type']
      }]
    });
    
    res.json(statement);
  } catch (error) {
    console.error('Error updating statement:', error);
    res.status(400).json({ message: error.message });
  }
});

/**
 * Reset a statement's source authority back to `generated`.
 *
 * Background: when a manual upload corrects a generated statement,
 * findOrCreateStatement stamps `metadata.source = 'manual_upload'`. After
 * that, subsequent generated runs for the same (companyId, periodEnd) are
 * suppressed by the manual-authority rule - which is the right default,
 * because it stops the nightly generator from silently overwriting a fix
 * someone made by hand.
 *
 * If BPCS is later corrected at source, an operator needs a way to release
 * that lock so the next generated run wins. This endpoint provides that
 * release without time-bound automatic unsticking (which the user explicitly
 * declined). It pairs with the `forceOverwrite` flag on /generate, which is
 * the one-shot equivalent; reset-source-to-generated is the permanent flip.
 *
 * Preserves `metadata.contentHash` on purpose. Pair with `forceOverwrite=true`
 * on the next /generate call if you want immediate regeneration regardless of
 * content; otherwise the next run honours the hash compare normally - matching
 * data is a no-op (manual file kept since BPCS agrees with it), differing
 * data is a correction (manual-authority lock now released).
 */
router.post('/:id/reset-source-to-generated', requirePermission('STATEMENTS_EDIT'), async (req, res) => {
  try {
    const statement = await Statement.findByPk(req.params.id, {
      include: [{ model: Company, as: 'company', attributes: ['id', 'name'] }]
    });

    if (!statement) {
      return res.status(404).json({ message: 'Statement not found' });
    }

    if (req.accessibleCompanyIds !== null && !req.accessibleCompanyIds.includes(statement.companyId)) {
      return res.status(403).json({ message: 'Access denied. You do not have access to this statement.' });
    }

    const oldMetadata = statement.metadata || {};
    const oldSource = oldMetadata.source || 'manual_upload';

    // Deliberately PRESERVE metadata.contentHash on reset.
    //
    // If a manual upload had stamped its own content hash, the next generated
    // run would compare cleanly: matching hash -> no-op (manual file kept,
    // operator confirmed no change needed), differing hash -> correction
    // (manual-authority lock now released, BPCS wins).
    //
    // If we instead cleared contentHash here, the next generated run would
    // hit the pure-baseline branch (existingHash == null -> stamp + skip),
    // which would leave the manual file in place forever without ever
    // regenerating. That's the opposite of the operator's intent.
    //
    // If the operator wants IMMEDIATE regeneration regardless of content,
    // that's what the forceOverwrite flag on /generate is for.
    const newMetadata = {
      ...oldMetadata,
      source: 'generated',
      sourceResetAt: new Date().toISOString(),
      sourceResetBy: req.user.userId,
      sourceResetFrom: oldSource
    };

    await statement.update({ metadata: newMetadata });

    await logActivity({
      type: ActivityType.STATEMENT_EDITED,
      userId: req.user.userId,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: `Reset source to generated on statement ${statement.statementNumber || statement.id} (was ${oldSource})`,
      details: {
        statementId: statement.id,
        statementNumber: statement.statementNumber,
        periodEnd: statement.periodEnd,
        previousSource: oldSource,
        newSource: 'generated',
        contentHashPreserved: !!oldMetadata.contentHash
      },
      companyId: statement.companyId,
      companyName: statement.company?.name || null,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent')
    });

    res.json({
      success: true,
      // Spelled out for the admin UI: an operator who clicks "reset" and
      // sees no visible change has the correct outcome - this endpoint only
      // releases the authority lock, it doesn't pull the generated file
      // back on its own. The structured `nextRunBehavior` block is here so
      // the frontend can render it as a callout without parsing prose.
      message: 'Statement source reset to generated. The manual-upload authority lock is released; the next /generate run for this period will compare BPCS content normally.',
      nextRunBehavior: {
        ifContentUnchanged: 'No-op. The existing file stays in place (nothing visible changes). The reset alone does NOT pull the generated version back if BPCS still matches what was previously generated.',
        ifContentDiffers: 'Correction. The generator regenerates files, updates the Statement, and notifies the customer.',
        forImmediateRegeneration: 'Call /api/statements/generate with forceOverwrite=true (and optionally silent=true to suppress the email).'
      },
      statementId: statement.id,
      previousSource: oldSource,
      newSource: 'generated'
    });
  } catch (error) {
    console.error('Error resetting statement source:', error);
    res.status(500).json({ message: error.message });
  }
});

// Delete statement (requires deletion reason for accountability).
router.delete('/:id', requirePermission('STATEMENTS_DELETE'), async (req, res) => {
  try {
    const reason = (req.body?.reason || req.query?.reason || '').toString().trim();
    if (!reason) {
      return res.status(400).json({ message: 'Deletion reason is required for accountability.' });
    }

    const statement = await Statement.findByPk(req.params.id, {
      include: [{ model: Company, as: 'company', attributes: ['id', 'name'] }]
    });

    if (!statement) {
      return res.status(404).json({ message: 'Statement not found' });
    }

    if (req.accessibleCompanyIds !== null && !req.accessibleCompanyIds.includes(statement.companyId)) {
      return res.status(403).json({ message: 'Access denied. You do not have access to this statement.' });
    }

    // Best-effort delete files on disk.
    const filesToRemove = new Set([
      statement.fileUrl,
      statement.pdfFileUrl,
      statement.xlsFileUrl
    ].filter(Boolean));
    for (const stored of filesToRemove) {
      const filePath = resolveStatementFile(stored);
      if (filePath) {
        try {
          fs.unlinkSync(filePath);
          console.log(`🗑️  Deleted statement file: ${filePath}`);
        } catch (fileError) {
          console.error(`⚠️  Failed to delete statement file ${filePath}: ${fileError.message}`);
        }
      }
    }

    const snapshot = {
      id: statement.id,
      statementNumber: statement.statementNumber,
      companyId: statement.companyId,
      companyName: statement.company?.name || null
    };

    await statement.destroy({ force: true });

    await logActivity({
      type: ActivityType.STATEMENT_DELETED,
      userId: req.user.userId,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: `Deleted statement ${snapshot.statementNumber || snapshot.id}`,
      details: { ...snapshot, reason },
      companyId: snapshot.companyId,
      companyName: snapshot.companyName,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent')
    });

    res.json({ message: 'Statement deleted successfully' });
  } catch (error) {
    console.error('Error deleting statement:', error);
    res.status(500).json({ message: error.message });
  }
});

/**
 * Stream the PDF rendition of a statement inline (for in-browser viewing).
 * Reads from pdfFileUrl, falling back to legacy fileUrl when only one file exists.
 */
router.get('/:id/view-pdf', async (req, res) => {
  try {
    const statement = await Statement.findByPk(req.params.id, {
      include: [{ model: Company, as: 'company', attributes: ['id', 'name'] }]
    });

    if (!statement) {
      return res.status(404).json({ message: 'Statement not found' });
    }

    if (req.accessibleCompanyIds !== null && !req.accessibleCompanyIds.includes(statement.companyId)) {
      return res.status(403).json({ message: 'Access denied. You do not have access to this statement.' });
    }

    // Prefer the dedicated PDF slot, fall back to legacy fileUrl when it is a PDF.
    let stored = statement.pdfFileUrl;
    if (!stored && statement.fileUrl && statement.fileUrl.toLowerCase().endsWith('.pdf')) {
      stored = statement.fileUrl;
    }
    if (!stored) {
      return res.status(404).json({ message: 'No PDF file available for this statement' });
    }

    const filePath = resolveStatementFile(stored);
    if (!filePath) {
      console.error(`Statement PDF not found on disk: ${stored}`);
      return res.status(404).json({ message: 'PDF file not found on server' });
    }

    await markStatementAccess(statement, 'view', req);

    await logActivity({
      type: ActivityType.STATEMENT_VIEWED,
      userId: req.user.userId,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: `Viewed statement PDF ${statement.statementNumber || statement.id}`,
      details: {
        statementId: statement.id,
        statementNumber: statement.statementNumber,
        viewMethod: 'pdf_preview'
      },
      companyId: statement.companyId,
      companyName: statement.company?.name || null,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent')
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${path.basename(filePath)}"`);
    res.sendFile(filePath);
  } catch (error) {
    console.error('Error viewing statement PDF:', error);
    res.status(500).json({ message: error.message });
  }
});

/**
 * Stream XLS/XLSX inline for in-browser preview and mark as "viewed"
 * (not downloaded), mirroring PDF preview semantics.
 */
router.get('/:id/view-xls', async (req, res) => {
  try {
    const statement = await Statement.findByPk(req.params.id, {
      include: [{ model: Company, as: 'company', attributes: ['id', 'name'] }]
    });

    if (!statement) return res.status(404).json({ message: 'Statement not found' });
    if (req.accessibleCompanyIds !== null && !req.accessibleCompanyIds.includes(statement.companyId)) {
      return res.status(403).json({ message: 'Access denied. You do not have access to this statement.' });
    }

    let stored = statement.xlsFileUrl;
    if (!stored && statement.fileUrl &&
        (statement.fileUrl.toLowerCase().endsWith('.xls') || statement.fileUrl.toLowerCase().endsWith('.xlsx'))) {
      stored = statement.fileUrl;
    }
    if (!stored) {
      return res.status(404).json({ message: 'No XLS file available for this statement' });
    }

    const filePath = resolveStatementFile(stored);
    if (!filePath) {
      console.error(`Statement XLS not found on disk: ${stored}`);
      return res.status(404).json({ message: 'XLS file not found on server' });
    }

    await markStatementAccess(statement, 'view', req);

    await logActivity({
      type: ActivityType.STATEMENT_VIEWED,
      userId: req.user.userId,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: `Viewed statement XLS ${statement.statementNumber || statement.id}`,
      details: {
        statementId: statement.id,
        statementNumber: statement.statementNumber,
        viewMethod: 'xls_preview'
      },
      companyId: statement.companyId,
      companyName: statement.company?.name || null,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent')
    });

    const ext = path.extname(filePath).toLowerCase();
    const contentType = ext === '.xlsx'
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : 'application/vnd.ms-excel';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${path.basename(filePath)}"`);
    res.sendFile(filePath);
  } catch (error) {
    console.error('Error viewing statement XLS:', error);
    res.status(500).json({ message: error.message });
  }
});

/**
 * Generic single-statement download. Accepts ?format=pdf or ?format=xls; defaults to pdf.
 * Records a download access event.
 */
router.get('/:id/download', async (req, res) => {
  try {
    const format = (req.query.format || 'pdf').toString().toLowerCase();
    const statement = await Statement.findByPk(req.params.id, {
      include: [{ model: Company, as: 'company', attributes: ['id', 'name'] }]
    });

    if (!statement) return res.status(404).json({ message: 'Statement not found' });
    if (req.accessibleCompanyIds !== null && !req.accessibleCompanyIds.includes(statement.companyId)) {
      return res.status(403).json({ message: 'Access denied. You do not have access to this statement.' });
    }

    let stored = null;
    if (format === 'xls' || format === 'xlsx') {
      stored = statement.xlsFileUrl;
      if (!stored && statement.fileUrl &&
          (statement.fileUrl.toLowerCase().endsWith('.xls') || statement.fileUrl.toLowerCase().endsWith('.xlsx'))) {
        stored = statement.fileUrl;
      }
    } else {
      // pdf (default)
      stored = statement.pdfFileUrl;
      if (!stored && statement.fileUrl && statement.fileUrl.toLowerCase().endsWith('.pdf')) {
        stored = statement.fileUrl;
      }
    }

    if (!stored) {
      return res.status(404).json({ message: `No ${format.toUpperCase()} file available for this statement` });
    }

    const filePath = resolveStatementFile(stored);
    if (!filePath) {
      console.error(`Statement ${format} not found on disk: ${stored}`);
      return res.status(404).json({ message: 'File not found on server' });
    }

    await markStatementAccess(statement, 'download', req);

    await logActivity({
      type: ActivityType.STATEMENT_DOWNLOADED,
      userId: req.user.userId,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: `Downloaded statement ${statement.statementNumber || statement.id} (${format})`,
      details: {
        statementId: statement.id,
        statementNumber: statement.statementNumber,
        format
      },
      companyId: statement.companyId,
      companyName: statement.company?.name || null,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent')
    });

    res.download(filePath, path.basename(filePath), (err) => {
      if (err && !res.headersSent) {
        console.error('Error downloading statement file:', err);
        res.status(500).json({ message: 'Error downloading file' });
      }
    });
  } catch (error) {
    console.error('Error downloading statement:', error);
    res.status(500).json({ message: error.message });
  }
});

/**
 * Download the XLS rendition specifically (convenience endpoint mirroring view-pdf).
 * This exists alongside ?format=xls for callers that prefer a distinct URL.
 */
router.get('/:id/download-xls', async (req, res) => {
  try {
    const statement = await Statement.findByPk(req.params.id, {
      include: [{ model: Company, as: 'company', attributes: ['id', 'name'] }]
    });

    if (!statement) return res.status(404).json({ message: 'Statement not found' });
    if (req.accessibleCompanyIds !== null && !req.accessibleCompanyIds.includes(statement.companyId)) {
      return res.status(403).json({ message: 'Access denied. You do not have access to this statement.' });
    }

    let stored = statement.xlsFileUrl;
    if (!stored && statement.fileUrl &&
        (statement.fileUrl.toLowerCase().endsWith('.xls') || statement.fileUrl.toLowerCase().endsWith('.xlsx'))) {
      stored = statement.fileUrl;
    }
    if (!stored) {
      return res.status(404).json({ message: 'No XLS file available for this statement' });
    }

    const filePath = resolveStatementFile(stored);
    if (!filePath) {
      console.error(`Statement XLS not found on disk: ${stored}`);
      return res.status(404).json({ message: 'XLS file not found on server' });
    }

    await markStatementAccess(statement, 'download', req);

    await logActivity({
      type: ActivityType.STATEMENT_DOWNLOADED,
      userId: req.user.userId,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: `Downloaded statement ${statement.statementNumber || statement.id} (xls)`,
      details: {
        statementId: statement.id,
        statementNumber: statement.statementNumber,
        format: 'xls'
      },
      companyId: statement.companyId,
      companyName: statement.company?.name || null,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent')
    });

    res.download(filePath, path.basename(filePath), (err) => {
      if (err && !res.headersSent) {
        console.error('Error downloading statement XLS:', err);
        res.status(500).json({ message: 'Error downloading file' });
      }
    });
  } catch (error) {
    console.error('Error downloading statement XLS:', error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;

