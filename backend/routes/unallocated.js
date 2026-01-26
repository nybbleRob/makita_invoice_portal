const express = require('express');
const { File, Company, User, Invoice, CreditNote, sequelize } = require('../models');
const { Op } = require('sequelize');
const auth = require('../middleware/auth');
const globalAdmin = require('../middleware/globalAdmin');
const { requirePermission, requireManager } = require('../middleware/permissions');
const { fileImportQueue } = require('../config/queue');
const { logActivity, ActivityType } = require('../services/activityLogger');
const fs = require('fs');
const path = require('path');
const { 
  STORAGE_BASE, 
  UNPROCESSED_FAILED, 
  PROCESSED_BASE,
  getProcessedFilePath,
  ensureDir 
} = require('../config/storage');
const router = express.Router();

// Only GA, Admin, Manager can view unallocated (Credit Senior can also reallocate)
router.use(auth);
router.use(requirePermission('UNALLOCATED_VIEW'));

// Diagnostic endpoint to check why files went to unallocated (Global Admin only)
router.get('/diagnostics', globalAdmin, async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const limitNum = parseInt(limit);
    
    // Get recent unallocated files
    const unallocatedFiles = await File.findAll({
      where: {
        status: { [Op.in]: ['unallocated', 'failed', 'duplicate'] },
        deletedAt: null
      },
      order: [['createdAt', 'DESC']],
      limit: limitNum
    });
    
    // Get all companies for comparison
    const allCompanies = await Company.findAll({
      attributes: ['id', 'name', 'referenceNo', 'code'],
      order: [['referenceNo', 'ASC']]
    });
    
    // Analyze each unallocated file
    const diagnostics = await Promise.all(unallocatedFiles.map(async (file) => {
      const parsedData = file.parsedData || {};
      const accountNumber = parsedData.accountNumber || parsedData.account_number || parsedData.accountNo || null;
      
      // Try to find matching company
      let matchedCompany = null;
      let matchAttempts = [];
      
      if (accountNumber) {
        const accountStr = accountNumber.toString().trim();
        const accountStrNormalized = accountStr.replace(/[^\d]/g, ''); // Remove non-digits
        const accountInt = parseInt(accountStrNormalized, 10);
        
        // Try exact integer match
        const companyByRef = allCompanies.find(c => c.referenceNo === accountInt);
        if (companyByRef) {
          matchedCompany = companyByRef;
          matchAttempts.push({ method: 'referenceNo (integer)', matched: true, value: accountInt });
        } else {
          matchAttempts.push({ method: 'referenceNo (integer)', matched: false, value: accountInt });
        }
        
        // Try code match
        const companyByCode = allCompanies.find(c => c.code === accountStr || c.code === accountStrNormalized);
        if (companyByCode && !matchedCompany) {
          matchedCompany = companyByCode;
          matchAttempts.push({ method: 'code', matched: true, value: accountStr });
        } else {
          matchAttempts.push({ method: 'code', matched: false, value: accountStr });
        }
        
        // Try text match on referenceNo
        const companyByText = allCompanies.find(c => c.referenceNo?.toString() === accountStr || c.referenceNo?.toString() === accountStrNormalized);
        if (companyByText && !matchedCompany) {
          matchedCompany = companyByText;
          matchAttempts.push({ method: 'referenceNo (text)', matched: true, value: accountStr });
        } else {
          matchAttempts.push({ method: 'referenceNo (text)', matched: false, value: accountStr });
        }
      }
      
      return {
        fileId: file.id,
        fileName: file.fileName,
        status: file.status,
        failureReason: file.failureReason,
        specificFailureReason: file.metadata?.specificFailureReason || null,
        parsedAccountNumber: accountNumber,
        parsedAccountNumberType: accountNumber ? typeof accountNumber : null,
        matchedCompany: matchedCompany ? {
          id: matchedCompany.id,
          name: matchedCompany.name,
          referenceNo: matchedCompany.referenceNo,
          code: matchedCompany.code
        } : null,
        matchAttempts: matchAttempts,
        parsedDataKeys: Object.keys(parsedData).filter(k => !['templateId', 'templateName', 'fieldLabels', 'fullText', '_metadata'].includes(k)),
        createdAt: file.createdAt
      };
    }));
    
    res.json({
      success: true,
      totalUnallocated: unallocatedFiles.length,
      totalCompanies: allCompanies.length,
      diagnostics: diagnostics,
      allCompanies: allCompanies.map(c => ({
        id: c.id,
        name: c.name,
        referenceNo: c.referenceNo,
        referenceNoType: typeof c.referenceNo,
        code: c.code
      }))
    });
  } catch (error) {
    console.error('Error in unallocated diagnostics:', error);
    res.status(500).json({ message: error.message });
  }
});

