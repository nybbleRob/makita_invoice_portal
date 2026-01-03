/**
 * Batch Notification Service
 * Tracks import batches and triggers email notifications when all files in a batch are processed
 * 
 * IMPORTANT: Uses Redis for batch tracking so it works across backend and queue worker processes
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
const { wrapEmailContent } = require('../utils/emailTheme');
const { Op } = require('sequelize');
const { redis } = require('../config/redis');

// Redis key prefix for batch tracking
const BATCH_KEY_PREFIX = 'batch:notification:';
const BATCH_TTL = 60 * 60; // 1 hour in seconds

/**
 * Get batch data from Redis
 * @param {string} importId - Import batch ID
 * @returns {Object|null} Batch data or null if not found
 */
async function getBatch(importId) {
  if (!redis) return null;
  
  try {
    const data = await redis.get(`${BATCH_KEY_PREFIX}${importId}`);
    if (!data) return null;
    
    const batch = JSON.parse(data);
    // Convert companyDocuments back to Map-like structure for compatibility
    if (batch.companyDocuments && typeof batch.companyDocuments === 'object') {
      batch.companyDocumentsMap = new Map(Object.entries(batch.companyDocuments));
    } else {
      batch.companyDocumentsMap = new Map();
    }
    return batch;
  } catch (error) {
    console.error(`[Batch] Error getting batch ${importId}:`, error.message);
    return null;
  }
}

/**
 * Save batch data to Redis
 * @param {string} importId - Import batch ID
 * @param {Object} batch - Batch data
 */
async function saveBatch(importId, batch) {
  if (!redis) return;
  
  try {
    // Convert Map to plain object for JSON serialization
    const batchToSave = {
      ...batch,
      companyDocuments: batch.companyDocumentsMap 
        ? Object.fromEntries(batch.companyDocumentsMap)
        : (batch.companyDocuments instanceof Map 
            ? Object.fromEntries(batch.companyDocuments)
            : batch.companyDocuments || {})
    };
    delete batchToSave.companyDocumentsMap;
    
    await redis.setex(`${BATCH_KEY_PREFIX}${importId}`, BATCH_TTL, JSON.stringify(batchToSave));
  } catch (error) {
    console.error(`[Batch] Error saving batch ${importId}:`, error.message);
  }
}

/**
 * Delete batch from Redis
 * @param {string} importId - Import batch ID
 */
async function deleteBatch(importId) {
  if (!redis) return;
  
  try {
    await redis.del(`${BATCH_KEY_PREFIX}${importId}`);
  } catch (error) {
    console.error(`[Batch] Error deleting batch ${importId}:`, error.message);
  }
}

/**
 * Register a new batch import
 * @param {string} importId - Unique import batch ID
 * @param {number} totalJobs - Total number of jobs in this batch
 * @param {Object} options - Additional options
 */
async function registerBatch(importId, totalJobs, options = {}) {
  if (!importId || totalJobs <= 0) return;
  
  if (!redis) {
    console.warn(`[Batch ${importId}] Redis not available, batch tracking disabled`);
    return;
  }
  
  console.log(`[Batch ${importId}] Registering batch with ${totalJobs} jobs`);
  
  const batch = {
    importId,
    totalJobs,
    completedJobs: 0,
    successfulJobs: 0,
    failedJobs: 0,
    documents: [],
    companyDocuments: {}, // Plain object for JSON serialization
    startTime: Date.now(),
    userId: options.userId,
    userEmail: options.userEmail,
    source: options.source || 'unknown'
  };
  
  await saveBatch(importId, batch);
  console.log(`[Batch ${importId}] Batch registered successfully (TTL: ${BATCH_TTL}s)`);
}

/**
 * Record completion of a job in a batch
 * @param {string} importId - Import batch ID
 * @param {Object} result - Job result
 */
