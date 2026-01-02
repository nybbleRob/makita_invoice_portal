/**
 * Document Retention Cleanup Job
 * HARD DELETES documents (Invoices, Credit Notes, Statements) that have passed their retention expiry date
 * Also deletes associated File records to prevent orphaned references
 * Should be run hourly via cron or scheduler for accurate < 1 hour deletion
 */

const { Invoice, CreditNote, Statement, Company, User, File, Settings } = require('../models');
const { Op } = require('sequelize');
const fs = require('fs');
const path = require('path');
const { sendTemplatedEmail } = require('../utils/sendTemplatedEmail');
const { logActivity, ActivityType } = require('../services/activityLogger');
const { STORAGE_BASE, PROCESSED_BASE, UNPROCESSED_BASE } = require('../config/storage');

/**
 * Clean up expired documents based on retention policy
 * Performs HARD DELETE - completely removes records from database
 * @returns {Promise<Object>} - Result object with deletion counts
 */
async function cleanupExpiredDocuments() {
  try {
    console.log('🧹 Starting document retention cleanup job (HARD DELETE mode)...');
    
    const settings = await Settings.getSettings();
    const retentionPeriod = settings.documentRetentionPeriod;
    
    // If retention is disabled, skip cleanup
    if (!retentionPeriod) {
      console.log('ℹ️  Document retention is disabled, skipping cleanup');
      return { deleted: 0, skipped: 0, errors: 0 };
    }
    
    const now = new Date();
    console.log(`📅 Hard deleting documents with retentionExpiryDate <= ${now.toISOString()}`);
    
    let deletedCount = 0;
    let errorCount = 0;
    const deletionLog = [];
    
    // Find expired invoices (including those already soft-deleted but not hard-deleted)
    const expiredInvoices = await Invoice.findAll({
      where: {
        retentionExpiryDate: {
          [Op.lte]: now
        }
      },
      include: [{
        model: Company,
        as: 'company',
        attributes: ['id', 'name', 'edi'],
        required: false
      }],
      paranoid: false // Include soft-deleted records
    });
    
    console.log(`📄 Found ${expiredInvoices.length} expired invoice(s)`);
    
    for (const invoice of expiredInvoices) {
      try {
        const result = await hardDeleteDocument(invoice, 'invoice', settings);
        deletedCount++;
        deletionLog.push(result);
      } catch (error) {
        console.error(`❌ Error deleting invoice ${invoice.invoiceNumber}:`, error.message);
        errorCount++;
      }
    }
    
    // Find expired credit notes
    const expiredCreditNotes = await CreditNote.findAll({
      where: {
        retentionExpiryDate: {
          [Op.lte]: now
        }
      },
      include: [{
        model: Company,
        as: 'company',
        attributes: ['id', 'name', 'edi'],
        required: false
      }],
      paranoid: false
    });
    
    console.log(`📄 Found ${expiredCreditNotes.length} expired credit note(s)`);
    
    for (const creditNote of expiredCreditNotes) {
      try {
        const result = await hardDeleteDocument(creditNote, 'credit_note', settings);
        deletedCount++;
        deletionLog.push(result);
      } catch (error) {
        console.error(`❌ Error deleting credit note ${creditNote.creditNoteNumber}:`, error.message);
        errorCount++;
      }
    }
    
    // Find expired statements
    const expiredStatements = await Statement.findAll({
      where: {
        retentionExpiryDate: {
          [Op.lte]: now
        }
      },
      include: [{
        model: Company,
        as: 'company',
        attributes: ['id', 'name', 'edi'],
        required: false
      }],
      paranoid: false
    });
    
    console.log(`📄 Found ${expiredStatements.length} expired statement(s)`);
    
    for (const statement of expiredStatements) {
      try {
        const result = await hardDeleteDocument(statement, 'statement', settings);
        deletedCount++;
        deletionLog.push(result);
      } catch (error) {
        console.error(`❌ Error deleting statement ${statement.statementNumber}:`, error.message);
        errorCount++;
      }
    }
    
    // Clean up orphaned File records (files not associated with any document)
    const orphanedFilesResult = await cleanupOrphanedFiles();
    
    console.log(`✅ Document retention cleanup completed: ${deletedCount} deleted, ${errorCount} errors, ${orphanedFilesResult.deleted} orphaned files cleaned`);
    
    // Log the cleanup run to activity log
    try {
      await logActivity({
        type: ActivityType.DOCUMENT_DELETED,
        userId: null,
        userEmail: 'system',
        userRole: 'system',
        action: `Retention cleanup completed: ${deletedCount} documents hard deleted`,
        details: {
          deletedCount,
          errorCount,
          orphanedFilesDeleted: orphanedFilesResult.deleted,
          retentionPeriod,
          deletionLog: deletionLog.slice(0, 50) // Limit log size
        },
        ipAddress: 'system',
        userAgent: 'document-retention-cleanup'
      });
    } catch (logError) {
      console.error('Failed to log cleanup activity:', logError.message);
    }
    
    return {
      deleted: deletedCount,
      errors: errorCount,
      orphanedFilesDeleted: orphanedFilesResult.deleted,
      total: expiredInvoices.length + expiredCreditNotes.length + expiredStatements.length
    };
  } catch (error) {
    console.error('❌ Document retention cleanup job error:', error.message);
    throw error;
  }
}

