/**
 * Document Notification Service
 * Handles email notifications when documents (invoices, credit notes, statements) are uploaded
 * 
 * Features:
 * - Sends notifications to company's primary contact
 * - Sends notifications to all assigned users with notifications enabled
 * - Supports individual emails per document or summary emails per import batch
 * - Integrates with BullMQ email queue for rate limiting and reliability
 */

const { Company, User, UserCompany, Settings, sequelize } = require('../models');
const { queueEmail } = require('../utils/emailQueue');
const { renderEmailTemplate } = require('../utils/emailTemplateRenderer');
const { Op } = require('sequelize');

/**
 * Get all users who should receive notifications for a company
 * @param {string} companyId - Company ID
 * @param {string} notificationType - 'invoice' or 'statement'
 * @returns {Promise<Array>} Array of user objects with notification preferences
 */
async function getNotificationRecipients(companyId, notificationType) {
  const recipients = [];
  const seenEmails = new Set();
  
  console.log(`[NotificationService] Getting ${notificationType} recipients for company ${companyId}`);
  
  // Get company with primaryContact
  const company = await Company.findByPk(companyId, {
    include: [{
      model: User,
      as: 'primaryContact',
      required: false,
      attributes: ['id', 'name', 'email', 'role', 'isActive', 
        'sendInvoiceEmail', 'sendInvoiceAttachment', 
        'sendStatementEmail', 'sendStatementAttachment', 
        'sendEmailAsSummary']
    }]
  });
  
  if (!company) {
    console.warn(`[NotificationService] Company ${companyId} not found`);
    return [];
  }
  
  console.log(`[NotificationService]    Company: ${company.name}, sendInvoiceEmail=${company.sendInvoiceEmail}`);
  
  // Check company-level notification settings
  const companySettings = {
    sendInvoiceEmail: company.sendInvoiceEmail,
    sendInvoiceAttachment: company.sendInvoiceAttachment,
    sendStatementEmail: company.sendStatementEmail,
    sendStatementAttachment: company.sendStatementAttachment,
    sendEmailAsSummary: company.sendEmailAsSummary
  };
  
  // Add primary contact if applicable
  if (company.primaryContact && company.primaryContact.isActive) {
    const pc = company.primaryContact;
    const shouldNotify = notificationType === 'invoice' 
      ? (companySettings.sendInvoiceEmail || pc.sendInvoiceEmail)
      : (companySettings.sendStatementEmail || pc.sendStatementEmail);
    
    if (shouldNotify && !seenEmails.has(pc.email.toLowerCase())) {
      seenEmails.add(pc.email.toLowerCase());
      recipients.push({
        userId: pc.id,
        name: pc.name,
        email: pc.email,
        role: pc.role,
        isPrimaryContact: true,
        sendAttachment: notificationType === 'invoice'
          ? (companySettings.sendInvoiceAttachment || pc.sendInvoiceAttachment)
          : (companySettings.sendStatementAttachment || pc.sendStatementAttachment),
        sendAsSummary: companySettings.sendEmailAsSummary || pc.sendEmailAsSummary
      });
    }
  }
  
  // Get all users assigned to this company
  const assignedUsers = await User.findAll({
    include: [{
      model: Company,
      as: 'companies',
      where: { id: companyId },
      through: { attributes: [] }
    }],
    where: {
      isActive: true,
      [Op.or]: [
        notificationType === 'invoice' ? { sendInvoiceEmail: true } : { sendStatementEmail: true }
      ]
    }
  });
  
  console.log(`[NotificationService]    Found ${assignedUsers.length} assigned users with ${notificationType} notifications enabled`);
  
  for (const user of assignedUsers) {
    console.log(`[NotificationService]      - Assigned user: ${user.email} (sendInvoiceEmail=${user.sendInvoiceEmail})`);
    
    if (!seenEmails.has(user.email.toLowerCase())) {
      seenEmails.add(user.email.toLowerCase());
      recipients.push({
        userId: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        isPrimaryContact: false,
        sendAttachment: notificationType === 'invoice'
          ? user.sendInvoiceAttachment
          : user.sendStatementAttachment,
        sendAsSummary: user.sendEmailAsSummary
      });
    }
  }
  
  // Get users with allCompanies=true who have notifications enabled
  const allCompanyUsers = await User.findAll({
    where: {
      isActive: true,
      allCompanies: true,
      [Op.or]: [
        notificationType === 'invoice' ? { sendInvoiceEmail: true } : { sendStatementEmail: true }
      ]
    }
  });
  
  console.log(`[NotificationService]    Found ${allCompanyUsers.length} users with allCompanies=true and ${notificationType} notifications`);
  
  for (const user of allCompanyUsers) {
    if (!seenEmails.has(user.email.toLowerCase())) {
      seenEmails.add(user.email.toLowerCase());
      recipients.push({
        userId: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        isPrimaryContact: false,
        sendAttachment: notificationType === 'invoice'
          ? user.sendInvoiceAttachment
          : user.sendStatementAttachment,
        sendAsSummary: user.sendEmailAsSummary
      });
    }
  }
  
  return recipients;
}