async function recordJobCompletion(importId, result) {
  if (!importId) {
    console.log(`[Batch] recordJobCompletion called without importId, skipping`);
    return;
  }
  
  console.log(`[Batch ${importId}] Recording job completion: success=${result.success}, documentId=${result.documentId}, companyId=${result.companyId}, fileName=${result.fileName}`);
  
  const batch = await getBatch(importId);
  if (!batch) {
    // This is a problem - means batch was never registered or expired before jobs completed
    console.error(`[Batch ${importId}] CRITICAL: Batch not found in Redis! Jobs completed before batch was registered. Notifications will NOT be sent.`);
    return;
  }
  
  batch.completedJobs++;
  
  if (result.success) {
    batch.successfulJobs++;
    
    // Track document if created and assigned to a company
    if (result.documentId && result.companyId) {
      console.log(`[Batch ${importId}] Tracking document ${result.documentId} (type=${result.documentType}) for company ${result.companyId}`);
      const docInfo = {
        id: result.documentId,
        type: result.documentType,
        companyId: result.companyId,
        fileName: result.fileName,
        invoiceNumber: result.invoiceNumber,
        amount: result.amount
      };
      
      batch.documents.push(docInfo);
      
      // Group by company (using plain object)
      const companyId = result.companyId;
      if (!batch.companyDocuments[companyId]) {
        batch.companyDocuments[companyId] = {
          invoices: [],
          creditNotes: [],
          statements: []
        };
      }
      
      const companyDocs = batch.companyDocuments[companyId];
      if (result.documentType === 'invoice') {
        companyDocs.invoices.push(docInfo);
      } else if (result.documentType === 'credit_note') {
        companyDocs.creditNotes.push(docInfo);
      } else if (result.documentType === 'statement') {
        companyDocs.statements.push(docInfo);
      }
    } else {
      // Document not tracked - either unallocated (no companyId) or no document created
      console.log(`[Batch ${importId}] Document NOT tracked: documentId=${result.documentId}, companyId=${result.companyId}, status=${result.status}`);
    }
  } else {
    batch.failedJobs++;
    console.log(`[Batch ${importId}] Job failed: ${result.error || 'Unknown error'}`);
  }
  
  console.log(`[Batch ${importId}] Progress: ${batch.completedJobs}/${batch.totalJobs} (${batch.successfulJobs} success, ${batch.failedJobs} failed)`);
  
  // Check if batch is complete
  if (batch.completedJobs >= batch.totalJobs) {
    console.log(`[Batch ${importId}] All jobs complete! Triggering notifications...`);
    
    try {
      // Convert companyDocuments to Map for sendBatchNotifications
      batch.companyDocumentsMap = new Map(Object.entries(batch.companyDocuments));
      await sendBatchNotifications(importId, batch);
    } catch (error) {
      console.error(`[Batch ${importId}] Error sending notifications:`, error.message);
    } finally {
      // Clean up batch from Redis
      await deleteBatch(importId);
    }
  } else {
    // Save updated batch
    await saveBatch(importId, batch);
  }
}

/**
 * Send notifications for a completed batch
 * @param {string} importId - Import batch ID
 * @param {Object} batch - Batch data
 */
