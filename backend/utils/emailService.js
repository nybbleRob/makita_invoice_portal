const nodemailer = require('nodemailer');
const axios = require('axios');

/**
 * Unified Email Service
 * Supports multiple email providers: SMTP, Office 365 (Microsoft Graph), Resend, SMTP2Go
 */

/**
 * Get email provider configuration from settings or environment variables
 * Priority: Environment variables > Database settings (for credentials)
 * Database settings are still used for non-sensitive config (enabled flag, fromEmail, etc.)
 */
function getEmailProviderConfig(settings) {
  // Priority: Database provider setting first, then environment variables (for credentials)
  // Only use env EMAIL_PROVIDER if database doesn't have a provider configured
  const dbProvider = settings?.emailProvider?.provider;
  const envProvider = process.env.EMAIL_PROVIDER;
  
  // Use database provider if set, otherwise fall back to env or default to 'smtp'
  const provider = dbProvider || envProvider || 'smtp';
  
  // If database has a provider configured, use it (respect database settings)
  // Only use env provider if database doesn't specify one
  if (provider === 'smtp') {
    // Use env vars for credentials, database for other config
    const dbConfig = settings?.emailProvider?.smtp || {};
    return {
      enabled: settings?.emailProvider?.enabled || (process.env.SMTP_HOST ? true : false),
      provider: 'smtp',
      smtp: {
        host: process.env.SMTP_HOST || dbConfig.host || '',
        port: parseInt(process.env.SMTP_PORT || dbConfig.port || '587'),
        secure: process.env.SMTP_SECURE === 'true' || dbConfig.secure || false,
        auth: {
          user: process.env.SMTP_USER || dbConfig.auth?.user || '',
          password: process.env.SMTP_PASSWORD || dbConfig.auth?.password || '' // Env var takes priority
        },
        fromEmail: process.env.SMTP_FROM_EMAIL || dbConfig.fromEmail || '',
        fromName: process.env.SMTP_FROM_NAME || dbConfig.fromName || 'Makita Invoice Portal',
        rejectUnauthorized: process.env.SMTP_REJECT_UNAUTHORIZED !== 'false' && (dbConfig.rejectUnauthorized !== false)
      }
    };
  }
  
  if (provider === 'office365') {
    // Use env vars for credentials, database for other config
    const dbConfig = settings?.emailProvider?.office365 || {};
    
    // Only enable if explicitly enabled in database OR if env vars are set AND database doesn't disable it
    const hasEnvVars = process.env.OFFICE365_TENANT_ID && process.env.OFFICE365_CLIENT_ID && process.env.OFFICE365_CLIENT_SECRET;
    const enabled = settings?.emailProvider?.enabled === true || (hasEnvVars && settings?.emailProvider?.enabled !== false);
    
    return {
      enabled: enabled,
      provider: 'office365',
      office365: {
        tenantId: process.env.OFFICE365_TENANT_ID || dbConfig.tenantId || '',
        clientId: process.env.OFFICE365_CLIENT_ID || dbConfig.clientId || '',
        clientSecret: process.env.OFFICE365_CLIENT_SECRET || dbConfig.clientSecret || '', // Env var takes priority
        fromEmail: process.env.OFFICE365_FROM_EMAIL || dbConfig.fromEmail || '',
        sendAsUser: process.env.OFFICE365_SEND_AS_USER || dbConfig.sendAsUser || ''
      }
    };
  }
  
  if (provider === 'resend') {
    // Use env vars for credentials, database for other config
    const dbConfig = settings?.emailProvider?.resend || {};
    return {
      enabled: settings?.emailProvider?.enabled || (process.env.RESEND_API_KEY ? true : false),
      provider: 'resend',
      resend: {
        apiKey: process.env.RESEND_API_KEY || dbConfig.apiKey || '', // Env var takes priority
        fromEmail: process.env.RESEND_FROM_EMAIL || dbConfig.fromEmail || '',
        fromName: process.env.RESEND_FROM_NAME || dbConfig.fromName || 'Makita Invoice Portal'
      }
    };
  }
  
  if (provider === 'smtp2go') {
    // Use env vars for credentials, database for other config
    const dbConfig = settings?.emailProvider?.smtp2go || {};
    return {
      enabled: settings?.emailProvider?.enabled || (process.env.SMTP2GO_API_KEY ? true : false),
      provider: 'smtp2go',
      smtp2go: {
        apiKey: process.env.SMTP2GO_API_KEY || dbConfig.apiKey || '', // Env var takes priority
        fromEmail: process.env.SMTP2GO_FROM_EMAIL || dbConfig.fromEmail || '',
        fromName: process.env.SMTP2GO_FROM_NAME || dbConfig.fromName || 'Makita Invoice Portal'
      }
    };
  }
  
  if (provider === 'mailtrap') {
    // Use env vars for credentials, database for other config
    const dbConfig = settings?.emailProvider?.mailtrap || {};
    return {
      enabled: settings?.emailProvider?.enabled || (process.env.MAILTRAP_USER ? true : false),
      provider: 'mailtrap',
      mailtrap: {
        host: process.env.MAILTRAP_HOST || dbConfig.host || 'sandbox.smtp.mailtrap.io',
        port: parseInt(process.env.MAILTRAP_PORT || dbConfig.port || '2525'),
        secure: dbConfig.secure || false,
        auth: {
          user: process.env.MAILTRAP_USER || dbConfig.auth?.user || '',
          password: process.env.MAILTRAP_PASSWORD || dbConfig.auth?.password || ''
        },
        fromEmail: process.env.MAILTRAP_FROM_EMAIL || dbConfig.fromEmail || '',
        fromName: process.env.MAILTRAP_FROM_NAME || dbConfig.fromName || 'Makita Invoice Portal',
        rejectUnauthorized: false
      }
    };
  }
  
  // Fallback to database if no env vars and database has config
  if (settings?.emailProvider?.enabled) {
    return settings.emailProvider;
  }
  
  return null;
}

