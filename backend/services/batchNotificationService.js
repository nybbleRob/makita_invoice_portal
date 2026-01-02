/**
 * Batch Notification Service
 * Tracks import batches and triggers email notifications when all files in a batch are processed
 * 
 * Flow:
 * 1. When a batch import starts (manual upload or FTP scan), registerBatch() is called
 * 2. As each job completes, recordJobCompletion() is called
 * 3. When all jobs in a batch are complete, sendBatchNotifications() is triggered
 */

const { Company, Invoice, CreditNote, File, Settings } = require('../models');
const { queueDocumentNotifications } = require('./documentNotificationService');
const { logActivity, ActivityType } = require('./activityLogger');
const { isEmailEnabled } = require('../utils/emailService');
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
    console.error(`⚠️  [Batch ${importId}] Failed to log activity:`, logError.message);
  }
  
  console.log(`✅ [Batch ${importId}] Batch complete! ${batch.successfulJobs} documents processed, ${totalNotificationsSent} notifications queued (${processingTime}ms)`);
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