// Get all unallocated documents
router.get('/', async (req, res) => {
  try {
    // Only staff, managers, and admins can view unallocated documents
    if (req.user.role === 'external_user') {
      return res.status(403).json({ message: 'Access denied' });
    }

    const { page = 1, limit = 50, search = '', documentNumbers, failureReason, accountNumber, invoiceNumber, date } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    // Include both unallocated and failed documents
    const where = {
      deletedAt: null
    };

    // Filter by failure reason if provided
    if (failureReason && failureReason !== 'all') {
      if (failureReason === 'unallocated') {
        // For unallocated, check both status and failureReason
        where[Op.or] = [
          { status: 'unallocated' },
          { failureReason: 'unallocated' }
        ];
      } else if (failureReason === 'duplicate') {
        // For duplicate, check status
        where.status = 'duplicate';
      } else {
        where.failureReason = failureReason;
        where.status = { [Op.in]: ['unallocated', 'failed', 'duplicate'] };
      }
    } else {
      // No filter - show all unallocated, failed, and duplicate
      where.status = { [Op.in]: ['unallocated', 'failed', 'duplicate'] };
    }

    // Filter by account number (search in parsedData)
    if (accountNumber && accountNumber.trim()) {
      where[Op.and] = where[Op.and] || [];
      where[Op.and].push(
        sequelize.where(
          sequelize.cast(sequelize.col('File.parsedData'), 'text'),
          { [Op.iLike]: `%"accountNumber":"%${accountNumber.trim()}%` }
        )
      );
    }

    // Filter by invoice number (search in parsedData - could be invoiceNumber, documentNumber, creditNumber)
    if (invoiceNumber && invoiceNumber.trim()) {
      where[Op.and] = where[Op.and] || [];
      where[Op.and].push(
        sequelize.where(
          sequelize.cast(sequelize.col('File.parsedData'), 'text'),
          { [Op.or]: [
            { [Op.iLike]: `%"invoiceNumber":"%${invoiceNumber.trim()}%` },
            { [Op.iLike]: `%"documentNumber":"%${invoiceNumber.trim()}%` },
            { [Op.iLike]: `%"creditNumber":"%${invoiceNumber.trim()}%` }
          ]}
        )
      );
    }

    // Filter by date (search in parsedData - could be invoiceDate, date, taxPoint)
    if (date && date.trim()) {
      where[Op.and] = where[Op.and] || [];
      where[Op.and].push(
        sequelize.where(
          sequelize.cast(sequelize.col('File.parsedData'), 'text'),
          { [Op.or]: [
            { [Op.iLike]: `%"invoiceDate":"%${date.trim()}%` },
            { [Op.iLike]: `%"date":"%${date.trim()}%` },
            { [Op.iLike]: `%"taxPoint":"%${date.trim()}%` }
          ]}
        )
      );
    }

    // Handle comma-separated document numbers (exact match) - takes priority over regular search
    if (documentNumbers) {
      const numbers = documentNumbers.split(',').map(n => n.trim()).filter(n => n);
      console.log('🔍 [Unallocated] Searching for document numbers:', numbers);
      if (numbers.length > 0) {
        // Search for any of the document numbers in parsedData (invoiceNumber, documentNumber, creditNumber)
        where[Op.and] = where[Op.and] || [];
        where[Op.and].push({
          [Op.or]: numbers.flatMap(num => [
            sequelize.where(
              sequelize.cast(sequelize.col('File.parsedData'), 'text'),
              { [Op.iLike]: `%"invoiceNumber":"${num}"%` }
            ),
            sequelize.where(
              sequelize.cast(sequelize.col('File.parsedData'), 'text'),
              { [Op.iLike]: `%"documentNumber":"${num}"%` }
            ),
            sequelize.where(
              sequelize.cast(sequelize.col('File.parsedData'), 'text'),
              { [Op.iLike]: `%"creditNumber":"${num}"%` }
            )
          ])
        });
      }
    }
    // Otherwise use regular search (partial match)
    else if (search) {
      const searchConditions = [
        { fileName: { [Op.iLike]: `%${search}%` } },
        { errorMessage: { [Op.iLike]: `%${search}%` } },
        sequelize.where(
          sequelize.cast(sequelize.col('File.parsedData'), 'text'),
          { [Op.iLike]: `%${search}%` }
        )
      ];
      
      // Combine search with existing conditions
      if (where[Op.or]) {
        // We have a failureReason filter with Op.or, need to combine properly
        where[Op.and] = where[Op.and] || [];
        where[Op.and].push({ [Op.or]: where[Op.or] });
        where[Op.and].push({ [Op.or]: searchConditions });
        delete where[Op.or];
      } else {
        where[Op.and] = where[Op.and] || [];
        where[Op.and].push({ [Op.or]: searchConditions });
      }
    }

    const { count, rows } = await File.findAndCountAll({
      where,
      include: [
        {
          model: User,
          as: 'uploadedBy',
          attributes: ['id', 'name', 'email'],
          required: false
        },
        {
          model: User,
          as: 'manuallyEditedBy',
          attributes: ['id', 'name', 'email'],
          required: false
        }
      ],
      order: [['uploadedAt', 'DESC']],
      limit: limitNum,
      offset: offset
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
    console.error('Error fetching unallocated documents:', error);
    res.status(500).json({ message: error.message });
  }
});

// Get single unallocated document
router.get('/:id', async (req, res) => {
  try {
    if (req.user.role === 'external_user') {
      return res.status(403).json({ message: 'Access denied' });
    }

    const file = await File.findByPk(req.params.id, {
      include: [
        {
          model: User,
          as: 'uploadedBy',
          attributes: ['id', 'name', 'email'],
          required: false
        },
        {
          model: User,
          as: 'manuallyEditedBy',
          attributes: ['id', 'name', 'email'],
          required: false
        }
      ]
    });

    if (!file) {
      return res.status(404).json({ message: 'Document not found' });
    }

    if (file.status !== 'unallocated' && file.status !== 'failed') {
      return res.status(400).json({ message: 'Document is not unallocated or failed' });
    }

    res.json(file);
  } catch (error) {
    console.error('Error fetching unallocated document:', error);
    res.status(500).json({ message: error.message });
  }
});

// View unallocated document PDF (view only, no download)
router.get('/:id/view-pdf', async (req, res) => {
  try {
    if (req.user.role === 'external_user') {
      return res.status(403).json({ message: 'Access denied' });
    }

    const file = await File.findByPk(req.params.id);

    if (!file) {
      return res.status(404).json({ message: 'Document not found' });
    }

    if (file.status !== 'unallocated' && file.status !== 'failed' && file.status !== 'duplicate') {
      return res.status(400).json({ message: 'Document is not unallocated, failed, or duplicate' });
    }

    if (!file.filePath) {
      return res.status(404).json({ message: 'No document file available' });
    }

    // Handle both absolute and relative paths
    let filePath;
    if (path.isAbsolute(file.filePath)) {
      filePath = file.filePath;
    } else {
      filePath = path.join(__dirname, '..', file.filePath);
      if (!fs.existsSync(filePath)) {
        filePath = file.filePath;
      }
    }

    if (!fs.existsSync(filePath)) {
      console.error(`File not found: ${filePath} (original: ${file.filePath})`);
      return res.status(404).json({ message: 'Document file not found on server' });
    }

    // Serve PDF with inline content-disposition (view only, no download)
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${file.fileName}"`);
    res.sendFile(filePath);
  } catch (error) {
    console.error('Error viewing unallocated document PDF:', error);
    res.status(500).json({ message: error.message });
  }
});

// Update parsed data and requeue for processing - GA + Admin + Manager + Credit Senior
router.put('/:id', requirePermission('UNALLOCATED_REALLOCATE'), async (req, res) => {
  try {
    const file = await File.findByPk(req.params.id);
    if (!file) {
      return res.status(404).json({ message: 'Document not found' });
    }

    // Allow requeueing if status is unallocated, failed, or duplicate
    if (!['unallocated', 'failed', 'duplicate'].includes(file.status)) {
      return res.status(400).json({ 
        message: `Document status is "${file.status}". Only unallocated, failed, or duplicate documents can be requeued.` 
      });
    }

    const { parsedData, accountNumber, companyId } = req.body;
    const oldParsedData = JSON.parse(JSON.stringify(file.parsedData || {}));

    // Track what changed
    const changes = {};
    if (parsedData) {
      Object.keys(parsedData).forEach(key => {
        if (JSON.stringify(oldParsedData[key]) !== JSON.stringify(parsedData[key])) {
          changes[key] = {
            from: oldParsedData[key],
            to: parsedData[key]
          };
        }
      });
    }

    // Update parsed data
    if (parsedData) {
      file.parsedData = { ...oldParsedData, ...parsedData };
    }

    // Update account number in parsed data if provided
    if (accountNumber !== undefined) {
      file.parsedData = file.parsedData || {};
      file.parsedData.accountNumber = accountNumber;
    }

    // If companyId is provided, assign it
    if (companyId) {
      const company = await Company.findByPk(companyId);
      if (!company) {
        return res.status(400).json({ message: 'Company not found' });
      }
      // Set customerId on file (File model uses customerId to reference Company)
      file.customerId = companyId;
      // Also update accountNumber in parsedData to match company's referenceNo
      if (company.referenceNo) {
        file.parsedData = file.parsedData || {};
        file.parsedData.accountNumber = company.referenceNo.toString();
      }
    }

    // Add edit log entry
    const editLog = file.editLog || [];
    editLog.push({
      editedBy: req.user.userId,
      editedByName: req.user.name || req.user.email,
      editedAt: new Date().toISOString(),
      changes: changes,
      accountNumber: accountNumber !== undefined ? { from: oldParsedData.accountNumber, to: accountNumber } : undefined
    });

    file.editLog = editLog;
    file.manuallyEditedById = req.user.userId;
    file.status = 'pending'; // Reset to pending for reprocessing
    file.failureReason = null;

    await file.save();

    // Log unallocated file edit
    await logActivity({
      type: ActivityType.UNALLOCATED_EDITED,
      userId: req.user.userId,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: `Edited unallocated file ${file.fileName}`,
      details: { 
        fileId: file.id,
        fileName: file.fileName,
        changes: changes,
        accountNumber: accountNumber !== undefined ? { from: oldParsedData.accountNumber, to: accountNumber } : undefined,
        companyId: companyId || null,
        reason: 'Amending parsing issues for reprocessing'
      },
      companyId: companyId || null,
      companyName: companyId ? (await Company.findByPk(companyId))?.name : null,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent')
    });

    // Requeue for processing using invoiceImportQueue
    // The file is already on the server, so we use the filePath from the database
    const { invoiceImportQueue } = require('../config/queue');
    const path = require('path');
    
    if (invoiceImportQueue) {
      // Get absolute path to the file (filePath is relative to project root)
      const absoluteFilePath = path.isAbsolute(file.filePath) 
        ? file.filePath 
        : path.join(__dirname, '..', file.filePath);
      
      // Verify file exists before requeueing
      const fs = require('fs');
      if (!fs.existsSync(absoluteFilePath)) {
        return res.status(400).json({ 
          message: `File not found at: ${absoluteFilePath}. Cannot requeue.` 
        });
      }
      
      await invoiceImportQueue.add('invoice-import', {
        filePath: absoluteFilePath, // Absolute path to file on server
        fileName: file.fileName,
        originalName: file.fileName,
        importId: `requeue-${Date.now()}-${file.id}`,
        userId: req.user.userId,
        manuallyEdited: true,
        fileId: file.id // Include file ID for tracking
      }, {
        priority: 1, // Higher priority for manually edited files
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000
        }
      });
      
      console.log(`🔄 Requeued file ${file.id} (${file.fileName}) for reprocessing`);
    } else {
      console.warn('⚠️  Invoice import queue not available - cannot requeue file');
      return res.status(500).json({ message: 'Queue system not available. Cannot requeue file.' });
    }

    res.json({
      message: 'Document updated and queued for reprocessing',
      file: file.toJSON()
    });
  } catch (error) {
    console.error('Error updating unallocated document:', error);
    res.status(500).json({ message: error.message });
  }
});

// Bulk delete unallocated documents - GA + Admin + Manager only
// IMPORTANT: This route must be defined BEFORE /:id to avoid route conflicts
router.delete('/bulk', requirePermission('UNALLOCATED_DELETE'), async (req, res) => {
  try {
    const { fileIds, reason } = req.body;

    if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0) {
      return res.status(400).json({ message: 'fileIds array is required' });
    }

    if (!reason || !reason.trim()) {
      return res.status(400).json({ message: 'Deletion reason is required for accountability' });
    }

    const deletionReason = reason.trim();
    console.log(`🗑️  [Bulk Delete] User ${req.user.email} deleting ${fileIds.length} file(s). Reason: ${deletionReason}`);

    // Fetch all files to be deleted
    const files = await File.findAll({
      where: {
        id: { [Op.in]: fileIds },
        deletedAt: null
      }
    });

    if (files.length === 0) {
      return res.status(404).json({ message: 'No files found to delete' });
    }

    const deletedFiles = [];
    const fileErrors = [];
    const dbErrors = [];

    // Process each file
    for (const file of files) {
      try {
        // 1. Delete associated Invoice or CreditNote if they reference this file
        if (file.filePath) {
          // Find invoices/credit notes that reference this file path
          const invoices = await Invoice.findAll({
            where: {
              fileUrl: { [Op.like]: `%${file.filePath}%` }
            }
          });

          const creditNotes = await CreditNote.findAll({
            where: {
              fileUrl: { [Op.like]: `%${file.filePath}%` }
            }
          });

          // Delete associated invoices
          for (const invoice of invoices) {
            await invoice.destroy({ force: true });
            console.log(`   ✅ Deleted associated invoice: ${invoice.id}`);
          }

          // Delete associated credit notes
          for (const creditNote of creditNotes) {
            await creditNote.destroy({ force: true });
            console.log(`   ✅ Deleted associated credit note: ${creditNote.id}`);
          }
        }

        // 2. Delete the physical file from disk
        if (file.filePath) {
          // filePath might be relative or absolute
          let filePathToDelete;
          
          // If it starts with /, it's relative to STORAGE_BASE
          if (file.filePath.startsWith('/')) {
            // Remove leading slash and join with STORAGE_BASE
            filePathToDelete = path.join(STORAGE_BASE, file.filePath.substring(1));
          } else if (path.isAbsolute(file.filePath)) {
            // Already absolute
            filePathToDelete = file.filePath;
          } else {
            // Relative path, join with STORAGE_BASE
            filePathToDelete = path.join(STORAGE_BASE, file.filePath);
          }

          // Normalize path separators
          filePathToDelete = path.normalize(filePathToDelete);

          if (fs.existsSync(filePathToDelete)) {
            try {
              fs.unlinkSync(filePathToDelete);
              console.log(`   ✅ Deleted file from disk: ${filePathToDelete}`);
            } catch (unlinkError) {
              console.error(`   ⚠️  Error deleting file from disk: ${filePathToDelete}`, unlinkError.message);
              fileErrors.push({ fileId: file.id, fileName: file.fileName, error: `File deletion failed: ${unlinkError.message}` });
            }
          } else {
            console.log(`   ⚠️  File not found on disk (may have been deleted already): ${filePathToDelete}`);
          }
        }

        // 3. Store deletion reason in metadata before deletion
        const metadata = file.metadata || {};
        metadata.deletedReason = deletionReason;
        metadata.deletedBy = req.user.userId;
        metadata.deletedByEmail = req.user.email;
        metadata.deletedByName = req.user.name || req.user.email;
        metadata.deletedAt = new Date().toISOString();
        file.metadata = metadata;
        await file.save();

        // 4. Log deletion activity for each file
        await logActivity({
          type: ActivityType.UNALLOCATED_DELETED,
          userId: req.user.userId,
          userEmail: req.user.email,
          userRole: req.user.role,
          action: `Deleted unallocated file ${file.fileName}`,
          details: { 
            fileId: file.id,
            fileName: file.fileName,
            filePath: file.filePath,
            status: file.status,
            failureReason: file.failureReason,
            deletionReason: deletionReason
          },
          companyId: null,
          companyName: null,
          ipAddress: req.ip || req.connection.remoteAddress,
          userAgent: req.get('user-agent')
        });

        // 5. Delete the File record from database (hard delete)
        // Soft delete from database (preserve hash for duplicate detection)
        file.deletedAt = new Date();
        await file.save();
        deletedFiles.push(file.id);
        console.log(`   ✅ Soft deleted file record (hash preserved): ${file.id} (${file.fileName})`);

      } catch (error) {
        console.error(`   ❌ Error deleting file ${file.id}:`, error.message);
        dbErrors.push({ fileId: file.id, fileName: file.fileName, error: error.message });
      }
    }

    const successCount = deletedFiles.length;
    const totalErrors = fileErrors.length + dbErrors.length;

    // Log bulk deletion activity
    if (successCount > 0) {
      await logActivity({
        type: ActivityType.UNALLOCATED_BULK_DELETE,
        userId: req.user.userId,
        userEmail: req.user.email,
        userRole: req.user.role,
        action: `Bulk deleted ${successCount} unallocated file(s)`,
        details: { 
          fileCount: successCount,
          totalRequested: fileIds.length,
          deletedFileIds: deletedFiles,
          deletionReason: deletionReason,
          errors: totalErrors,
          fileErrors: fileErrors.length > 0 ? fileErrors : undefined,
          dbErrors: dbErrors.length > 0 ? dbErrors : undefined
        },
        companyId: null,
        companyName: null,
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('user-agent')
      });
    }

    res.json({
      success: true,
      message: `Deleted ${successCount} file(s)${totalErrors > 0 ? `, ${totalErrors} error(s)` : ''}`,
      deleted: successCount,
      errors: totalErrors,
      fileErrors,
      dbErrors
    });

  } catch (error) {
    console.error('Error bulk deleting unallocated documents:', error);
    res.status(500).json({ message: error.message });
  }
});