async function sendBatchNotifications(importId, batch) {
  const settings = await Settings.getSettings();
  const processingTime = Date.now() - batch.startTime;
  let totalNotificationsSent = 0;
  
  // Check if email is enabled (Mailtrap = test mode, always enabled)
  if (!isEmailEnabled(settings)) {
    console.log(`[Batch ${importId}] Email not enabled, skipping all notifications`);
    return;
  }
  
  // Get companyDocuments as Map
  const companyDocuments = batch.companyDocumentsMap || new Map(Object.entries(batch.companyDocuments || {}));
  
  console.log(`[Batch ${importId}] Batch data: totalJobs=${batch.totalJobs}, successfulJobs=${batch.successfulJobs}, documents=${batch.documents?.length || 0}`);
  console.log(`[Batch ${importId}] Company documents map has ${companyDocuments.size} companies`);
  
  // Debug: log what companies have documents
  for (const [cId, cDocs] of companyDocuments) {
    console.log(`[Batch ${importId}]   - Company ${cId}: ${cDocs.invoices?.length || 0} invoices, ${cDocs.creditNotes?.length || 0} credit notes`);
  }
  
  // Send user notifications if there are company documents
  if (companyDocuments.size === 0) {
    console.log(`[Batch ${importId}] No company documents to notify users about - documents may be unallocated or batch tracking failed`);
  } else {
    // Send notifications for each company
    for (const [companyId, docs] of companyDocuments) {
      try {
        const company = await Company.findByPk(companyId);
        if (!company) {
          console.warn(`[Batch ${importId}] Company ${companyId} not found, skipping`);
          continue;
        }
        
        // Skip EDI companies (they don't receive email notifications)
        if (company.edi) {
          console.log(`[Batch ${importId}] Company ${company.name} has EDI enabled, skipping email notifications`);
          continue;
        }
        
        // Fetch full document objects for notification
        const invoices = docs.invoices && docs.invoices.length > 0 
          ? await Invoice.findAll({ where: { id: { [Op.in]: docs.invoices.map(d => d.id) } } })
          : [];
        
        const creditNotes = docs.creditNotes && docs.creditNotes.length > 0
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
        console.log(`[Batch ${importId}] Queued ${result.emailsQueued} notifications for ${company.name}`);
        
      } catch (error) {
        console.error(`[Batch ${importId}] Error notifying company ${companyId}:`, error.message);
      }
    }
  }
  
  // Log batch completion activity (always, regardless of notifications)
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
        companiesNotified: companyDocuments.size,
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
  
  // Find all global admin and administrator users who have opted-in to receive import summary reports
  const adminRecipients = await User.findAll({
    where: {
      role: { [Op.in]: ['global_admin', 'administrator'] },
      isActive: true,
      sendImportSummaryReport: true
    }
  });
  
  if (adminRecipients.length === 0) {
    console.log(`[Batch ${importId}] No admins with sendImportSummaryReport=true found, skipping summary email`);
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
  
  // Format timestamps
  const startTimeFormatted = new Date(batch.startTime).toLocaleString('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short'
  });
  const endTimeFormatted = new Date().toLocaleString('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short'
  });
  
  // Determine source label
  const sourceLabel = batch.source === 'ftp_scan' || batch.source === 'ftp-scan' 
    ? 'FTP/SFTP Scheduled Scan' 
    : batch.source === 'manual-upload' 
      ? 'Manual Upload' 
      : batch.source || 'System';
  
  // Build email content
  const subject = `Import Summary: ${batch.successfulJobs} of ${batch.totalJobs} documents processed`;
  
  const htmlContent = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #206bc4; margin-bottom: 20px;">Import Batch Summary</h2>
      
      <h3 style="color: #495057; margin-bottom: 12px; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px;">Timing</h3>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
        <tr style="background: #f4f6fa;">
          <td style="padding: 12px; border: 1px solid #e0e0e0; font-weight: 600;">Import Started</td>
          <td style="padding: 12px; border: 1px solid #e0e0e0;">${startTimeFormatted}</td>
        </tr>
        <tr>
          <td style="padding: 12px; border: 1px solid #e0e0e0; font-weight: 600;">Import Finished</td>
          <td style="padding: 12px; border: 1px solid #e0e0e0;">${endTimeFormatted}</td>
        </tr>
        <tr style="background: #f4f6fa;">
          <td style="padding: 12px; border: 1px solid #e0e0e0; font-weight: 600;">Processing Time</td>
          <td style="padding: 12px; border: 1px solid #e0e0e0;">${formatTime(processingTime)}</td>
        </tr>
        <tr>
          <td style="padding: 12px; border: 1px solid #e0e0e0; font-weight: 600;">Source</td>
          <td style="padding: 12px; border: 1px solid #e0e0e0;">${sourceLabel}</td>
        </tr>
      </table>
      
      <h3 style="color: #495057; margin-bottom: 12px; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px;">Results</h3>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
        <tr style="background: #f4f6fa;">
          <td style="padding: 12px; border: 1px solid #e0e0e0; font-weight: 600;">Total Files Uploaded</td>
          <td style="padding: 12px; border: 1px solid #e0e0e0;">${batch.totalJobs}</td>
        </tr>
        <tr>
          <td style="padding: 12px; border: 1px solid #e0e0e0; font-weight: 600; color: #2fb344;">Successfully Processed</td>
          <td style="padding: 12px; border: 1px solid #e0e0e0; color: #2fb344;">${batch.successfulJobs}</td>
        </tr>
        <tr style="background: #f4f6fa;">
          <td style="padding: 12px; border: 1px solid #e0e0e0; font-weight: 600; color: #d63939;">Failed</td>
          <td style="padding: 12px; border: 1px solid #e0e0e0; color: #d63939;">${batch.failedJobs}</td>
        </tr>
        <tr>
          <td style="padding: 12px; border: 1px solid #e0e0e0; font-weight: 600; color: #206bc4;">Assigned to Company</td>
          <td style="padding: 12px; border: 1px solid #e0e0e0; color: #206bc4;">${allocatedCount}</td>
        </tr>
        <tr style="background: #f4f6fa;">
          <td style="padding: 12px; border: 1px solid #e0e0e0; font-weight: 600; color: #f59f00;">Unallocated</td>
          <td style="padding: 12px; border: 1px solid #e0e0e0; color: #f59f00;">${unallocatedCount}</td>
        </tr>
        <tr>
          <td style="padding: 12px; border: 1px solid #e0e0e0; font-weight: 600;">User Notifications Queued</td>
          <td style="padding: 12px; border: 1px solid #e0e0e0;">${notificationsSent}</td>
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
      
      <div style="background: #fff3cd; border: 1px solid #ffc107; border-radius: 4px; padding: 12px; margin-bottom: 20px;">
        <strong style="color: #856404;">Reminder:</strong> 
        <span style="color: #856404;">Documents are only available for ${settings?.documentRetentionPeriod || 30} days from the upload date as per the configured retention policy.</span>
      </div>
      
      <p style="color: #667085; font-size: 12px; margin-top: 20px;">
        Import ID: ${importId}<br>
        Triggered by: ${batch.userEmail || 'System (scheduled scan)'}
      </p>
    </div>
  `;
  
  // Wrap HTML content with email theme (branding, header, footer)
  const themedHtml = wrapEmailContent(htmlContent, settings);
  
  // Send to each opted-in admin
  for (const admin of adminRecipients) {
    try {
      await sendEmail({
        to: admin.email,
        subject,
        html: themedHtml,
        text: `Import Summary

