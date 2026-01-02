/**
 * Batch Notification Service
 * Tracks import batches and triggers email notifications when all files in a batch are processed
 * 
 * Flow:
 * 1. When a batch import starts (manual upload or FTP scan), registerBatch() is called
 * 2. As each job completes, recordJobCompletion() is called
 * 3. When all jobs in a batch are complete, sendBatchNotifications() is triggered
 */

const { Company, Invoice, CreditNote, File, Settings, User } = require('../models');
const { queueDocumentNotifications } = require('./documentNotificationService');
const { logActivity, ActivityType } = require('./activityLogger');
const { isEmailEnabled, sendEmail } = require('../utils/emailService');
const { Op } = require('sequelize');

// In-memory batch tracking (will be lost on server restart)
// For production, consider using Redis or database for persistence
const batchTracker = new Map();

// TTL for batch records (1 hour)
const BATCH_TTL = 60 * 60 * 1000;

/**
 * Register a new batch import
 * @param {string} importId - Unique import batch ID
 * @param {number} totalJobs - Total number of jobs in this batch
 * @param {Object} options - Additional options
 */
function registerBatch(importId, totalJobs, options = {}) {
  if (!importId || totalJobs <= 0) return;
  
  console.log(`📋 [Batch ${importId}] Registered batch with ${totalJobs} jobs`);
  
  batchTracker.set(importId, {
    importId,
    totalJobs,
    completedJobs: 0,
    successfulJobs: 0,
    failedJobs: 0,
    documents: [],
    companyDocuments: new Map(), // companyId -> { invoices: [], creditNotes: [], statements: [] }
    startTime: Date.now(),
    userId: options.userId,
    userEmail: options.userEmail,
    source: options.source || 'unknown'
  });
  
  // Set TTL to auto-cleanup stale batches
  setTimeout(() => {
    if (batchTracker.has(importId)) {
      console.log(`🧹 [Batch ${importId}] Expired and cleaned up (TTL exceeded)`);
      batchTracker.delete(importId);
    }
  }, BATCH_TTL);
}

/**
 * Record completion of a job in a batch
 * @param {string} importId - Import batch ID
 * @param {Object} result - Job result
 */
async function recordJobCompletion(importId, result) {
  if (!importId || !batchTracker.has(importId)) {
    // Job not part of tracked batch, skip
    return;
  }
  
  const batch = batchTracker.get(importId);
  batch.completedJobs++;
  
  if (result.success) {
    batch.successfulJobs++;
    
    // Track document if created
    if (result.documentId && result.companyId) {
      const docInfo = {
        id: result.documentId,
        type: result.documentType,
        companyId: result.companyId,
        fileName: result.fileName,
        invoiceNumber: result.invoiceNumber,
        amount: result.amount
      };
      
      batch.documents.push(docInfo);
      
      // Group by company
      if (!batch.companyDocuments.has(result.companyId)) {
        batch.companyDocuments.set(result.companyId, {
          invoices: [],
          creditNotes: [],
          statements: []
        });
      }
      
      const companyDocs = batch.companyDocuments.get(result.companyId);
      if (result.documentType === 'invoice') {
        companyDocs.invoices.push(docInfo);
      } else if (result.documentType === 'credit_note') {
        companyDocs.creditNotes.push(docInfo);
      } else if (result.documentType === 'statement') {
        companyDocs.statements.push(docInfo);
      }
    }
  } else {
    batch.failedJobs++;
  }
  
  console.log(`📋 [Batch ${importId}] Progress: ${batch.completedJobs}/${batch.totalJobs} (${batch.successfulJobs} success, ${batch.failedJobs} failed)`);
  
  // Check if batch is complete
  if (batch.completedJobs >= batch.totalJobs) {
    console.log(`✅ [Batch ${importId}] All jobs complete! Triggering notifications...`);
    
    try {
      await sendBatchNotifications(importId, batch);
    } catch (error) {
      console.error(`❌ [Batch ${importId}] Error sending notifications:`, error.message);
    } finally {
      // Clean up batch
      batchTracker.delete(importId);
    }
  }
}

/**
 * Send notifications for a completed batch
 * @param {string} importId - Import batch ID
 * @param {Object} batch - Batch data
 */