// Clear all unallocated documents - GA + Admin only
// IMPORTANT: This route must be defined BEFORE /:id to avoid route conflicts
router.delete('/clear-all', requirePermission('UNALLOCATED_DELETE'), async (req, res) => {
  try {
    const { reason } = req.body;

    if (!reason || !reason.trim()) {
      return res.status(400).json({ message: 'Deletion reason is required for accountability' });
    }

    const deletionReason = reason.trim();
    console.log(`🗑️  [Clear All] User ${req.user.email} clearing all unallocated documents. Reason: ${deletionReason}`);

    // Find all unallocated, failed, and duplicate files
    const files = await File.findAll({
      where: {
        status: { [Op.in]: ['unallocated', 'failed', 'duplicate'] },
        deletedAt: null
      }
    });

    if (files.length === 0) {
      return res.json({
        success: true,
        message: 'No unallocated documents found to delete',
        deleted: 0
      });
    }

    const deletedFiles = [];
    const fileErrors = [];
    const dbErrors = [];

    // Process each file
    for (const file of files) {
      try {
        // 1. Delete associated Invoice or CreditNote if they reference this file
        if (file.filePath) {
          // Find invoices/credit notes that reference this file path
          const invoices = await Invoice.findAll({
            where: {
              fileUrl: { [Op.like]: `%${file.filePath}%` }
            }
          });

          const creditNotes = await CreditNote.findAll({
            where: {
              fileUrl: { [Op.like]: `%${file.filePath}%` }
            }
          });

          // Delete associated invoices
          for (const invoice of invoices) {
            await invoice.destroy({ force: true });
            console.log(`   ✅ Deleted associated invoice: ${invoice.id}`);
          }

          // Delete associated credit notes
          for (const creditNote of creditNotes) {
            await creditNote.destroy({ force: true });
            console.log(`   ✅ Deleted associated credit note: ${creditNote.id}`);
          }
        }

        // 2. Delete the physical file from disk
        if (file.filePath && fs.existsSync(file.filePath)) {
          try {
            fs.unlinkSync(file.filePath);
            console.log(`   ✅ Deleted file: ${file.filePath}`);
          } catch (fileError) {
            console.error(`   ⚠️  Failed to delete file ${file.filePath}:`, fileError.message);
            fileErrors.push({
              fileId: file.id,
              fileName: file.fileName,
              error: fileError.message
            });
          }
        }

        // 3. Store deletion reason in metadata before deletion
        const metadata = file.metadata || {};
        metadata.deletedReason = deletionReason;
        metadata.deletedBy = req.user.userId;
        metadata.deletedByEmail = req.user.email;
        metadata.deletedByName = req.user.name || req.user.email;
        metadata.deletedAt = new Date().toISOString();
        file.metadata = metadata;
        await file.save();

        // 4. Log deletion activity for each file
        await logActivity({
          type: ActivityType.UNALLOCATED_DELETED,
          userId: req.user.userId,
          userEmail: req.user.email,
          userRole: req.user.role,
          action: `Cleared unallocated file ${file.fileName} (Clear All)`,
          details: {
            fileId: file.id,
            fileName: file.fileName,
            filePath: file.filePath,
            status: file.status,
            failureReason: file.failureReason,
            deletionReason: deletionReason,
            clearAll: true
          },
          companyId: null,
          companyName: null,
          ipAddress: req.ip || req.connection.remoteAddress,
          userAgent: req.get('user-agent')
        });

        // 5. Soft delete from database (preserve hash for duplicate detection)
        // Set deletedAt to mark as deleted, but keep the record for hash tracking
        file.deletedAt = new Date();
        await file.save();
        deletedFiles.push(file.id);
      } catch (error) {
        console.error(`❌ Error deleting file ${file.id}:`, error.message);
        dbErrors.push({
          fileId: file.id,
          fileName: file.fileName,
          error: error.message
        });
      }
    }

    const successCount = deletedFiles.length;
    const totalErrors = fileErrors.length + dbErrors.length;

    // Log bulk deletion activity
    if (successCount > 0) {
      await logActivity({
        type: ActivityType.UNALLOCATED_BULK_DELETE,
        userId: req.user.userId,
        userEmail: req.user.email,
        userRole: req.user.role,
        action: `Cleared all unallocated documents (${successCount} file(s))`,
        details: { 
          fileCount: successCount,
          totalRequested: files.length,
          deletedFileIds: deletedFiles,
          deletionReason: deletionReason,
          errors: totalErrors,
          fileErrors: fileErrors.length > 0 ? fileErrors : undefined,
          dbErrors: dbErrors.length > 0 ? dbErrors : undefined,
          clearAll: true
        },
        companyId: null,
        companyName: null,
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('user-agent')
      });
    }

    console.log(`\n📊 Clear All Summary:`);
    console.log(`   ✅ Successfully deleted: ${successCount} file(s)`);
    console.log(`   ❌ Failed: ${totalErrors} file(s)`);
    console.log(`   👤 Cleared by: ${req.user.email}`);
    console.log(`   📝 Reason: ${deletionReason}\n`);

    res.json({
      success: true,
      message: `Cleared ${successCount} unallocated document(s)${totalErrors > 0 ? `, ${totalErrors} error(s)` : ''}`,
      deleted: successCount,
      errors: totalErrors,
      fileErrors,
      dbErrors
    });

  } catch (error) {
    console.error('Error clearing all unallocated documents:', error);
    res.status(500).json({ message: error.message });
  }
});

