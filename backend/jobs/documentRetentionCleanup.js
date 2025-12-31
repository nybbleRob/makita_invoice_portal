/**
 * Document Retention Cleanup Job
 * Deletes documents (Invoices, Credit Notes, Statements) that have passed their retention expiry date
 * Should be run hourly via cron or scheduler for accurate < 1 hour deletion
 */

const { Invoice, CreditNote, Statement, Company, User, Settings } = require('../models');
const { Op } = require('sequelize');
const fs = require('fs');
const path = require('path');
const { sendTemplatedEmail } = require('../utils/sendTemplatedEmail');
const { logActivity, ActivityType } = require('../services/activityLogger');

/**
 * Clean up expired documents based on retention policy
 * @returns {Promise<Object>} - Result object with deletion counts
 */
async function cleanupExpiredDocuments() {
  try {
    console.log('🧹 Starting document retention cleanup job...');
    
    const settings = await Settings.getSettings();
    const retentionPeriod = settings.documentRetentionPeriod;
    
    // If retention is disabled, skip cleanup
    if (!retentionPeriod) {
      console.log('ℹ️  Document retention is disabled, skipping cleanup');
      return { deleted: 0, skipped: 0, errors: 0 };
    }
    
    const now = new Date();
    console.log(`📅 Deleting documents with retentionExpiryDate <= ${now.toISOString()}`);
    
    let deletedCount = 0;
    let errorCount = 0;
    
    // Find expired invoices
    const expiredInvoices = await Invoice.findAll({
      where: {
        retentionExpiryDate: {
          [Op.lte]: now
        },
        retentionDeletedAt: null, // Not already deleted
        deletedAt: null // Not manually deleted
      },
      include: [{
        model: Company,
        as: 'company',
        attributes: ['id', 'name', 'edi']
      }]
    });
    
    console.log(`📄 Found ${expiredInvoices.length} expired invoice(s)`);
    
    for (const invoice of expiredInvoices) {
      try {
        await deleteDocument(invoice, 'invoice', settings);
        deletedCount++;
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
        },
        retentionDeletedAt: null,
        deletedAt: null
      },
      include: [{
        model: Company,
        as: 'company',
        attributes: ['id', 'name', 'edi']
      }]
    });
    
    console.log(`📄 Found ${expiredCreditNotes.length} expired credit note(s)`);
    
    for (const creditNote of expiredCreditNotes) {
      try {
        await deleteDocument(creditNote, 'credit_note', settings);
        deletedCount++;
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
        },
        retentionDeletedAt: null,
        deletedAt: null
      },
      include: [{
        model: Company,
        as: 'company',
        attributes: ['id', 'name', 'edi']
      }]
    });
    
    console.log(`📄 Found ${expiredStatements.length} expired statement(s)`);
    
    for (const statement of expiredStatements) {
      try {
        await deleteDocument(statement, 'statement', settings);
        deletedCount++;
      } catch (error) {
        console.error(`❌ Error deleting statement ${statement.statementNumber}:`, error.message);
        errorCount++;
      }
    }
    
    console.log(`✅ Document retention cleanup completed: ${deletedCount} deleted, ${errorCount} errors`);
    
    return {
      deleted: deletedCount,
      errors: errorCount,
      total: expiredInvoices.length + expiredCreditNotes.length + expiredStatements.length
    };
  } catch (error) {
    console.error('❌ Document retention cleanup job error:', error.message);
    throw error;
  }
}

/**
 * Delete a single document and send notification email
 * @param {Object} document - Document instance (Invoice, CreditNote, or Statement)
 * @param {string} documentType - 'invoice', 'credit_note', or 'statement'
 * @param {Object} settings - Settings object
 */
async function deleteDocument(document, documentType, settings) {
  const documentNumber = document.invoiceNumber || document.creditNoteNumber || document.statementNumber;
  const documentTypeLabel = documentType === 'invoice' ? 'Invoice' :
                            documentType === 'credit_note' ? 'Credit Note' : 'Statement';
  
  console.log(`🗑️  Deleting ${documentTypeLabel} ${documentNumber}...`);
  
  // Get company for email notification
  const company = document.company;
  
  // Delete physical file if exists
  if (document.fileUrl) {
    try {
      const filePath = document.fileUrl.startsWith('/') 
        ? path.join(process.cwd(), 'uploads', document.fileUrl.replace(/^\//, ''))
        : document.fileUrl;
      
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`   📁 Deleted file: ${filePath}`);
      }
    } catch (fileError) {
      console.error(`   ⚠️  Error deleting file ${document.fileUrl}:`, fileError.message);
      // Continue with database deletion even if file deletion fails
    }
  }
  
  // Mark as deleted in database
  const deletedAt = new Date();
  await document.update({
    retentionDeletedAt: deletedAt,
    deletedAt: deletedAt,
    deletedBy: null, // System deletion
    deletedReason: `Automatically deleted due to retention policy (${settings.documentRetentionPeriod} days)`
  });
  
  // Send email notification to company users
  if (company && !company.edi) {
    // Find company users to notify
    const companyUsers = await User.findAll({
      where: {
        role: 'external_user'
      },
      include: [{
        model: Company,
        as: 'companies',
        where: { id: company.id },
        attributes: []
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
      allUsers = [...new Set([...allUsers, ...directUsers])];
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
              deletionDate: deletedAt.toLocaleDateString('en-GB'),
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
  } else if (company?.edi) {
    console.log(`   📧 Company ${company.name} has EDI enabled, skipping email notifications`);
  }
  
  // Log activity
  try {
    await logActivity({
      type: ActivityType.DOCUMENT_DELETED,
      userId: null,
      userEmail: 'system',
      userRole: 'system',
      action: `Deleted ${documentTypeLabel} ${documentNumber} due to retention policy`,
      details: {
        documentType,
        documentId: document.id,
        documentNumber,
        companyId: company?.id,
        companyName: company?.name,
        retentionPeriod: settings.documentRetentionPeriod
      },
      companyId: company?.id,
      companyName: company?.name,
      ipAddress: 'system',
      userAgent: 'document-retention-cleanup'
    });
  } catch (logError) {
    console.error(`   ⚠️  Error logging activity:`, logError.message);
  }
  
  console.log(`   ✅ Deleted ${documentTypeLabel} ${documentNumber}`);
}

module.exports = {
  cleanupExpiredDocuments
};

