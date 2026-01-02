/**
 * Email Queue Utility
 * Provides a simple interface for queuing emails with:
 * - Idempotency via deterministic job IDs
 * - EmailLog tracking for status monitoring
 * - Configurable retry with exponential backoff
 * Updated for BullMQ
 */

const { emailQueue, defaultEmailOptions } = require('../config/queue');
const { Settings, EmailLog } = require('../models');

/**
 * Queue an email for sending with idempotency and tracking
 * @param {Object} options - Email options
 * @param {string} options.to - Recipient email address
 * @param {string} options.subject - Email subject
 * @param {string} options.html - HTML email body
 * @param {string} options.text - Plain text email body (optional)
 * @param {Array} options.attachments - Array of attachment objects (optional)
 * @param {string} options.templateName - Name of email template used (optional)
 * @param {Object} options.settings - Settings object (optional, will be fetched if not provided)
 * @param {Object} options.metadata - Additional metadata for logging (optional)
 *   - userId: User who triggered the email
 *   - userEmail: Email of the user
 *   - userRole: Role of the user
 *   - companyId: Related company ID
 *   - companyName: Related company name
 * @param {number} options.priority - Job priority (higher = more important, default: 0)
 * @returns {Promise<Object>} { job, emailLog }
 */
async function queueEmail(options) {
  const { 
    to, 
    subject, 
    html, 
    text, 
    attachments, 
    templateName,
    settings, 
    metadata = {}, 
    priority = 0 
  } = options;
  
  if (!to || !subject || !html) {
    throw new Error('Email queue: to, subject, and html are required');
  }
  
  let emailLog;
  try {
    // Create EmailLog record first for tracking and idempotency
    emailLog = await EmailLog.create({
      to,
      subject,
      templateName: templateName || null,
      status: 'QUEUED',
      maxAttempts: defaultEmailOptions.attempts || 10,
      userId: metadata.userId || null,
      userEmail: metadata.userEmail || null,
      companyId: metadata.companyId || null,
      companyName: metadata.companyName || null
    });
  } catch (dbError) {
    console.error(`[EmailQueue] Failed to create EmailLog for ${to}:`, dbError.message);
    throw dbError;
  }
  
  // Deterministic jobId prevents duplicate queue entries
  // Using underscore instead of colon to avoid issues with some systems
  const jobId = `email_${emailLog.id}`;
  
  try {
    // Update EmailLog with jobId
    await EmailLog.update({ jobId }, { where: { id: emailLog.id } });
  } catch (updateError) {
    console.error(`[EmailQueue] Failed to update EmailLog jobId:`, updateError.message);
    // Continue anyway - jobId update is not critical
  }
  
  // Get settings if not provided
  let emailSettings = settings;
  if (!emailSettings) {
    emailSettings = await Settings.getSettings();
  }
  
  // Add email to queue (BullMQ format: name, data, options)
  let job;
  try {
    job = await emailQueue.add('send-email', {
      emailLogId: emailLog.id,
      to,
      subject,
      html,
      text,
      attachments: attachments || [],
      settings: emailSettings,
      metadata: {
        ...metadata,
        emailLogId: emailLog.id
      }
    }, {
      jobId, // Deterministic ID prevents duplicates
      priority, // Higher priority emails are processed first
      attempts: defaultEmailOptions.attempts || 10,
      backoff: defaultEmailOptions.backoff || {
        type: 'exponential',
        delay: 60000 // 1 minute base, doubles each retry
      },
      removeOnComplete: defaultEmailOptions.removeOnComplete || {
        age: 7 * 24 * 3600,
        count: 5000
      },
      removeOnFail: defaultEmailOptions.removeOnFail || {
        age: 30 * 24 * 3600
      }
    });
  } catch (queueError) {
    console.error(`[EmailQueue] Failed to add job to queue for ${to}:`, queueError.message);
    // Update EmailLog to failed status
    await EmailLog.update({ status: 'FAILED_PERMANENT', lastError: queueError.message }, { where: { id: emailLog.id } });
    throw queueError;
  }
  
  console.log(`[EmailQueue] Queued email to ${to} (job ${job.id}, emailLog ${emailLog.id})`);
  
  return { job, emailLog };
}

/**
 * Queue an email without creating EmailLog (for backwards compatibility)
 * Use queueEmail() for new code - it provides idempotency and tracking
 * @deprecated Use queueEmail() instead
 */