// Delete single unallocated document - GA + Admin + Manager only
router.delete('/:id', requirePermission('UNALLOCATED_DELETE'), async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason || !reason.trim()) {
      return res.status(400).json({ message: 'Deletion reason is required for accountability' });
    }

    const file = await File.findByPk(req.params.id);
    if (!file) {
      return res.status(404).json({ message: 'Document not found' });
    }

    // Only allow deletion of unallocated, failed, or duplicate files
    if (!['unallocated', 'failed', 'duplicate'].includes(file.status)) {
      return res.status(400).json({ message: `Cannot delete document with status "${file.status}". Only unallocated, failed, or duplicate documents can be deleted.` });
    }

    const deletionReason = reason.trim();
    const deletedBy = req.user.userId;
    const deletedAt = new Date();

    try {
      // 1. Delete associated Invoice or CreditNote if they reference this file
      if (file.filePath) {
        const invoices = await Invoice.findAll({ where: { fileUrl: { [Op.like]: `%${file.filePath}%` } } });
        for (const invoice of invoices) {
          await invoice.destroy({ force: true });
        }

        const creditNotes = await CreditNote.findAll({ where: { fileUrl: { [Op.like]: `%${file.filePath}%` } } });
        for (const creditNote of creditNotes) {
          await creditNote.destroy({ force: true });
        }
      }

      // 2. Delete the physical file from disk
      if (file.filePath) {
        const filePath = path.isAbsolute(file.filePath) ? file.filePath : path.join(STORAGE_BASE, file.filePath.replace(/^\//, ''));
        if (fs.existsSync(filePath)) {
          try {
            fs.unlinkSync(filePath);
          } catch (fileError) {
            console.error(`Failed to delete file ${filePath}:`, fileError.message);
          }
        }
      }

      // 3. Store deletion reason in metadata before deletion
      const metadata = file.metadata || {};
      metadata.deletedReason = deletionReason;
      metadata.deletedBy = deletedBy;
      metadata.deletedByEmail = req.user.email;
      metadata.deletedByName = req.user.name || req.user.email;
      metadata.deletedAt = deletedAt.toISOString();
      file.metadata = metadata;
      await file.save();

      // 4. Log deletion activity
      await logActivity({
        type: ActivityType.UNALLOCATED_DELETED,
        userId: req.user.userId,
        userEmail: req.user.email,
        userRole: req.user.role,
        action: `Deleted unallocated file ${file.fileName}`,
        details: { fileId: file.id, fileName: file.fileName, deletionReason: deletionReason },
        companyId: null, companyName: null, ipAddress: req.ip, userAgent: req.get('user-agent')
      });

      // 5. Soft delete from database (preserve hash for duplicate detection)
      // Set deletedAt to mark as deleted, but keep the record for hash tracking
      file.deletedAt = new Date();
      await file.save();

      res.json({
        success: true,
        message: 'Document deleted successfully'
      });
    } catch (error) {
      console.error('Error deleting document:', error);
      res.status(500).json({ message: error.message });
    }
  } catch (error) {
    console.error('Error deleting document:', error);
    res.status(500).json({ message: error.message });
  }
});