Timing:
- Import Started: ${startTimeFormatted}
- Import Finished: ${endTimeFormatted}
- Processing Time: ${formatTime(processingTime)}
- Source: ${sourceLabel}

Results:
- Total Files: ${batch.totalJobs}
- Successful: ${batch.successfulJobs}
- Failed: ${batch.failedJobs}
- Assigned: ${allocatedCount}
- Unallocated: ${unallocatedCount}
- Notifications Queued: ${notificationsSent}

${unallocatedCount > 0 ? 'Action Required: ' + unallocatedCount + ' document(s) could not be matched to a company.\n' : ''}
${batch.failedJobs > 0 ? 'Warning: ' + batch.failedJobs + ' document(s) failed to process.\n' : ''}

Import ID: ${importId}
Triggered by: ${batch.userEmail || 'System (scheduled scan)'}`
      }, settings);
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
async function getBatchStatus(importId) {
  const batch = await getBatch(importId);
  if (!batch) return null;
  
  return {
    importId: batch.importId,
    totalJobs: batch.totalJobs,
    completedJobs: batch.completedJobs,
    successfulJobs: batch.successfulJobs,
    failedJobs: batch.failedJobs,
    documentsCreated: batch.documents.length,
    companiesAffected: Object.keys(batch.companyDocuments || {}).length,
    elapsedMs: Date.now() - batch.startTime,
    source: batch.source
  };
}

/**
 * Get all active batches
 * @returns {Array} Array of batch statuses
 */
async function getActiveBatches() {
  if (!redis) return [];
  
  try {
    const keys = await redis.keys(`${BATCH_KEY_PREFIX}*`);
    const batches = [];
    
    for (const key of keys) {
      const importId = key.replace(BATCH_KEY_PREFIX, '');
      const status = await getBatchStatus(importId);
      if (status) batches.push(status);
    }
    
    return batches;
  } catch (error) {
    console.error('[Batch] Error getting active batches:', error.message);
    return [];
  }
}

/**
 * Force trigger notifications for a batch (admin use)
 * @param {string} importId - Import batch ID
 */
async function forceTriggerNotifications(importId) {
  const batch = await getBatch(importId);
  if (!batch) {
    throw new Error(`Batch ${importId} not found`);
  }
  
  // Convert companyDocuments to Map for sendBatchNotifications
  batch.companyDocumentsMap = new Map(Object.entries(batch.companyDocuments || {}));
  await sendBatchNotifications(importId, batch);
  await deleteBatch(importId);
}

module.exports = {
  registerBatch,
  recordJobCompletion,
  sendBatchNotifications,
  getBatchStatus,
  getActiveBatches,
  forceTriggerNotifications
};