async function sendBatchNotifications(importId, batch) {
  if (batch.companyDocuments.size === 0) {
    console.log(`ℹ️  [Batch ${importId}] No documents to notify about`);
    return;
  }
  
  const settings = await Settings.getSettings();
  
  // Check if email is enabled (Mailtrap = test mode, always enabled)
  if (!isEmailEnabled(settings)) {
    console.log(`ℹ️  [Batch ${importId}] Email not enabled, skipping notifications`);
    return;
  }
  
  const processingTime = Date.now() - batch.startTime;
  let totalNotificationsSent = 0;
  
  // Send notifications for each company
  for (const [companyId, docs] of batch.companyDocuments) {
    try {
      const company = await Company.findByPk(companyId);
      if (!company) {
        console.warn(`⚠️  [Batch ${importId}] Company ${companyId} not found, skipping`);
        continue;
      }
      
      // Skip EDI companies (they don't receive email notifications)
      if (company.edi) {
        console.log(`ℹ️  [Batch ${importId}] Company ${company.name} has EDI enabled, skipping email notifications`);
        continue;
      }
      
      // Fetch full document objects for notification
      const invoices = docs.invoices.length > 0 
        ? await Invoice.findAll({ where: { id: { [Op.in]: docs.invoices.map(d => d.id) } } })
        : [];
      
      const creditNotes = docs.creditNotes.length > 0
        ? await CreditNote.findAll({ where: { id: { [Op.in]: docs.creditNotes.map(d => d.id) } } })
        : [];
      
      // Queue notifications
      const result = await queueDocumentNotifications({
        companyId,
        companyName: company.name,
        importId,
        invoices: invoices.map(inv => ({
          id: inv.id,
          invoiceNumber: inv.invoiceNumber,
          amount: inv.amount,
          date: inv.issueDate?.toISOString(),
          filePath: inv.fileUrl
        })),
        creditNotes: creditNotes.map(cn => ({
          id: cn.id,
          creditNoteNumber: cn.creditNoteNumber,
          amount: cn.amount,
          date: cn.issueDate?.toISOString(),
          filePath: cn.fileUrl
        })),
        statements: [], // Add statement support if needed
        triggeredByUserId: batch.userId,
        triggeredByEmail: batch.userEmail
      });
      
      totalNotificationsSent += result.emailsQueued || 0;
      console.log(`📧 [Batch ${importId}] Queued ${result.emailsQueued} notifications for ${company.name}`);
      
    } catch (error) {
      console.error(`❌ [Batch ${importId}] Error notifying company ${companyId}:`, error.message);
    }
  }
  
  // Log batch completion activity
  try {
    await logActivity({
      type: ActivityType.IMPORT_BATCH_COMPLETE,
      userId: batch.userId || null,
      userEmail: batch.userEmail || 'system',
      userRole: 'system',
      action: `Import batch completed: ${batch.successfulJobs}/${batch.totalJobs} successful, ${totalNotificationsSent} notifications queued`,
      details: {
        importId,
        totalJobs: batch.totalJobs,
        successfulJobs: batch.successfulJobs,
        failedJobs: batch.failedJobs,
        documentsCreated: batch.documents.length,
        companiesNotified: batch.companyDocuments.size,
        notificationsQueued: totalNotificationsSent,
        processingTimeMs: processingTime,
        source: batch.source
      },
      ipAddress: 'system',
      userAgent: 'batch-notification-service'
    });
  } catch (logError) {
    console.error(`[Batch ${importId}] Failed to log activity:`, logError.message);
  }
  
  // Send admin summary email
  try {
    await sendAdminSummaryEmail(importId, batch, processingTime, totalNotificationsSent);
  } catch (adminEmailError) {
    console.error(`[Batch ${importId}] Failed to send admin summary email:`, adminEmailError.message);
  }
  
  console.log(`[Batch ${importId}] Batch complete! ${batch.successfulJobs} documents processed, ${totalNotificationsSent} notifications queued (${processingTime}ms)`);
}

/**
 * Send summary email to global administrators
 * @param {string} importId - Import batch ID
 * @param {Object} batch - Batch data
 * @param {number} processingTime - Processing time in ms
 * @param {number} notificationsSent - Number of user notifications sent
 */