async function queueEmailSimple(options) {
  const { to, subject, html, text, attachments, settings, metadata, priority = 0 } = options;
  
  if (!to || !subject || !html) {
    throw new Error('Email queue: to, subject, and html are required');
  }
  
  let emailSettings = settings;
  if (!emailSettings) {
    emailSettings = await Settings.getSettings();
  }
  
  const job = await emailQueue.add('send-email', {
    to,
    subject,
    html,
    text,
    attachments: attachments || [],
    settings: emailSettings,
    metadata: metadata || {}
  }, {
    priority,
    attempts: defaultEmailOptions.attempts || 10,
    backoff: defaultEmailOptions.backoff || {
      type: 'exponential',
      delay: 60000
    },
    removeOnComplete: defaultEmailOptions.removeOnComplete,
    removeOnFail: defaultEmailOptions.removeOnFail
  });
  
  console.log(`📧 Queued email to ${to} (job ${job.id})`);
  
  return job;
}

/**
 * Get email queue statistics
 * @returns {Promise<Object>} Queue statistics
 */
async function getEmailQueueStats() {
  if (!emailQueue) {
    return {
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0
    };
  }
  
  try {
    const counts = await emailQueue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed', 'wait');
    
    return {
      waiting: (counts.waiting || 0) + (counts.wait || 0),
      active: counts.active || 0,
      completed: counts.completed || 0,
      failed: counts.failed || 0,
      delayed: counts.delayed || 0,
      total: (counts.waiting || 0) + (counts.wait || 0) + (counts.active || 0) + (counts.completed || 0) + (counts.failed || 0) + (counts.delayed || 0)
    };
  } catch (error) {
    console.error('Error getting email queue stats:', error);
    return {
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
      error: error.message
    };
  }
}

/**
 * Get failed email jobs (for manual retry or inspection)
 * @param {number} limit - Maximum number of jobs to return
 * @returns {Promise<Array>} Array of failed job objects
 */
async function getFailedEmailJobs(limit = 50) {
  if (!emailQueue) {
    return [];
  }
  
  try {
    const failedJobs = await emailQueue.getJobs(['failed'], 0, limit - 1);
    return failedJobs.map(job => ({
      id: job.id,
      emailLogId: job.data.emailLogId || null,
      to: job.data.to,
      subject: job.data.subject,
      attemptsMade: job.attemptsMade,
      failedReason: job.failedReason,
      timestamp: job.timestamp,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn
    }));
  } catch (error) {
    console.error('Error getting failed email jobs:', error);
    return [];
  }
}

/**
 * Retry a failed email job
 * @param {string} jobId - The job ID to retry
 * @returns {Promise<Object>} The retried job
 */
async function retryFailedEmailJob(jobId) {
  if (!emailQueue) {
    throw new Error('Email queue not available');
  }
  
  try {
    const job = await emailQueue.getJob(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }
    
    // If job has emailLogId, update status back to QUEUED
    if (job.data.emailLogId) {
      await EmailLog.update(
        { status: 'QUEUED', lastError: null },
        { where: { id: job.data.emailLogId } }
      );
    }
    
    await job.retry();
    console.log(`🔄 Retrying email job ${jobId}`);
    
    return job;
  } catch (error) {
    console.error(`Error retrying email job ${jobId}:`, error);
    throw error;
  }
}

/**
 * Get EmailLog entries with pagination
 * @param {Object} options - Query options
 * @param {number} options.page - Page number (default: 1)
 * @param {number} options.limit - Items per page (default: 50)
 * @param {string} options.status - Filter by status
 * @param {string} options.to - Filter by recipient
 * @returns {Promise<Object>} { logs, pagination }
 */
async function getEmailLogs(options = {}) {
  const { page = 1, limit = 50, status, to } = options;
  
  const where = {};
  if (status) where.status = status;
  if (to) where.to = { [require('sequelize').Op.iLike]: `%${to}%` };
  
  const { count, rows } = await EmailLog.findAndCountAll({
    where,
    order: [['createdAt', 'DESC']],
    limit,
    offset: (page - 1) * limit
  });
  
  return {
    logs: rows,
    pagination: {
      page,
      limit,
      total: count,
      pages: Math.ceil(count / limit)
    }
  };
}

module.exports = {
  queueEmail,
  queueEmailSimple,
  getEmailQueueStats,
  getFailedEmailJobs,
  retryFailedEmailJob,
  getEmailLogs
};