/**
 * HARD DELETE a single document - completely removes from database
 * @param {Object} document - Document instance (Invoice, CreditNote, or Statement)
 * @param {string} documentType - 'invoice', 'credit_note', or 'statement'
 * @param {Object} settings - Settings object
 * @returns {Object} - Deletion result with document details
 */
async function hardDeleteDocument(document, documentType, settings) {
  const documentNumber = document.invoiceNumber || document.creditNoteNumber || document.statementNumber;
  const documentTypeLabel = documentType === 'invoice' ? 'Invoice' :
                            documentType === 'credit_note' ? 'Credit Note' : 'Statement';
  
  console.log(`🗑️  HARD DELETING ${documentTypeLabel} ${documentNumber}...`);
  
  // Get company for email notification (before deletion)
  const company = document.company;
  const companyId = company?.id;
  const companyName = company?.name;
  
  // Store info for logging before deletion
  const deletionInfo = {
    documentType,
    documentId: document.id,
    documentNumber,
    companyId,
    companyName,
    fileUrl: document.fileUrl,
    deletedAt: new Date().toISOString()
  };
  
  // Delete physical file if exists
  const filePaths = [document.fileUrl];
  
  // Also check for any associated File records
  if (document.fileId) {
    try {
      const fileRecord = await File.findByPk(document.fileId);
      if (fileRecord?.filePath) {
        filePaths.push(fileRecord.filePath);
      }
    } catch (e) {
      // File record may not exist
    }
  }
  
  for (const fileUrl of filePaths) {
    if (fileUrl) {
      try {
        // Handle both absolute paths and relative paths
        let filePath = fileUrl;
        if (!path.isAbsolute(fileUrl)) {
          // Try multiple locations for the file
          const possiblePaths = [
            path.join(PROCESSED_BASE, fileUrl.replace(/^\//, '')),
            path.join(STORAGE_BASE, fileUrl.replace(/^\//, '')),
            path.join(STORAGE_BASE, 'documents', fileUrl.replace(/^\//, '')),
            path.join(process.cwd(), 'uploads', fileUrl.replace(/^\//, ''))
          ];
          
          filePath = possiblePaths.find(p => fs.existsSync(p)) || possiblePaths[0];
        }
        
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log(`   📁 Deleted file: ${filePath}`);
        }
      } catch (fileError) {
        console.error(`   ⚠️  Error deleting file ${fileUrl}:`, fileError.message);
        // Continue with database deletion even if file deletion fails
      }
    }
  }
  
  // Delete associated File record if exists
  if (document.fileId) {
    try {
      await File.destroy({
        where: { id: document.fileId },
        force: true // Hard delete
      });
      console.log(`   📁 Deleted associated File record: ${document.fileId}`);
    } catch (fileRecordError) {
      console.error(`   ⚠️  Error deleting File record:`, fileRecordError.message);
    }
  }
  
  // Also find and delete File records that reference this document
  try {
    const associatedFiles = await File.findAll({
      where: {
        [Op.or]: [
          { invoiceId: document.id },
          { creditNoteId: document.id }
        ]
      },
      paranoid: false
    });
    
    for (const file of associatedFiles) {
      // Delete the physical file
      if (file.filePath && fs.existsSync(file.filePath)) {
        try {
          fs.unlinkSync(file.filePath);
          console.log(`   📁 Deleted associated file: ${file.filePath}`);
        } catch (e) {
          console.error(`   ⚠️  Error deleting associated file:`, e.message);
        }
      }
      
      // Hard delete the File record
      await file.destroy({ force: true });
    }
    
    if (associatedFiles.length > 0) {
      console.log(`   📁 Deleted ${associatedFiles.length} associated File record(s)`);
    }
  } catch (e) {
    // Association columns may not exist, continue
  }
  
  // Send email notification to company users BEFORE deletion
  if (company && !company.edi) {
    try {
      await notifyCompanyUsers(company, documentTypeLabel, documentNumber, settings);
    } catch (emailError) {
      console.error(`   ⚠️  Error sending notifications:`, emailError.message);
    }
  }
  
  // HARD DELETE the document from database (no soft delete, completely remove)
  await document.destroy({ force: true });
  
  console.log(`   ✅ HARD DELETED ${documentTypeLabel} ${documentNumber}`);
  
  return deletionInfo;
}

/**
 * Send email notification to company users about document deletion
 */
async function notifyCompanyUsers(company, documentTypeLabel, documentNumber, settings) {
  // Find company users to notify
  const companyUsers = await User.findAll({
    where: {
      role: 'external_user'
    },
    include: [{
      model: Company,
      as: 'companies',
      where: { id: company.id },
      attributes: [],
      required: true
    }]
  });
  
  // Also try to find users by companyId if the association is different
  let allUsers = [...companyUsers];
  try {
    const directUsers = await User.findAll({
      where: {
        companyId: company.id,
        role: 'external_user'
      }
    });
    // Deduplicate users
    const existingIds = new Set(allUsers.map(u => u.id));
    for (const user of directUsers) {
      if (!existingIds.has(user.id)) {
        allUsers.push(user);
      }
    }
  } catch (e) {
    // Association might not exist, continue
  }
  
  // Send email to each user
  for (const user of allUsers) {
    if (user.email) {
      try {
        await sendTemplatedEmail(
          'document-deleted',
          user.email,
          {
            userName: user.name || user.email,
            documentType: documentTypeLabel,
            documentNumber: documentNumber,
            deletionDate: new Date().toLocaleDateString('en-GB'),
            retentionPeriod: settings.documentRetentionPeriod,
            companyName: settings.companyName || 'Makita Invoice Portal'
          },
          settings,
          {
            ipAddress: 'system',
            userAgent: 'document-retention-cleanup',
            userId: null
          }
        );
        console.log(`   📧 Sent deletion notification to ${user.email}`);
      } catch (emailError) {
        console.error(`   ⚠️  Error sending email to ${user.email}:`, emailError.message);
      }
    }
  }
}

/**
 * Clean up orphaned File records (files not associated with any document)
 * These can occur if a document was deleted but the file record wasn't
 * @returns {Promise<Object>} - Result with deletion count
 */
async function cleanupOrphanedFiles() {
  try {
    // Find File records where the associated invoice/credit note no longer exists
    const orphanedFiles = await File.findAll({
      where: {
        status: 'parsed', // Was successfully processed
        [Op.or]: [
          { invoiceId: { [Op.ne]: null } },
          { creditNoteId: { [Op.ne]: null } }
        ]
      },
      paranoid: false
    });
    
    let deletedCount = 0;
    
    for (const file of orphanedFiles) {
      // Check if the associated document still exists
      let documentExists = false;
      
      if (file.invoiceId) {
        const invoice = await Invoice.findByPk(file.invoiceId, { paranoid: false });
        documentExists = !!invoice;
      }
      
      if (file.creditNoteId && !documentExists) {
        const creditNote = await CreditNote.findByPk(file.creditNoteId, { paranoid: false });
        documentExists = !!creditNote;
      }
      
      // If document doesn't exist, the file is orphaned
      if (!documentExists) {
        console.log(`🗑️  Cleaning up orphaned File record: ${file.fileName}`);
        
        // Delete physical file
        if (file.filePath && fs.existsSync(file.filePath)) {
          try {
            fs.unlinkSync(file.filePath);
            console.log(`   📁 Deleted orphaned file: ${file.filePath}`);
          } catch (e) {
            console.error(`   ⚠️  Error deleting orphaned file:`, e.message);
          }
        }
        
        // Hard delete the File record
        await file.destroy({ force: true });
        deletedCount++;
      }
    }
    
    if (deletedCount > 0) {
      console.log(`🧹 Cleaned up ${deletedCount} orphaned File record(s)`);
    }
    
    return { deleted: deletedCount };
  } catch (error) {
    console.error('Error cleaning up orphaned files:', error.message);
    return { deleted: 0, error: error.message };
  }
}

module.exports = {
  cleanupExpiredDocuments,
  hardDeleteDocument,
  cleanupOrphanedFiles
};