async function sendAdminSummaryEmail(importId, batch, processingTime, notificationsSent) {
  const settings = await Settings.getSettings();
  
  if (!isEmailEnabled(settings)) {
    console.log(`[Batch ${importId}] Email not enabled, skipping admin summary`);
    return;
  }
  
  // Find all global admin users
  const globalAdmins = await User.findAll({
    where: {
      role: 'global_admin',
      isActive: true
    }
  });
  
  if (globalAdmins.length === 0) {
    console.log(`[Batch ${importId}] No global admins found, skipping summary email`);
    return;
  }
  
  // Count unallocated documents (those without company assignment)
  const allocatedCount = batch.documents.length;
  const unallocatedCount = batch.successfulJobs - allocatedCount;
  
  // Format processing time
  const formatTime = (ms) => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  };
  
  // Build email content
  const subject = `Import Summary: ${batch.successfulJobs} of ${batch.totalJobs} documents processed`;
  
  const htmlContent = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #206bc4; margin-bottom: 20px;">Import Batch Summary</h2>
      
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
        <tr style="background: #f4f6fa;">
          <td style="padding: 12px; border: 1px solid #e0e0e0; font-weight: 600;">Total Files</td>
          <td style="padding: 12px; border: 1px solid #e0e0e0;">${batch.totalJobs}</td>
        </tr>
        <tr>
          <td style="padding: 12px; border: 1px solid #e0e0e0; font-weight: 600; color: #2fb344;">Successful</td>
          <td style="padding: 12px; border: 1px solid #e0e0e0; color: #2fb344;">${batch.successfulJobs}</td>
        </tr>
        <tr style="background: #f4f6fa;">
          <td style="padding: 12px; border: 1px solid #e0e0e0; font-weight: 600; color: #d63939;">Failed</td>
          <td style="padding: 12px; border: 1px solid #e0e0e0; color: #d63939;">${batch.failedJobs}</td>
        </tr>
        <tr>
          <td style="padding: 12px; border: 1px solid #e0e0e0; font-weight: 600; color: #206bc4;">Allocated (assigned to company)</td>
          <td style="padding: 12px; border: 1px solid #e0e0e0; color: #206bc4;">${allocatedCount}</td>
        </tr>
        <tr style="background: #f4f6fa;">
          <td style="padding: 12px; border: 1px solid #e0e0e0; font-weight: 600; color: #f59f00;">Unallocated (no company)</td>
          <td style="padding: 12px; border: 1px solid #e0e0e0; color: #f59f00;">${unallocatedCount}</td>
        </tr>
        <tr>
          <td style="padding: 12px; border: 1px solid #e0e0e0; font-weight: 600;">User Notifications Sent</td>
          <td style="padding: 12px; border: 1px solid #e0e0e0;">${notificationsSent}</td>
        </tr>
        <tr style="background: #f4f6fa;">
          <td style="padding: 12px; border: 1px solid #e0e0e0; font-weight: 600;">Processing Time</td>
          <td style="padding: 12px; border: 1px solid #e0e0e0;">${formatTime(processingTime)}</td>
        </tr>
        <tr>
          <td style="padding: 12px; border: 1px solid #e0e0e0; font-weight: 600;">Source</td>
          <td style="padding: 12px; border: 1px solid #e0e0e0;">${batch.source === 'ftp_scan' ? 'FTP/SFTP Scan' : batch.source === 'manual_upload' ? 'Manual Upload' : batch.source}</td>
        </tr>
      </table>
      
      ${unallocatedCount > 0 ? `
      <div style="background: #fff3cd; border: 1px solid #f59f00; border-radius: 4px; padding: 12px; margin-bottom: 20px;">
        <strong style="color: #856404;">Action Required:</strong> 
        <span style="color: #856404;">${unallocatedCount} document(s) could not be matched to a company and are in the Unallocated queue.</span>
      </div>
      ` : ''}
      
      ${batch.failedJobs > 0 ? `
      <div style="background: #f8d7da; border: 1px solid #d63939; border-radius: 4px; padding: 12px; margin-bottom: 20px;">
        <strong style="color: #721c24;">Warning:</strong> 
        <span style="color: #721c24;">${batch.failedJobs} document(s) failed to process. Check the activity logs for details.</span>
      </div>
      ` : ''}
      
      <p style="color: #667085; font-size: 12px; margin-top: 20px;">
        Import ID: ${importId}<br>
        Triggered by: ${batch.userEmail || 'System (scheduled scan)'}
      </p>
    </div>
  `;
  
  // Send to each global admin
  for (const admin of globalAdmins) {
    try {
      await sendEmail({
        to: admin.email,
        subject,
        html: htmlContent,
        text: `Import Summary\n\nTotal: ${batch.totalJobs}\nSuccessful: ${batch.successfulJobs}\nFailed: ${batch.failedJobs}\nAllocated: ${allocatedCount}\nUnallocated: ${unallocatedCount}\nProcessing Time: ${formatTime(processingTime)}`
      });
      console.log(`[Batch ${importId}] Admin summary sent to ${admin.email}`);
    } catch (error) {
      console.error(`[Batch ${importId}] Failed to send admin summary to ${admin.email}:`, error.message);
    }
  }
}

/**
 * Get batch status
 * @param {string} importId - Import batch ID
 * @returns {Object|null} Batch status or null if not found
 */
function getBatchStatus(importId) {
  if (!batchTracker.has(importId)) return null;
  
  const batch = batchTracker.get(importId);
  return {
    importId: batch.importId,
    totalJobs: batch.totalJobs,
    completedJobs: batch.completedJobs,
    successfulJobs: batch.successfulJobs,
    failedJobs: batch.failedJobs,
    documentsCreated: batch.documents.length,
    companiesAffected: batch.companyDocuments.size,
    elapsedMs: Date.now() - batch.startTime,
    source: batch.source
  };
}

/**
 * Get all active batches
 * @returns {Array} Array of batch statuses
 */
function getActiveBatches() {
  const batches = [];
  for (const [importId, batch] of batchTracker) {
    batches.push({
      importId,
      totalJobs: batch.totalJobs,
      completedJobs: batch.completedJobs,
      successfulJobs: batch.successfulJobs,
      failedJobs: batch.failedJobs,
      elapsedMs: Date.now() - batch.startTime,
      source: batch.source
    });
  }
  return batches;
}

/**
 * Force trigger notifications for a batch (admin use)
 * @param {string} importId - Import batch ID
 */
async function forceTriggerNotifications(importId) {
  if (!batchTracker.has(importId)) {
    throw new Error(`Batch ${importId} not found`);
  }
  
  const batch = batchTracker.get(importId);
  await sendBatchNotifications(importId, batch);
  batchTracker.delete(importId);
}

module.exports = {
  registerBatch,
  recordJobCompletion,
  sendBatchNotifications,
  getBatchStatus,
  getActiveBatches,
  forceTriggerNotifications
};

