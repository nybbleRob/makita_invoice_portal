/**
 * Email Job Processor
 * Processes email jobs from the email queue with:
 * - Smart SMTP error classification (4xx temp, 5xx permanent)
 * - Idempotency via EmailLog status checks
 * - Activity Log integration for audit trail
 * - Clean logging (no body/base64)
 */

const { UnrecoverableError } = require('bullmq');
const { sendEmail } = require('../utils/emailService');
const { Settings, EmailLog } = require('../models');
const { logActivity, ActivityType } = require('../services/activityLogger');

/**
 * Extract SMTP response code from error message
 * @param {string} message - Error message
 * @returns {number|null} SMTP code or null
 */
function extractResponseCode(message) {
  if (!message) return null;
  
  // Match patterns like "450 4.7.1" or "550 5.1.1" or just "450"
  const match = message.match(/\b([45]\d{2})\b/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Classify SMTP/network error for retry decisions
 * @param {Error} error - The error to classify
 * @returns {Object} { type: 'TEMPORARY'|'PERMANENT'|'RATE_LIMITED'|'UNKNOWN', code: string|number|null }
 */
function classifySmtpError(error) {
  const responseCode = error.responseCode || extractResponseCode(error.message);
  const errorCode = error.code || '';
  const errorMessage = (error.message || '').toLowerCase();
  
  // Check for rate limiting patterns first (special handling)
  if (/exceeded|rate.?limit|messages.per.*hour|too many/i.test(error.message)) {
    return { type: 'RATE_LIMITED', code: responseCode || 450 };
  }
  
  // PERMANENT failures (5xx) - do not retry
  if (responseCode >= 500 && responseCode < 600) {
    return { type: 'PERMANENT', code: responseCode };
  }
  
  // TEMPORARY failures (4xx) - retry with backoff
  if (responseCode >= 400 && responseCode < 500) {
    return { type: 'TEMPORARY', code: responseCode };
  }
  
  // Network/connection errors - retry
  const transientCodes = ['ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN', 'ENOTFOUND', 'ECONNREFUSED', 'ESOCKET'];
  if (transientCodes.includes(errorCode.toUpperCase())) {
    return { type: 'TEMPORARY', code: errorCode };
  }
  
  // Check message for transient patterns
  const transientPatterns = ['timeout', 'connection', 'network', 'temporarily', 'try again'];
  for (const pattern of transientPatterns) {
    if (errorMessage.includes(pattern)) {
      return { type: 'TEMPORARY', code: errorCode || 'NETWORK' };
    }
  }
  
  // Check message for permanent patterns
  const permanentPatterns = [
    'user unknown', 'mailbox not found', 'does not exist',
    'invalid recipient', 'rejected', 'blocked', 'blacklisted',
    'authentication failed', 'relay denied', 'not allowed'
  ];
  for (const pattern of permanentPatterns) {
    if (errorMessage.includes(pattern)) {
      return { type: 'PERMANENT', code: responseCode || 550 };
    }
  }
  
  // Default to unknown (will be treated as temporary for safety)
  return { type: 'UNKNOWN', code: null };
}

/**
 * Process a single email job
 * @param {Object} job - BullMQ job object
 * @returns {Promise<Object>} Email result
 */
async function processEmailJob(job) {
  const { emailLogId, to, subject, html, text, attachments, settings, metadata } = job.data;
  
  // Debug: log provider from job settings to trace email routing issues
  console.log(`[EmailJob ${job.id}] Settings provider: ${settings?.emailProvider?.provider || 'NOT SET IN JOB DATA'}`);
  
  // Log start (no body content)
  console.log(`[EmailJob ${job.id}] Processing email to=${to} subject="${subject}"`);
  
  // If we have an emailLogId, check for idempotency
  let emailLog = null;
  if (emailLogId) {
    emailLog = await EmailLog.findByPk(emailLogId);
    if (emailLog?.status === 'SENT') {
      console.log(`📧 [${job.id}] Already sent (idempotency check), skipping`);
      return { alreadySent: true, to, subject, emailLogId };
    }
    
    // Update status to SENDING
    await EmailLog.update(
      { status: 'SENDING', attempts: job.attemptsMade + 1 },
      { where: { id: emailLogId } }
    );
  }
  
  try {
    // Get settings if not provided
    let emailSettings = settings;
    if (!emailSettings) {
      emailSettings = await Settings.getSettings();
    }
    
    // Send email
    const result = await sendEmail({
      to,
      subject,
      html,
      text,
      attachments
    }, emailSettings);
    
    // Update EmailLog on success
    if (emailLogId) {
      await EmailLog.update({
        status: 'SENT',
        messageId: result.messageId,
        sentAt: new Date(),
        provider: result.provider,
        lastError: null,
        errorCode: null,
        errorType: null
      }, { where: { id: emailLogId } });
    }
    
    // Log to Activity Logs (visible at /activity-logs)
    await logActivity({
      type: ActivityType.EMAIL_SENT,
      userId: metadata?.userId || null,
      userEmail: metadata?.userEmail || 'system',
      userRole: metadata?.userRole || null,
      action: `Email sent to ${to}: "${subject}"`,
      details: {
        emailLogId: emailLogId || null,
        to,
        subject,
        messageId: result.messageId,
        provider: result.provider,
        jobId: job.id,
        attempts: job.attemptsMade + 1
      },
      companyId: metadata?.companyId || null,
      companyName: metadata?.companyName || null
    });
    
    // Clean log (no body)
    console.log(`✅ [${job.id}] SENT to=${to} messageId=${result.messageId}`);
    
    return {
      success: true,
      messageId: result.messageId,
      to,
      subject,
      provider: result.provider,
      emailLogId
    };
    
  } catch (error) {
    // Classify the error
    const { type, code } = classifySmtpError(error);
    
    // Clean log (no body, just classification)
    console.error(`❌ [${job.id}] FAILED to=${to} code=${code} type=${type} msg="${error.message}"`);
    
    if (type === 'PERMANENT') {
      // Update EmailLog for permanent failure
      if (emailLogId) {
        await EmailLog.update({
          status: 'FAILED_PERMANENT',
          lastError: error.message.substring(0, 1000), // Truncate long errors
          errorCode: String(code),
          errorType: type
        }, { where: { id: emailLogId } });
      }
      
      // Log permanent failure to Activity Logs
      await logActivity({
        type: ActivityType.EMAIL_FAILED,
        userId: metadata?.userId || null,
        userEmail: metadata?.userEmail || 'system',
        userRole: metadata?.userRole || null,
        action: `Email permanently failed to ${to}: "${subject}"`,
        details: {
          emailLogId: emailLogId || null,
          to,
          subject,
          errorCode: code,
          errorType: type,
          errorMessage: error.message.substring(0, 500),
          jobId: job.id,
          attempts: job.attemptsMade + 1
        },
        companyId: metadata?.companyId || null,
        companyName: metadata?.companyName || null
      });
      
      // Throw UnrecoverableError to stop retries
      throw new UnrecoverableError(`Permanent failure (${code}): ${error.message}`);
    }
    
    // TEMPORARY, RATE_LIMITED, or UNKNOWN - update and let BullMQ retry
    if (emailLogId) {
      await EmailLog.update({
        status: 'DEFERRED',
        lastError: error.message.substring(0, 1000),
        errorCode: String(code),
        errorType: type
      }, { where: { id: emailLogId } });
    }
    
    // Note: Don't log deferred emails to Activity Logs (too noisy)
    // Only final SENT/FAILED_PERMANENT states are logged
    
    // Throw error so BullMQ retries with exponential backoff
    throw error;
  }
}

module.exports = {
  processEmailJob,
  classifySmtpError,
  extractResponseCode
};