/**
 * Queue notifications for uploaded documents
 * @param {Object} options - Notification options
 * @param {string} options.companyId - Company ID
 * @param {string} options.companyName - Company name
 * @param {string} options.importId - Import batch ID
 * @param {Array} options.invoices - Array of invoice objects
 * @param {Array} options.creditNotes - Array of credit note objects  
 * @param {Array} options.statements - Array of statement objects
 * @param {string} options.triggeredByUserId - User who triggered the import
 * @param {string} options.triggeredByEmail - Email of user who triggered import
 */
async function queueDocumentNotifications(options) {
  const {
    companyId,
    companyName,
    importId,
    invoices = [],
    creditNotes = [],
    statements = [],
    triggeredByUserId,
    triggeredByEmail
  } = options;
  
  console.log(`[NotificationService] Processing notifications for company ${companyName} (${companyId})`);
  console.log(`[NotificationService]    Invoices: ${invoices.length}, Credit Notes: ${creditNotes.length}, Statements: ${statements.length}`);
  
  const settings = await Settings.getSettings();
  const portalName = settings?.siteTitle || 'Invoice Portal';
  const portalUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  
  // Get recipients for invoices/credit notes
  const invoiceRecipients = invoices.length > 0 || creditNotes.length > 0
    ? await getNotificationRecipients(companyId, 'invoice')
    : [];
  
  // Get recipients for statements
  const statementRecipients = statements.length > 0
    ? await getNotificationRecipients(companyId, 'statement')
    : [];
  
  // Combine and dedupe recipients
  const allRecipients = new Map();
  
  for (const r of [...invoiceRecipients, ...statementRecipients]) {
    if (!allRecipients.has(r.email)) {
      allRecipients.set(r.email, {
        ...r,
        receiveInvoiceNotification: invoiceRecipients.some(ir => ir.email === r.email),
        receiveStatementNotification: statementRecipients.some(sr => sr.email === r.email)
      });
    } else {
      const existing = allRecipients.get(r.email);
      existing.receiveInvoiceNotification = existing.receiveInvoiceNotification || 
        invoiceRecipients.some(ir => ir.email === r.email);
      existing.receiveStatementNotification = existing.receiveStatementNotification || 
        statementRecipients.some(sr => sr.email === r.email);
    }
  }
  
  console.log(`[NotificationService] Found ${allRecipients.size} recipients for ${companyName}`);
  if (allRecipients.size > 0) {
    for (const [email, recipient] of allRecipients) {
      console.log(`[NotificationService]    - ${email} (${recipient.role}) sendAsSummary=${recipient.sendAsSummary}, sendAttachment=${recipient.sendAttachment}`);
    }
  } else {
    console.log(`[NotificationService]    No users found with notifications enabled for this company`);
    console.log(`[NotificationService]    Check: Users must have sendInvoiceEmail=true AND be assigned to this company`);
  }
  
  const queuedEmails = [];
  
  for (const [email, recipient] of allRecipients) {
    try {
      if (recipient.sendAsSummary) {
        // Queue summary email
        const summaryEmail = await queueSummaryEmail({
          recipient,
          companyName,
          companyId,
          importId,
          invoices: recipient.receiveInvoiceNotification ? invoices : [],
          creditNotes: recipient.receiveInvoiceNotification ? creditNotes : [],
          statements: recipient.receiveStatementNotification ? statements : [],
          portalName,
          portalUrl,
          triggeredByUserId,
          triggeredByEmail
        });
        queuedEmails.push(summaryEmail);
      } else {
        // Queue individual emails
        if (recipient.receiveInvoiceNotification) {
          for (const invoice of invoices) {
            const emailResult = await queueIndividualEmail({
              recipient,
              document: invoice,
              documentType: 'invoice',
              companyName,
              companyId,
              portalName,
              portalUrl,
              triggeredByUserId,
              triggeredByEmail
            });
            queuedEmails.push(emailResult);
          }
          
          for (const creditNote of creditNotes) {
            const emailResult = await queueIndividualEmail({
              recipient,
              document: creditNote,
              documentType: 'credit_note',
              companyName,
              companyId,
              portalName,
              portalUrl,
              triggeredByUserId,
              triggeredByEmail
            });
            queuedEmails.push(emailResult);
          }
        }
        
        if (recipient.receiveStatementNotification) {
          for (const statement of statements) {
            const emailResult = await queueIndividualEmail({
              recipient,
              document: statement,
              documentType: 'statement',
              companyName,
              companyId,
              portalName,
              portalUrl,
              triggeredByUserId,
              triggeredByEmail
            });
            queuedEmails.push(emailResult);
          }
        }
      }
    } catch (error) {
      console.error(`[NotificationService] Error queuing email for ${email}:`, error.message);
    }
  }
  
  console.log(`[NotificationService] Queued ${queuedEmails.length} notification emails`);
  
  return {
    recipientCount: allRecipients.size,
    emailsQueued: queuedEmails.length,
    emails: queuedEmails
  };
}

