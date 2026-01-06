/**
 * Email Job Processor
 * Processes email jobs from the email queue with:
 * - Smart SMTP error classification (4xx temp, 5xx permanent)
 * - Idempotency via EmailLog status checks
 * - Activity Log integration for audit trail
 * - Clean logging (no body/base64)
 */

const { UnrecoverableError } = require('bullmq');
const Bottleneck = require('bottleneck');
const { sendEmail } = require('../utils/emailService');
const { Settings, EmailLog } = require('../models');
const { logActivity, ActivityType } = require('../services/activityLogger');
const {
  EMAIL_RATE_MAX_OFFICE365,
  EMAIL_RATE_DURATION_MS_OFFICE365,
  EMAIL_RATE_MAX_SMTP2GO,
  EMAIL_RATE_DURATION_MS_SMTP2GO,
  EMAIL_RATE_MAX_SMTP,
  EMAIL_RATE_DURATION_MS_SMTP,
  EMAIL_RATE_MAX_RESEND,
  EMAIL_RATE_DURATION_MS_RESEND,
  EMAIL_WORKER_CONCURRENCY_SMTP
} = require('../config/queue');

// Provider-specific rate limiters using Bottleneck reservoir
// Reservoir refresh pattern prevents minute-boundary batching (smooth distribution)
const rateLimiters = {
  office365: new Bottleneck({
    reservoir: EMAIL_RATE_MAX_OFFICE365,
    reservoirRefreshAmount: EMAIL_RATE_MAX_OFFICE365,
    reservoirRefreshInterval: EMAIL_RATE_DURATION_MS_OFFICE365,
    maxConcurrent: 10,
    minTime: 0 // Reservoir handles pacing
  }),
  smtp2go: new Bottleneck({
    reservoir: EMAIL_RATE_MAX_SMTP2GO,
    reservoirRefreshAmount: EMAIL_RATE_MAX_SMTP2GO,
    reservoirRefreshInterval: EMAIL_RATE_DURATION_MS_SMTP2GO,
    maxConcurrent: 20,
    minTime: 0
  }),
  smtp: new Bottleneck({
    reservoir: EMAIL_RATE_MAX_SMTP,
    reservoirRefreshAmount: EMAIL_RATE_MAX_SMTP,
    reservoirRefreshInterval: EMAIL_RATE_DURATION_MS_SMTP,
    maxConcurrent: EMAIL_WORKER_CONCURRENCY_SMTP || 10,
    minTime: 0 // Smooth 5 per 4 seconds = no minute clumps
  }),
  resend: new Bottleneck({
    reservoir: EMAIL_RATE_MAX_RESEND,
    reservoirRefreshAmount: EMAIL_RATE_MAX_RESEND,
    reservoirRefreshInterval: EMAIL_RATE_DURATION_MS_RESEND,
    maxConcurrent: 10,
    minTime: 0
  }),
  mailtrap: new Bottleneck({
    reservoir: EMAIL_RATE_MAX_SMTP,
    reservoirRefreshAmount: EMAIL_RATE_MAX_SMTP,
    reservoirRefreshInterval: EMAIL_RATE_DURATION_MS_SMTP,
    maxConcurrent: EMAIL_WORKER_CONCURRENCY_SMTP || 10,
    minTime: 0
  })
};

/**
 * Apply provider-specific rate limiting using Bottleneck
 * @param {string} provider - Email provider name
 * @returns {Promise<void>} Resolves when rate limit allows sending
 */
async function applyProviderRateLimit(provider) {
  const limiter = rateLimiters[provider] || rateLimiters.smtp;
  // Bottleneck handles waiting automatically - just wrap the send operation
  // This will be called before sendEmail, so we return a no-op here
  // The actual rate limiting happens when we wrap sendEmail with limiter.schedule()
  return Promise.resolve();
}

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
 * Enhanced for multiple email provider support (SMTP, Resend, SendGrid, Mailtrap, Office365)
 * @param {Error} error - The error to classify
 * @returns {Object} { type: 'TEMPORARY'|'PERMANENT'|'RATE_LIMITED'|'UNKNOWN', code: string|number|null }
 */