/**
 * Send email using the configured provider
 * @param {Object} options - Email options
 * @param {string} options.to - Recipient email address
 * @param {string} options.subject - Email subject
 * @param {string} options.html - HTML email body
 * @param {string} options.text - Plain text email body (optional)
 * @param {Array} options.attachments - Array of attachment objects (optional)
 * @param {Object} settings - Settings object with email configuration
 * @returns {Promise<Object>} - Result object with success status and message
 */
async function sendEmail(options, settings) {
  const { to, subject, html, text, attachments = [] } = options;
  
  // Get provider config from database or environment
  const providerConfig = getEmailProviderConfig(settings);
  
  if (!providerConfig || !providerConfig.enabled) {
    const error = new Error('Email provider is not configured or enabled');
    throw error;
  }

  const provider = providerConfig.provider || 'smtp';
  const startTime = Date.now();

  try {
    let result;
    switch (provider) {
      case 'smtp':
        result = await sendViaSMTP(options, providerConfig.smtp);
        break;
      case 'office365':
        result = await sendViaOffice365(options, providerConfig.office365);
        break;
      case 'resend':
        result = await sendViaResend(options, providerConfig.resend);
        break;
      case 'smtp2go':
        result = await sendViaSMTP2Go(options, providerConfig.smtp2go);
        break;
      case 'mailtrap':
        // Mailtrap uses standard SMTP, reuse sendViaSMTP
        result = await sendViaSMTP(options, providerConfig.mailtrap);
        break;
      default:
        throw new Error(`Unsupported email provider: ${provider}`);
    }

    return result;
  } catch (error) {
    throw error;
  }
}

/**
 * Send email via standard SMTP
 */