// POST /api/unallocated/:id/attempt-allocation - Re-attempt to allocate an unallocated document
router.post('/:id/attempt-allocation', async (req, res) => {
  try {
    const file = await File.findOne({
      where: { 
        id: req.params.id,
        status: { [Op.in]: ['unallocated', 'failed'] },
        deletedAt: null
      }
    });

    if (!file) {
      return res.status(404).json({ message: 'Unallocated document not found' });
    }

    const parsedData = file.parsedData || {};
    
    // Extract account number from parsed data
    const accountNumber = parsedData.accountNumber || parsedData.customerNumber || 
                         parsedData.account_no || parsedData.accountNo || 
                         parsedData.customer_number || null;
    
    if (!accountNumber) {
      return res.status(400).json({ 
        success: false,
        message: 'No account number found in parsed data. Please edit the document to add an account number first.',
        parsedFields: Object.keys(parsedData)
      });
    }

    // Try to match to a company
    const accountStr = accountNumber.toString().trim();
    const accountStrNormalized = accountStr.replace(/[^\d]/g, '');
    const accountInt = parseInt(accountStrNormalized, 10);

    let matchedCompany = null;

    // Try referenceNo (integer) match first
    if (!isNaN(accountInt)) {
      matchedCompany = await Company.findOne({
        where: { referenceNo: accountInt, isActive: true }
      });
    }

    // Try code match
    if (!matchedCompany) {
      matchedCompany = await Company.findOne({
        where: { 
          code: { [Op.in]: [accountStr, accountStrNormalized] },
          isActive: true
        }
      });
    }

    if (!matchedCompany) {
      return res.status(400).json({ 
        success: false,
        message: `No matching company found for account number: ${accountNumber}. Please create the company first or verify the account number.`,
        searchedValues: { original: accountNumber, normalized: accountStrNormalized, asInteger: accountInt }
      });
    }

    // Determine document type
    const docType = (parsedData.documentType || '').toLowerCase();
    const isCredit = docType.includes('credit') || docType === 'credit_note' || docType === 'creditnote';
    const isInvoice = !isCredit;

    // Parse date
    const dateValue = parsedData.invoiceDate || parsedData.date || parsedData.taxPoint || new Date().toISOString();
    let issueDate;
    try {
      if (typeof dateValue === 'string') {
        // Handle DD/MM/YYYY format
        const ddmmyyyy = dateValue.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
        if (ddmmyyyy) {
          issueDate = new Date(parseInt(ddmmyyyy[3]), parseInt(ddmmyyyy[2]) - 1, parseInt(ddmmyyyy[1]));
        } else {
          issueDate = new Date(dateValue);
        }
      } else {
        issueDate = new Date(dateValue);
      }
      if (isNaN(issueDate.getTime())) {
        issueDate = new Date();
      }
    } catch (e) {
      issueDate = new Date();
    }

    // Parse amount
    const amountValue = parsedData.totalAmount || parsedData.amount || parsedData.invoiceTotal || 0;
    let amount = 0;
    if (typeof amountValue === 'string') {
      amount = parseFloat(amountValue.replace(/[^0-9.-]/g, '')) || 0;
    } else if (typeof amountValue === 'number') {
      amount = amountValue;
    }

    // Parse VAT amount
    const vatValue = parsedData.vatAmount || parsedData.vatTotal || 0;
    let vatAmount = 0;
    if (typeof vatValue === 'string') {
      vatAmount = parseFloat(vatValue.replace(/[^0-9.-]/g, '')) || 0;
    } else if (typeof vatValue === 'number') {
      vatAmount = vatValue;
    }

    let document = null;

    // Create invoice or credit note
    if (isInvoice) {
      const invoiceNumber = parsedData.invoiceNumber || parsedData.documentNumber || 
                           `INV-${Date.now()}-${file.fileHash?.substring(0, 8) || 'ALLOC'}`;

      // Check for duplicate invoice number
      const existingInvoice = await Invoice.findOne({
        where: { 
          companyId: matchedCompany.id,
          invoiceNumber: invoiceNumber,
          deletedAt: null
        }
      });

      if (existingInvoice) {
        return res.status(400).json({
          success: false,
          message: `Invoice ${invoiceNumber} already exists for company ${matchedCompany.name}`,
          existingInvoiceId: existingInvoice.id
        });
      }

      document = await Invoice.create({
        companyId: matchedCompany.id,
        invoiceNumber: invoiceNumber,
        issueDate: issueDate,
        amount: amount,
        taxAmount: vatAmount,
        documentStatus: 'ready',
        status: 'ready',
        viewedAt: null,
        fileUrl: file.filePath,
        uploadedById: req.user.userId,
        metadata: {
          allocatedFrom: 'unallocated',
          allocatedAt: new Date().toISOString(),
          allocatedBy: req.user.email,
          originalFileId: file.id,
          parsedData: parsedData
        }
      });

      console.log(`✅ Created invoice ${invoiceNumber} for company ${matchedCompany.name} from unallocated file ${file.id}`);
    } else {
      const creditNoteNumber = parsedData.creditNumber || parsedData.creditNoteNumber || 
                               parsedData.documentNumber || `CN-${Date.now()}-${file.fileHash?.substring(0, 8) || 'ALLOC'}`;

      // Check for duplicate credit note number
      const existingCreditNote = await CreditNote.findOne({
        where: { 
          companyId: matchedCompany.id,
          creditNoteNumber: creditNoteNumber,
          deletedAt: null
        }
      });

      if (existingCreditNote) {
        return res.status(400).json({
          success: false,
          message: `Credit Note ${creditNoteNumber} already exists for company ${matchedCompany.name}`,
          existingCreditNoteId: existingCreditNote.id
        });
      }

      document = await CreditNote.create({
        companyId: matchedCompany.id,
        creditNoteNumber: creditNoteNumber,
        issueDate: issueDate,
        amount: amount,
        taxAmount: vatAmount,
        documentStatus: 'ready',
        status: 'ready',
        viewedAt: null,
        fileUrl: file.filePath,
        uploadedById: req.user.userId,
        metadata: {
          allocatedFrom: 'unallocated',
          allocatedAt: new Date().toISOString(),
          allocatedBy: req.user.email,
          originalFileId: file.id,
          parsedData: parsedData
        }
      });

      console.log(`✅ Created credit note ${creditNoteNumber} for company ${matchedCompany.name} from unallocated file ${file.id}`);
    }

    // Move file from unprocessed to processed folder
    const oldFilePath = file.filePath;
    let newFilePath = oldFilePath;
    
    if (oldFilePath && fs.existsSync(oldFilePath)) {
      try {
        // Determine document type folder
        const docTypeFolder = isInvoice ? 'invoices' : 'creditnotes';
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        
        // Build new path: /mnt/data/processed/{docType}/YYYY/MM/DD/filename
        const processedDir = path.join(PROCESSED_BASE, docTypeFolder, String(year), month, day);
        ensureDir(processedDir);
        
        const fileName = path.basename(oldFilePath);
        newFilePath = path.join(processedDir, fileName);
        
        // Handle filename conflicts
        let counter = 1;
        while (fs.existsSync(newFilePath)) {
          const ext = path.extname(fileName);
          const base = path.basename(fileName, ext);
          newFilePath = path.join(processedDir, `${base}_${counter}${ext}`);
          counter++;
        }
        
        // Move the file
        fs.renameSync(oldFilePath, newFilePath);
        console.log(`📁 Moved file from ${oldFilePath} to ${newFilePath}`);
        
        // Update document's fileUrl
        document.fileUrl = newFilePath;
        await document.save();
      } catch (moveError) {
        console.error(`⚠️ Failed to move file: ${moveError.message}`);
        // Continue with allocation even if move fails
      }
    }

    // Update file status to allocated
    file.status = 'parsed';
    file.companyId = matchedCompany.id;
    file.filePath = newFilePath; // Update to new path
    file.failureReason = null;
    const metadata = file.metadata || {};
    metadata.allocatedAt = new Date().toISOString();
    metadata.allocatedBy = req.user.email;
    metadata.allocatedDocumentId = document.id;
    metadata.allocatedDocumentType = isInvoice ? 'invoice' : 'credit_note';
    metadata.previousFilePath = oldFilePath; // Keep track of old path
    file.metadata = metadata;
    await file.save();

    // Log activity
    await logActivity({
      type: ActivityType.UNALLOCATED_ALLOCATED,
      userId: req.user.userId,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: `Allocated unallocated file ${file.fileName} to ${matchedCompany.name}`,
      details: { 
        fileId: file.id, 
        fileName: file.fileName, 
        companyId: matchedCompany.id,
        companyName: matchedCompany.name,
        documentType: isInvoice ? 'invoice' : 'credit_note',
        documentId: document.id,
        documentNumber: isInvoice ? document.invoiceNumber : document.creditNoteNumber
      },
      companyId: matchedCompany.id,
      companyName: matchedCompany.name,
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    res.json({
      success: true,
      message: `Successfully allocated to ${matchedCompany.name}`,
      company: {
        id: matchedCompany.id,
        name: matchedCompany.name,
        referenceNo: matchedCompany.referenceNo
      },
      document: {
        id: document.id,
        type: isInvoice ? 'invoice' : 'credit_note',
        number: isInvoice ? document.invoiceNumber : document.creditNoteNumber
      }
    });

  } catch (error) {
    console.error('Error attempting allocation:', error);
    res.status(500).json({ message: error.message });
  }
});

// ============================================================================
// BULK ALLOCATION ENDPOINTS
// ============================================================================

const allocationStore = require('../utils/allocationStore');

/**
 * Helper function to attempt allocation for a single file
 * Reuses the logic from POST /:id/attempt-allocation
 * Returns { success, error, documentType, documentId, documentNumber, companyId, companyName }
 */
async function attemptAllocationForFile(file, userId, userEmail, userRole, ip, userAgent) {
  const parsedData = file.parsedData || {};
  
  // Extract account number from parsed data
  const accountNumber = parsedData.accountNumber || parsedData.customerNumber || 
                       parsedData.account_no || parsedData.accountNo || 
                       parsedData.customer_number || null;
  
  if (!accountNumber) {
    return {
      success: false,
      error: 'No account number found in parsed data',
      parsedFields: Object.keys(parsedData)
    };
  }

  // Try to match to a company
  const accountStr = accountNumber.toString().trim();
  const accountStrNormalized = accountStr.replace(/[^\d]/g, '');
  const accountInt = parseInt(accountStrNormalized, 10);

  let matchedCompany = null;

  // Try referenceNo (integer) match first
  if (!isNaN(accountInt)) {
    matchedCompany = await Company.findOne({
      where: { referenceNo: accountInt, isActive: true }
    });
  }

  // Try code match
  if (!matchedCompany) {
    matchedCompany = await Company.findOne({
      where: { 
        code: { [Op.in]: [accountStr, accountStrNormalized] },
        isActive: true
      }
    });
  }

  if (!matchedCompany) {
    return {
      success: false,
      error: `No matching company found for account number: ${accountNumber}`,
      searchedValues: { original: accountNumber, normalized: accountStrNormalized, asInteger: accountInt }
    };
  }

  // Determine document type
  const docType = (parsedData.documentType || '').toLowerCase();
  const isCredit = docType.includes('credit') || docType === 'credit_note' || docType === 'creditnote';
  const isInvoice = !isCredit;

  // Parse date
  const dateValue = parsedData.invoiceDate || parsedData.date || parsedData.taxPoint || new Date().toISOString();
  let issueDate;
  try {
    if (typeof dateValue === 'string') {
      const ddmmyyyy = dateValue.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
      if (ddmmyyyy) {
        issueDate = new Date(parseInt(ddmmyyyy[3]), parseInt(ddmmyyyy[2]) - 1, parseInt(ddmmyyyy[1]));
      } else {
        issueDate = new Date(dateValue);
      }
    } else {
      issueDate = new Date(dateValue);
    }
    if (isNaN(issueDate.getTime())) {
      issueDate = new Date();
    }
  } catch (e) {
    issueDate = new Date();
  }

  // Parse amount
  const amountValue = parsedData.totalAmount || parsedData.amount || parsedData.invoiceTotal || 0;
  let amount = 0;
  if (typeof amountValue === 'string') {
    amount = parseFloat(amountValue.replace(/[^0-9.-]/g, '')) || 0;
  } else if (typeof amountValue === 'number') {
    amount = amountValue;
  }

  // Parse VAT amount
  const vatValue = parsedData.vatAmount || parsedData.vatTotal || 0;
  let vatAmount = 0;
  if (typeof vatValue === 'string') {
    vatAmount = parseFloat(vatValue.replace(/[^0-9.-]/g, '')) || 0;
  } else if (typeof vatValue === 'number') {
    vatAmount = vatValue;
  }

  let document = null;

  // Create invoice or credit note
  if (isInvoice) {
    const invoiceNumber = parsedData.invoiceNumber || parsedData.documentNumber || 
                         `INV-${Date.now()}-${file.fileHash?.substring(0, 8) || 'ALLOC'}`;

    // Check for duplicate invoice number
    const existingInvoice = await Invoice.findOne({
      where: { 
        companyId: matchedCompany.id,
        invoiceNumber: invoiceNumber,
        deletedAt: null
      }
    });

    if (existingInvoice) {
      return {
        success: false,
        error: `Invoice ${invoiceNumber} already exists for company ${matchedCompany.name}`,
        existingInvoiceId: existingInvoice.id
      };
    }

    document = await Invoice.create({
      companyId: matchedCompany.id,
      invoiceNumber: invoiceNumber,
      issueDate: issueDate,
      amount: amount,
      taxAmount: vatAmount,
      documentStatus: 'ready',
      status: 'ready',
      viewedAt: null,
      fileUrl: file.filePath,
      uploadedById: userId,
      metadata: {
        allocatedFrom: 'unallocated',
        allocatedAt: new Date().toISOString(),
        allocatedBy: userEmail,
        originalFileId: file.id,
        parsedData: parsedData
      }
    });

    console.log(`✅ Created invoice ${invoiceNumber} for company ${matchedCompany.name} from unallocated file ${file.id}`);
  } else {
    const creditNoteNumber = parsedData.creditNumber || parsedData.creditNoteNumber || 
                             parsedData.documentNumber || `CN-${Date.now()}-${file.fileHash?.substring(0, 8) || 'ALLOC'}`;

    // Check for duplicate credit note number
    const existingCreditNote = await CreditNote.findOne({
      where: { 
        companyId: matchedCompany.id,
        creditNoteNumber: creditNoteNumber,
        deletedAt: null
      }
    });

    if (existingCreditNote) {
      return {
        success: false,
        error: `Credit Note ${creditNoteNumber} already exists for company ${matchedCompany.name}`,
        existingCreditNoteId: existingCreditNote.id
      };
    }

    document = await CreditNote.create({
      companyId: matchedCompany.id,
      creditNoteNumber: creditNoteNumber,
      issueDate: issueDate,
      amount: amount,
      taxAmount: vatAmount,
      documentStatus: 'ready',
      status: 'ready',
      viewedAt: null,
      fileUrl: file.filePath,
      uploadedById: userId,
      metadata: {
        allocatedFrom: 'unallocated',
        allocatedAt: new Date().toISOString(),
        allocatedBy: userEmail,
        originalFileId: file.id,
        parsedData: parsedData
      }
    });

    console.log(`✅ Created credit note ${creditNoteNumber} for company ${matchedCompany.name} from unallocated file ${file.id}`);
  }

  // Move file from unprocessed to processed folder
  const oldFilePath = file.filePath;
  let newFilePath = oldFilePath;
  
  if (oldFilePath && fs.existsSync(oldFilePath)) {
    try {
      const docTypeFolder = isInvoice ? 'invoices' : 'creditnotes';
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      
      const processedDir = path.join(PROCESSED_BASE, docTypeFolder, String(year), month, day);
      ensureDir(processedDir);
      
      const fileName = path.basename(oldFilePath);
      newFilePath = path.join(processedDir, fileName);
      
      let counter = 1;
      while (fs.existsSync(newFilePath)) {
        const ext = path.extname(fileName);
        const base = path.basename(fileName, ext);
        newFilePath = path.join(processedDir, `${base}_${counter}${ext}`);
        counter++;
      }
      
      fs.renameSync(oldFilePath, newFilePath);
      console.log(`📁 Moved file from ${oldFilePath} to ${newFilePath}`);
      
      document.fileUrl = newFilePath;
      await document.save();
    } catch (moveError) {
      console.error(`⚠️ Failed to move file: ${moveError.message}`);
    }
  }

  // Update file status to allocated
  file.status = 'parsed';
  file.companyId = matchedCompany.id;
  file.filePath = newFilePath;
  file.failureReason = null;
  const metadata = file.metadata || {};
  metadata.allocatedAt = new Date().toISOString();
  metadata.allocatedBy = userEmail;
  metadata.allocatedDocumentId = document.id;
  metadata.allocatedDocumentType = isInvoice ? 'invoice' : 'credit_note';
  metadata.previousFilePath = oldFilePath;
  file.metadata = metadata;
  await file.save();

  // Log activity
  await logActivity({
    type: ActivityType.UNALLOCATED_ALLOCATED,
    userId: userId,
    userEmail: userEmail,
    userRole: userRole,
    action: `Allocated unallocated file ${file.fileName} to ${matchedCompany.name}`,
    details: { 
      fileId: file.id, 
      fileName: file.fileName, 
      companyId: matchedCompany.id,
      companyName: matchedCompany.name,
      documentType: isInvoice ? 'invoice' : 'credit_note',
      documentId: document.id,
      documentNumber: isInvoice ? document.invoiceNumber : document.creditNoteNumber
    },
    companyId: matchedCompany.id,
    companyName: matchedCompany.name,
    ipAddress: ip,
    userAgent: userAgent
  });

  return {
    success: true,
    documentType: isInvoice ? 'invoice' : 'credit_note',
    documentId: document.id,
    documentNumber: isInvoice ? document.invoiceNumber : document.creditNoteNumber,
    companyId: matchedCompany.id,
    companyName: matchedCompany.name
  };
}

// POST /api/unallocated/bulk-allocate - Start bulk allocation
router.post('/bulk-allocate', requirePermission('UNALLOCATED_REALLOCATE'), async (req, res) => {
  try {
    const { fileIds } = req.body;
    
    // If fileIds is empty or not provided, get all unallocated files
    let filesToProcess;
    if (!fileIds || fileIds.length === 0) {
      filesToProcess = await File.findAll({
        where: {
          status: { [Op.in]: ['unallocated', 'failed'] },
          deletedAt: null
        },
        attributes: ['id']
      });
    } else {
      filesToProcess = await File.findAll({
        where: {
          id: { [Op.in]: fileIds },
          status: { [Op.in]: ['unallocated', 'failed'] },
          deletedAt: null
        },
        attributes: ['id']
      });
    }
    
    const fileIdList = filesToProcess.map(f => f.id);
    
    if (fileIdList.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No unallocated files found to process'
      });
    }
    
    // Create allocation session
    const allocationId = `alloc-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    await allocationStore.createAllocation(allocationId, fileIdList.length, fileIdList, req.user.userId);
    
    console.log(`🚀 [Allocation ${allocationId}] Starting bulk allocation of ${fileIdList.length} files`);
    
    // Process files asynchronously (don't await)
    processAllocationAsync(allocationId, fileIdList, req.user, req.ip, req.get('user-agent'));
    
    res.json({
      success: true,
      allocationId: allocationId,
      totalFiles: fileIdList.length,
      message: `Started allocation of ${fileIdList.length} file(s)`
    });
  } catch (error) {
    console.error('Error starting bulk allocation:', error);
    res.status(500).json({ message: error.message });
  }
});

/**
 * Process allocation asynchronously
 */
async function processAllocationAsync(allocationId, fileIds, user, ip, userAgent) {
  for (const fileId of fileIds) {
    // Check if cancelled
    const isCancelled = await allocationStore.isCancelled(allocationId);
    if (isCancelled) {
      console.log(`🛑 [Allocation ${allocationId}] Cancelled by user`);
      break;
    }
    
    try {
      const file = await File.findOne({
        where: {
          id: fileId,
          status: { [Op.in]: ['unallocated', 'failed'] },
          deletedAt: null
        }
      });
      
      if (!file) {
        await allocationStore.addResult(allocationId, {
          fileId: fileId,
          fileName: 'Unknown',
          success: false,
          error: 'File not found or already processed'
        });
        continue;
      }
      
      // Update current file
      await allocationStore.updateAllocation(allocationId, { currentFile: file.fileName });
      
      // Attempt allocation
      const result = await attemptAllocationForFile(file, user.userId, user.email, user.role, ip, userAgent);
      
      await allocationStore.addResult(allocationId, {
        fileId: file.id,
        fileName: file.fileName,
        ...result
      });
      
    } catch (error) {
      console.error(`❌ [Allocation ${allocationId}] Error processing file ${fileId}:`, error.message);
      await allocationStore.addResult(allocationId, {
        fileId: fileId,
        fileName: 'Unknown',
        success: false,
        error: error.message
      });
    }
  }
  
  // Mark as completed if not already
  const session = await allocationStore.getAllocation(allocationId);
  if (session && session.status !== 'cancelled') {
    await allocationStore.updateAllocation(allocationId, {
      status: 'completed',
      completedAt: new Date().toISOString()
    });
    console.log(`✅ [Allocation ${allocationId}] Completed`);
  }
}

// GET /api/unallocated/allocate/:allocationId - Get allocation status
router.get('/allocate/:allocationId', async (req, res) => {
  try {
    const { allocationId } = req.params;
    const allocationSession = await allocationStore.getAllocation(allocationId);
    
    if (!allocationSession) {
      return res.status(404).json({
        success: false,
        message: 'Allocation session not found'
      });
    }
    
    res.json({
      success: true,
      allocation: {
        allocationId: allocationSession.allocationId,
        totalFiles: allocationSession.totalFiles,
        processedFiles: allocationSession.processedFiles || 0,
        currentFile: allocationSession.currentFile || null,
        status: allocationSession.status,
        cancelled: allocationSession.cancelled || false,
        createdAt: allocationSession.createdAt,
        completedAt: allocationSession.completedAt
      }
    });
  } catch (error) {
    console.error('Error fetching allocation status:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// GET /api/unallocated/allocate/:allocationId/results - Get detailed allocation results
router.get('/allocate/:allocationId/results', async (req, res) => {
  try {
    const { allocationId } = req.params;
    const allocationSession = await allocationStore.getAllocation(allocationId);
    
    if (!allocationSession) {
      return res.status(404).json({
        success: false,
        message: 'Allocation session not found'
      });
    }
    
    // Calculate summary statistics
    const successful = allocationSession.results.filter(r => r.success).length;
    const failed = allocationSession.results.filter(r => !r.success).length;
    const invoices = allocationSession.results.filter(r => r.success && r.documentType === 'invoice').length;
    const creditNotes = allocationSession.results.filter(r => r.success && r.documentType === 'credit_note').length;
    
    res.json({
      success: true,
      allocation: {
        allocationId: allocationSession.allocationId,
        totalFiles: allocationSession.totalFiles,
        processedFiles: allocationSession.processedFiles,
        status: allocationSession.status,
        createdAt: allocationSession.createdAt,
        completedAt: allocationSession.completedAt,
        summary: {
          successful,
          failed,
          invoices,
          creditNotes
        },
        results: allocationSession.results
      }
    });
  } catch (error) {
    console.error('Error fetching allocation results:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// POST /api/unallocated/allocate/:allocationId/cancel - Cancel an allocation
router.post('/allocate/:allocationId/cancel', async (req, res) => {
  try {
    const { allocationId } = req.params;
    const cancelled = await allocationStore.cancelAllocation(allocationId);
    
    if (!cancelled) {
      return res.status(404).json({
        success: false,
        message: 'Allocation session not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Allocation cancelled'
    });
  } catch (error) {
    console.error('Error cancelling allocation:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;