function classifySmtpError(error) {
  const responseCode = error.responseCode || extractResponseCode(error.message);
  const errorCode = error.code || '';
  const errorMessage = (error.message || '').toLowerCase();
  
  // Check for rate limiting patterns first (special handling)
  // Covers: Mailtrap, SendGrid, Mailgun, generic SMTP, Resend
  // 450 4.7.1 = temporary failure (defer), not permanent reject
  // "all recipients were rejected" = rate limit throttle, not invalid addresses
  const rateLimitPatterns = [
    /exceeded/i,
    /rate.?limit/i,
    /messages.per.*hour/i,
    /too many/i,
    /too many emails/i,
    /quota exceeded/i,
    /sending.?limit/i,
    /throttl/i,
    /429/,  // HTTP 429 Too Many Requests (API-based providers)
    /daily.?limit/i,
    /4\.7\.1/i,  // SMTP 450 4.7.1 throttle error
    /450.*4\.7\.1/i  // Explicit 450 4.7.1 pattern
  ];
  for (const pattern of rateLimitPatterns) {
    if (pattern.test(error.message)) {
      return { type: 'RATE_LIMITED', code: responseCode || 450 };
    }
  }
  
  // Also check for 450 response code with "exceeded" or "rate" in message
  if (responseCode === 450 && (errorMessage.includes('exceeded') || errorMessage.includes('rate'))) {
    return { type: 'RATE_LIMITED', code: 450 };
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
  const transientCodes = [
    'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN', 'ENOTFOUND', 
    'ECONNREFUSED', 'ESOCKET', 'EPIPE', 'EHOSTUNREACH',
    'ENETUNREACH', 'EPROTO', 'ECONNABORTED'
  ];
  if (transientCodes.includes(errorCode.toUpperCase())) {
    return { type: 'TEMPORARY', code: errorCode };
  }
  
  // Check message for transient patterns (expanded for multiple providers)
  const transientPatterns = [
    'timeout', 'connection', 'network', 'temporarily', 'try again',
    'service unavailable', 'busy', 'overload', 'please retry',
    'server too busy', 'temporary failure', 'system not available',
    'resources temporarily unavailable', 'connection refused'
  ];
  for (const pattern of transientPatterns) {
    if (errorMessage.includes(pattern)) {
      return { type: 'TEMPORARY', code: errorCode || 'NETWORK' };
    }
  }
  
  // Check message for permanent patterns (expanded for multiple providers)
  const permanentPatterns = [
    // Standard SMTP permanent errors
    'user unknown', 'mailbox not found', 'does not exist',
    'invalid recipient', 'rejected', 'blocked', 'blacklisted',
    'authentication failed', 'relay denied', 'not allowed',
    // Resend/SendGrid/API errors
    'invalid api key', 'unauthorized', 'forbidden',
    'domain not verified', 'sender not verified', 'unsubscribed',
    'invalid_email', 'email_invalid', 'bounced', 'complaint',
    // Office 365 specific
    'recipient rejected', 'mailbox unavailable', 'action not allowed',
    // General permanent errors
    'permanent', 'fatal', 'bad address', 'mailbox disabled',
    'no such user', 'user disabled', 'account disabled'
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
  const { emailLogId, to, cc, subject, html, text, attachments, settings, metadata } = job.data;
  
  // Handle batch recipients (array) or single recipient (string)
  const recipients = Array.isArray(to) ? to : [to];
  const ccRecipients = cc ? (Array.isArray(cc) ? cc : [cc]) : [];
  const isBatch = recipients.length > 1 || ccRecipients.length > 0;
  
  // Debug: log provider from job settings to trace email routing issues
  console.log(`[EmailJob ${job.id}] Settings provider: ${settings?.emailProvider?.provider || 'NOT SET IN JOB DATA'}`);
  
  // Log start (no body content)
  if (isBatch) {
    console.log(`[EmailJob ${job.id}] Processing batch email to ${recipients.length} recipients subject="${subject}"`);
  } else {
    console.log(`[EmailJob ${job.id}] Processing email to=${recipients[0]} subject="${subject}"`);
  }
  
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
    // ALWAYS fetch fresh settings to respect test mode changes
    // Test mode redirect needs to apply even to already-queued emails
    let emailSettings = await Settings.getSettings();
    
    // Merge any job-specific settings (like provider credentials from env vars)
    // but prioritize fresh settings for testMode
    if (settings?.emailProvider) {
      emailSettings = {
        ...emailSettings,
        emailProvider: {
          ...settings.emailProvider,
          // Always use fresh testMode from database
          testMode: emailSettings?.emailProvider?.testMode
        }
      };
    }
    
    // Get provider for rate limiting
    const provider = emailSettings?.emailProvider?.provider || 'smtp';
    const limiter = rateLimiters[provider] || rateLimiters.smtp;
    
    // Send email with Bottleneck rate limiting (smooth reservoir refresh, no minute clumps)
    // Bottleneck handles waiting automatically based on reservoir refresh
    const result = await limiter.schedule(() => sendEmail({
      to: isBatch && ccRecipients.length === 0 ? recipients : recipients[0], // If CC exists, use single TO
      cc: ccRecipients.length > 0 ? ccRecipients : undefined, // CC recipients if provided
      subject,
      html,
      text,
      attachments
    }, emailSettings));
    
    // Update EmailLog on success
    if (emailLogId) {
      await EmailLog.update({
        status: 'SENT',
        messageId: result.messageId,
        sentAt: new Date(),
        provider: result.provider,
        lastError: null,
        errorCode: null,
        errorType: null,
        recipientCount: isBatch ? (recipients.length + (ccRecipients.length || 0)) : (ccRecipients.length > 0 ? 1 + ccRecipients.length : null)
      }, { where: { id: emailLogId } });
    }
    
    // Log to Activity Logs (visible at /activity-logs)
    const recipientDisplay = isBatch ? `${recipients.length} recipients` : recipients[0];
    await logActivity({
      type: ActivityType.EMAIL_SENT,
      userId: metadata?.userId || null,
      userEmail: metadata?.userEmail || 'system',
      userRole: metadata?.userRole || null,
      action: `Email sent to ${recipientDisplay}: "${subject}"`,
      details: {
        emailLogId: emailLogId || null,
        to: isBatch ? recipients : recipients[0],
        recipientCount: isBatch ? recipients.length : 1,
        subject,
        messageId: result.messageId,
        provider: result.provider,
        jobId: job.id,
        attempts: job.attemptsMade + 1,
        isBatch: isBatch
      },
      companyId: metadata?.companyId || null,
      companyName: metadata?.companyName || null
    });
    
    // Clean log (no body)
    if (isBatch) {
      console.log(`✅ [${job.id}] SENT batch to ${recipients.length} recipients messageId=${result.messageId} provider=${result.provider}`);
    } else {
      console.log(`✅ [${job.id}] SENT to=${recipients[0]} messageId=${result.messageId} provider=${result.provider}`);
    }
    
    // Log batch statistics for monitoring
    if (isBatch && result.recipientCount) {
      console.log(`📊 [${job.id}] Batch email stats: ${result.recipientCount} recipients, provider=${result.provider}`);
    }
    
    return {
      success: true,
      messageId: result.messageId,
      to: isBatch ? recipients : recipients[0],
      recipientCount: isBatch ? recipients.length : 1,
      subject,
      provider: result.provider,
      emailLogId,
      isBatch: isBatch
    };
    
  } catch (error) {
    // Classify the error
    const { type, code } = classifySmtpError(error);
    
    // Define recipient display for error logging
    const recipientDisplay = isBatch ? `${recipients.length} recipients` : recipients[0];
    
    // Clean log (no body, just classification)
    console.error(`❌ [${job.id}] FAILED to=${recipientDisplay} code=${code} type=${type} msg="${error.message}"`);
    
    if (type === 'PERMANENT') {
      // Update EmailLog for permanent failure
      if (emailLogId) {
        await EmailLog.update({
          status: 'FAILED_PERMANENT',
          lastError: error.message.substring(0, 1000), // Truncate long errors
          errorCode: String(code),
          errorType: type,
          recipientCount: isBatch ? (recipients.length + (ccRecipients.length || 0)) : (ccRecipients.length > 0 ? 1 + ccRecipients.length : null)
        }, { where: { id: emailLogId } });
      }
      
      // Log permanent failure to Activity Logs
      await logActivity({
        type: ActivityType.EMAIL_FAILED,
        userId: metadata?.userId || null,
        userEmail: metadata?.userEmail || 'system',
        userRole: metadata?.userRole || null,
        action: `Email permanently failed to ${recipientDisplay}: "${subject}"`,
        details: {
          emailLogId: emailLogId || null,
          to: isBatch ? recipients : recipients[0],
          recipientCount: isBatch ? recipients.length : 1,
          subject,
          errorCode: code,
          errorType: type,
          errorMessage: error.message.substring(0, 500),
          jobId: job.id,
          attempts: job.attemptsMade + 1,
          isBatch: isBatch
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
        errorType: type,
        recipientCount: isBatch ? (recipients.length + (ccRecipients.length || 0)) : (ccRecipients.length > 0 ? 1 + ccRecipients.length : null)
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