/**
 * Queue a summary email for a recipient
 */
async function queueSummaryEmail(options) {
  const {
    recipient,
    companyName,
    companyId,
    importId,
    invoices,
    creditNotes,
    statements,
    portalName,
    portalUrl,
    triggeredByUserId,
    triggeredByEmail
  } = options;
  
  const totalDocuments = invoices.length + creditNotes.length + statements.length;
  
  if (totalDocuments === 0) {
    return null;
  }
  
  // Build summary content
  let summaryLines = [];
  if (invoices.length > 0) {
    summaryLines.push(`<li><strong>${invoices.length}</strong> new invoice${invoices.length > 1 ? 's' : ''}</li>`);
  }
  if (creditNotes.length > 0) {
    summaryLines.push(`<li><strong>${creditNotes.length}</strong> new credit note${creditNotes.length > 1 ? 's' : ''}</li>`);
  }
  if (statements.length > 0) {
    summaryLines.push(`<li><strong>${statements.length}</strong> new statement${statements.length > 1 ? 's' : ''}</li>`);
  }
  
  const subject = `Document Upload Summary - ${companyName}`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #333;">Document Upload Summary</h2>
      <p>Hello ${recipient.name},</p>
      <p>The following documents have been uploaded to <strong>${portalName}</strong> for <strong>${companyName}</strong>:</p>
      <ul style="list-style: none; padding: 0;">
        ${summaryLines.join('\n        ')}
      </ul>
      <p style="margin-top: 20px;">
        <a href="${portalUrl}" style="display: inline-block; padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px;">
          View Documents
        </a>
      </p>
      <hr style="margin-top: 30px; border: none; border-top: 1px solid #eee;">
      <p style="color: #666; font-size: 12px;">
        You are receiving this because you have summary notifications enabled for ${companyName}.
      </p>
    </div>
  `;
  
  const result = await queueEmail({
    to: recipient.email,
    subject,
    html,
    templateName: 'document_upload_summary',
    metadata: {
      userId: recipient.userId,
      userEmail: recipient.email,
      companyId,
      companyName,
      importId,
      notificationType: 'summary',
      documentCounts: {
        invoices: invoices.length,
        creditNotes: creditNotes.length,
        statements: statements.length
      }
    }
  });
  
  return { type: 'summary', recipient: recipient.email, jobId: result.job?.id };
}

/**
 * Queue an individual document notification email
 */
async function queueIndividualEmail(options) {
  const {
    recipient,
    document,
    documentType,
    companyName,
    companyId,
    portalName,
    portalUrl,
    triggeredByUserId,
    triggeredByEmail
  } = options;
  
  const documentTypeName = documentType === 'credit_note' ? 'Credit Note' 
    : documentType === 'statement' ? 'Statement' 
    : 'Invoice';
  
  const documentNumber = document.invoiceNumber || document.creditNoteNumber || 
    document.statementNumber || document.id;
  
  const subject = `New ${documentTypeName} Uploaded - ${companyName}`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #333;">New ${documentTypeName} Uploaded</h2>
      <p>Hello ${recipient.name},</p>
      <p>A new ${documentTypeName.toLowerCase()} has been uploaded to <strong>${portalName}</strong> for <strong>${companyName}</strong>:</p>
      <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
        <p style="margin: 0;"><strong>${documentTypeName} Number:</strong> ${documentNumber}</p>
        ${document.amount ? `<p style="margin: 5px 0 0;"><strong>Amount:</strong> ${document.amount}</p>` : ''}
        ${document.date ? `<p style="margin: 5px 0 0;"><strong>Date:</strong> ${document.date}</p>` : ''}
      </div>
      <p style="margin-top: 20px;">
        <a href="${portalUrl}" style="display: inline-block; padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px;">
          View Document
        </a>
      </p>
      <hr style="margin-top: 30px; border: none; border-top: 1px solid #eee;">
      <p style="color: #666; font-size: 12px;">
        You are receiving this because you have upload notifications enabled for ${companyName}.
      </p>
    </div>
  `;
  
  // Prepare attachments if enabled
  const attachments = [];
  if (recipient.sendAttachment && document.filePath) {
    const fs = require('fs');
    const path = require('path');
    
    if (fs.existsSync(document.filePath)) {
      attachments.push({
        filename: document.originalName || path.basename(document.filePath),
        path: document.filePath
      });
    }
  }
  
  const result = await queueEmail({
    to: recipient.email,
    subject,
    html,
    attachments: attachments.length > 0 ? attachments : undefined,
    templateName: 'document_upload_notification',
    metadata: {
      userId: recipient.userId,
      userEmail: recipient.email,
      companyId,
      companyName,
      notificationType: 'individual',
      documentType,
      documentId: document.id,
      documentNumber
    }
  });
  
  return { type: documentType, recipient: recipient.email, jobId: result.job?.id };
}

module.exports = {
  getNotificationRecipients,
  queueDocumentNotifications,
  queueSummaryEmail,
  queueIndividualEmail
};

