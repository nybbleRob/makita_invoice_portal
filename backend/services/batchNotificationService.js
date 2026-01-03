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
const { renderTemplate, formatDate } = require('../utils/tablerEmailRenderer');
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
    // Ensure companyDocuments is always a plain object
    if (!batch.companyDocuments || typeof batch.companyDocuments !== 'object') {
      batch.companyDocuments = {};
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
    // Always use batch.companyDocuments (plain object) for saving
    // recordJobCompletion modifies companyDocuments directly, not companyDocumentsMap
    const batchToSave = {
      ...batch,
      companyDocuments: batch.companyDocuments || {}
    };
    // Remove the Map version - we only save the plain object
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
  
  if (!redis) {
    console.warn(`[Batch ${importId}] Redis not available, batch tracking disabled`);
    return;
  }
  
  const batchKey = `${BATCH_KEY_PREFIX}${importId}`;
  const lockKey = `${batchKey}:lock`;
  const maxRetries = 10;
  const lockTimeout = 5000; // 5 seconds
  
  // Use Redis-based lock to prevent race conditions
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Try to acquire lock with NX (only set if not exists) and PX (expire in ms)
      const lockAcquired = await redis.set(lockKey, Date.now().toString(), 'PX', lockTimeout, 'NX');
      
      if (!lockAcquired) {
        // Lock not acquired, wait and retry
        await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 100));
        continue;
      }
      
      try {
        // Lock acquired - now safe to read-modify-write
        const batch = await getBatch(importId);
        if (!batch) {
          console.error(`[Batch ${importId}] CRITICAL: Batch not found in Redis! Notifications will NOT be sent.`);
          return;
        }
        
        batch.completedJobs++;
        
        // #region agent log
        fetch('http://127.0.0.1:7244/ingest/a71118e4-5010-40f5-8a55-7b39cd0c3d75',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'batchNotificationService.js:166',message:'recordJobCompletion result',data:{documentId:result.documentId,companyId:result.companyId,documentType:result.documentType,success:result.success,fileName:result.fileName,hasDocId:!!result.documentId,hasCompanyId:!!result.companyId},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H1-H2'})}).catch(()=>{});
        // #endregion
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
            // companyDocuments is already a plain object - no conversion needed
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
        
        return; // Success - exit the retry loop
        
      } finally {
        // Always release lock
        await redis.del(lockKey);
      }
      
    } catch (error) {
      console.error(`[Batch ${importId}] Error in recordJobCompletion (attempt ${attempt + 1}):`, error.message);
      if (attempt === maxRetries - 1) {
        console.error(`[Batch ${importId}] Failed to record job completion after ${maxRetries} attempts`);
      }
    }
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
  
  // companyDocuments is a plain object: { companyId: { invoices: [], creditNotes: [], statements: [] } }
  const companyDocuments = batch.companyDocuments || {};
  const companyIds = Object.keys(companyDocuments);
  
  console.log(`[Batch ${importId}] Batch data: totalJobs=${batch.totalJobs}, successfulJobs=${batch.successfulJobs}, documents=${batch.documents?.length || 0}`);
  console.log(`[Batch ${importId}] Company documents object has ${companyIds.length} companies`);
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/a71118e4-5010-40f5-8a55-7b39cd0c3d75',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'batchNotificationService.js:267',message:'Batch complete - sending notifications',data:{totalJobs:batch.totalJobs,documentsCount:batch.documents?.length,companyCount:companyIds.length,companyDocuments:batch.companyDocuments,firstFewDocs:batch.documents?.slice(0,3)},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H3-H5'})}).catch(()=>{});
  // #endregion
  
  // Debug: log what companies have documents
  for (const cId of companyIds) {
    const cDocs = companyDocuments[cId];
    console.log(`[Batch ${importId}]   - Company ${cId}: ${cDocs.invoices?.length || 0} invoices, ${cDocs.creditNotes?.length || 0} credit notes`);
  }
  
  // Send user notifications if there are company documents
  if (companyIds.length === 0) {
    console.log(`[Batch ${importId}] No company documents to notify users about - documents may be unallocated or batch tracking failed`);
  } else {
    // Send notifications for each company
    for (const companyId of companyIds) {
      const docs = companyDocuments[companyId];
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
            fileUrl: inv.fileUrl
          })),
          creditNotes: creditNotes.map(cn => ({
            id: cn.id,
            creditNoteNumber: cn.creditNoteNumber,
            amount: cn.amount,
            date: cn.issueDate?.toISOString(),
            fileUrl: cn.fileUrl
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
 * Send summary email to global administrators (using Tabler template)
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
  
  // Render using Tabler template
  const html = renderTemplate('import-summary', {
    importDate: formatDate(new Date()),
    totalFiles: batch.totalJobs.toString(),
    successfulCount: batch.successfulJobs.toString(),
    failedCount: batch.failedJobs > 0 ? batch.failedJobs.toString() : '',
    allocatedCount: allocatedCount.toString(),
    unallocatedCount: unallocatedCount.toString(),
    duplicateCount: '', // Add if tracking duplicates
    importSource: sourceLabel,
    startTime: startTimeFormatted,
    endTime: endTimeFormatted,
    processingTime: formatTime(processingTime),
    retentionPeriod: (settings?.documentRetentionPeriod || 30).toString()
  }, settings);
  
  const subject = `Import Summary: ${batch.successfulJobs} of ${batch.totalJobs} documents processed`;
  
  // Send to each opted-in admin
  for (const admin of adminRecipients) {
    try {
      await sendEmail({
        to: admin.email,
        subject,
        html,
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
  
  // companyDocuments is already a plain object - no conversion needed
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