async function sendViaSMTP(options, smtpConfig) {
  if (!smtpConfig || !smtpConfig.host) {
    throw new Error('SMTP configuration is incomplete');
  }

  // Normalize localhost to 127.0.0.1 to avoid IPv6 resolution issues on Windows
  let host = smtpConfig.host;
  if (host.toLowerCase() === 'localhost') {
    host = '127.0.0.1';
  }

  // For MailHog and local SMTP servers, don't require auth if username/password are empty
  const authConfig = {};
  const username = smtpConfig.auth?.user || smtpConfig.user || '';
  const password = smtpConfig.auth?.password || smtpConfig.password || '';
  
  // Only add auth if username and password are provided
  if (username && password) {
    authConfig.auth = {
      user: username,
      pass: password
    };
  }

  // For localhost/MailHog, disable TLS certificate validation
  const isLocalhost = host === '127.0.0.1' || host === 'localhost';
  
  const transporter = nodemailer.createTransport({
    host: host,
    port: smtpConfig.port || 587,
    secure: smtpConfig.secure || false, // true for 465, false for other ports
    ...authConfig,
    tls: {
      rejectUnauthorized: isLocalhost ? false : (smtpConfig.rejectUnauthorized !== false)
    },
    connectionTimeout: 10000, // 10 second timeout
    greetingTimeout: 10000,
    socketTimeout: 10000
  });

  const fromEmail = smtpConfig.fromEmail || smtpConfig.from;
  const fromName = smtpConfig.fromName || 'Invoice Portal';

  const mailOptions = {
    from: `"${fromName}" <${fromEmail}>`,
    to: options.to,
    subject: options.subject,
    html: options.html,
    text: options.text || options.html.replace(/<[^>]*>/g, ''), // Strip HTML for text version
    attachments: options.attachments || []
  };

  const result = await transporter.sendMail(mailOptions);
  
  // Store from email in options for logging
  options.from = fromEmail;
  
  return {
    success: true,
    messageId: result.messageId,
    provider: 'smtp',
    response: result.response,
    fromEmail: fromEmail
  };
}

/**
 * Send email via Office 365 (Microsoft Graph API)
 * Reference: https://learn.microsoft.com/en-us/graph/outlook-mail-concept-overview
 */
async function sendViaOffice365(options, config) {
  if (!config || !config.clientId || !config.clientSecret || !config.tenantId) {
    throw new Error('Office 365 configuration is incomplete');
  }

  // Get access token
  const tokenEndpoint = `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`;
  
  const tokenResponse = await axios.post(tokenEndpoint, new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials'
  }), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  });

  const accessToken = tokenResponse.data.access_token;

  // Prepare message
  const message = {
    message: {
      subject: options.subject,
      body: {
        contentType: 'HTML',
        content: options.html
      },
      toRecipients: [{
        emailAddress: {
          address: options.to
        }
      }]
    }
  };

  // Add attachments if provided
  if (options.attachments && options.attachments.length > 0) {
    message.message.attachments = await Promise.all(
      options.attachments.map(async (att) => {
        const fs = require('fs');
        const path = require('path');
        
        let contentBytes;
        if (att.path) {
          contentBytes = fs.readFileSync(att.path).toString('base64');
        } else if (att.content) {
          contentBytes = Buffer.from(att.content).toString('base64');
        } else {
          throw new Error('Attachment must have either path or content');
        }

        return {
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: att.filename || path.basename(att.path || 'attachment'),
          contentType: att.contentType || 'application/octet-stream',
          contentBytes: contentBytes
        };
      })
    );
  }

  // Send email via Microsoft Graph API
  // Use sendAsUser if provided, otherwise use fromEmail
  const userEmail = config.sendAsUser || config.fromEmail;
  if (!userEmail) {
    throw new Error('Office 365 fromEmail or sendAsUser is required');
  }

  const sendEndpoint = `https://graph.microsoft.com/v1.0/users/${userEmail}/sendMail`;

  const response = await axios.post(sendEndpoint, message, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  });

  // Store from email in options for logging
  options.from = userEmail;

  return {
    success: true,
    messageId: response.headers['x-request-id'] || 'unknown',
    provider: 'office365',
    response: response.data,
    fromEmail: userEmail
  };
}

/**
 * Send email via Resend API
 * Reference: https://resend.com/docs/api-reference/introduction
 */
async function sendViaResend(options, config) {
  if (!config || !config.apiKey) {
    throw new Error('Resend configuration is incomplete');
  }

  const payload = {
    from: config.fromEmail || 'onboarding@resend.dev',
    to: options.to,
    subject: options.subject,
    html: options.html,
    ...(options.text && { text: options.text })
  };

  // Add attachments if provided
  if (options.attachments && options.attachments.length > 0) {
    payload.attachments = await Promise.all(
      options.attachments.map(async (att) => {
        const fs = require('fs');
        const path = require('path');
        
        let content;
        if (att.path) {
          content = fs.readFileSync(att.path);
        } else if (att.content) {
          content = Buffer.from(att.content);
        } else {
          throw new Error('Attachment must have either path or content');
        }

        return {
          filename: att.filename || path.basename(att.path || 'attachment'),
          content: content.toString('base64'),
          ...(att.contentType && { type: att.contentType })
        };
      })
    );
  }

  const response = await axios.post('https://api.resend.com/emails', payload, {
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json'
    }
  });

  const fromEmail = config.fromEmail || 'onboarding@resend.dev';
  
  // Store from email in options for logging
  options.from = fromEmail;

  return {
    success: true,
    messageId: response.data.id,
    provider: 'resend',
    response: response.data,
    fromEmail: fromEmail
  };
}

/**
 * Send email via SMTP2Go API
 * Reference: https://developers.smtp2go.com/docs/getting-started
 */
async function sendViaSMTP2Go(options, config) {
  if (!config || !config.apiKey) {
    throw new Error('SMTP2Go configuration is incomplete');
  }

  const payload = {
    api_key: config.apiKey,
    to: [options.to],
    sender: config.fromEmail || 'noreply@smtp2go.com',
    subject: options.subject,
    html_body: options.html,
    ...(options.text && { text_body: options.text })
  };

  // Add attachments if provided
  if (options.attachments && options.attachments.length > 0) {
    const fs = require('fs');
    const path = require('path');
    
    payload.attachments = await Promise.all(
      options.attachments.map(async (att) => {
        let content;
        if (att.path) {
          content = fs.readFileSync(att.path);
        } else if (att.content) {
          content = Buffer.from(att.content);
        } else {
          throw new Error('Attachment must have either path or content');
        }

        return {
          filename: att.filename || path.basename(att.path || 'attachment'),
          filecontent: content.toString('base64'),
          mimetype: att.contentType || 'application/octet-stream'
        };
      })
    );
  }

  const response = await axios.post('https://api.smtp2go.com/v3/email/send', payload, {
    headers: {
      'Content-Type': 'application/json',
      'X-Smtp2go-Api-Key': config.apiKey
    }
  });

  if (response.data.data && response.data.data.error_code) {
    throw new Error(`SMTP2Go error: ${response.data.data.error}`);
  }

  const fromEmail = config.fromEmail || 'noreply@smtp2go.com';
  
  // Store from email in options for logging
  options.from = fromEmail;

  return {
    success: true,
    messageId: response.data.data?.email_id || 'unknown',
    provider: 'smtp2go',
    response: response.data,
    fromEmail: fromEmail
  };
}

/**
 * Test email provider configuration
 */
async function testEmailProvider(settings, requestContext = {}) {
  // Get provider config from database or environment
  const providerConfig = getEmailProviderConfig(settings);
  
  if (!providerConfig || !providerConfig.enabled) {
    throw new Error('Email provider is not configured or enabled');
  }

  const testEmail = providerConfig.testEmail || settings?.systemEmail || process.env.TEST_EMAIL;
  if (!testEmail) {
    throw new Error('Test email address is required. Set it in Settings or TEST_EMAIL environment variable.');
  }

  try {
    await sendEmail({
      to: testEmail,
      subject: 'Test Email from Makita Invoice Portal',
      html: '<p>This is a test email to verify your email provider configuration.</p><p>If you received this, your email settings are working correctly!</p>',
      text: 'This is a test email to verify your email provider configuration. If you received this, your email settings are working correctly!',
      isTestEmail: true,
      ...requestContext
    }, settings);

    return {
      success: true,
      message: 'Test email sent successfully'
    };
  } catch (error) {
    return {
      success: false,
      message: error.message || 'Failed to send test email'
    };
  }
}

module.exports = {
  sendEmail,
  testEmailProvider,
  sendViaSMTP,
  sendViaOffice365,
  sendViaResend,
  sendViaSMTP2Go
};

