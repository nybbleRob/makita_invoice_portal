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
const { wrapEmailContent } = require('../utils/emailTheme');
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
  
  // Get all ancestor company IDs (parents up the hierarchy)
  // Users assigned to a parent company should also receive notifications for child company documents
  const ancestorIds = [companyId];
  if (company.parentId) {
    // Walk up the hierarchy to find all ancestors
    let currentParentId = company.parentId;
    const maxDepth = 10; // Prevent infinite loops
    let depth = 0;
    while (currentParentId && depth < maxDepth) {
      ancestorIds.push(currentParentId);
      const parentCompany = await Company.findByPk(currentParentId, { attributes: ['id', 'parentId'] });
      currentParentId = parentCompany?.parentId;
      depth++;
    }
  }
  
  console.log(`[NotificationService]    Checking users assigned to company ${companyId} and ${ancestorIds.length - 1} ancestor(s)`);
  console.log(`[NotificationService]    Ancestor IDs to check: [${ancestorIds.join(', ')}]`);
  
  // DEBUG: First check what users are assigned to any of these companies
  const allAssignedUsers = await User.findAll({
    include: [{
      model: Company,
      as: 'companies',
      where: { id: { [Op.in]: ancestorIds } },
      through: { attributes: [] }
    }],
    where: { isActive: true }
  });
  
  console.log(`[NotificationService]    DEBUG: Total active users assigned to company/ancestors: ${allAssignedUsers.length}`);
  for (const u of allAssignedUsers) {
    console.log(`[NotificationService]      - ${u.email} role=${u.role} sendInvoiceEmail=${u.sendInvoiceEmail} sendStatementEmail=${u.sendStatementEmail}`);
  }
  
  // Get all users assigned to this company OR any of its parent companies
  const assignedUsers = await User.findAll({
    include: [{
      model: Company,
      as: 'companies',
      where: { id: { [Op.in]: ancestorIds } },
      through: { attributes: [] }
    }],
    where: {
      isActive: true,
      ...(notificationType === 'invoice' ? { sendInvoiceEmail: true } : { sendStatementEmail: true })
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
  
  // NOTE: Users with allCompanies=true are NOT included here
  // They receive the admin summary email instead (sent by batchNotificationService)
  // This prevents duplicate notifications to global admins
  
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
  
  // Get settings for theming
  const settings = await Settings.getSettings();
  const primaryColor = settings?.primaryColor || '#206bc4';
  
  // Build document tables
  let documentTables = '';
  
  if (invoices.length > 0) {
    documentTables += `
      <h3 style="color: ${primaryColor}; margin-top: 20px;">Invoices (${invoices.length})</h3>
      <table style="width: 100%; border-collapse: collapse; margin: 10px 0;">
        <thead>
          <tr style="background: #f4f6fa;">
            <th style="padding: 10px; border: 1px solid #e0e0e0; text-align: left;">Invoice Number</th>
            <th style="padding: 10px; border: 1px solid #e0e0e0; text-align: left;">Date</th>
            <th style="padding: 10px; border: 1px solid #e0e0e0; text-align: right;">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${invoices.map(inv => `
            <tr>
              <td style="padding: 10px; border: 1px solid #e0e0e0;">${inv.invoiceNumber || inv.id}</td>
              <td style="padding: 10px; border: 1px solid #e0e0e0;">${inv.date ? new Date(inv.date).toLocaleDateString('en-GB') : '-'}</td>
              <td style="padding: 10px; border: 1px solid #e0e0e0; text-align: right;">${inv.amount ? `£${Number(inv.amount).toFixed(2)}` : '-'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }
  
  if (creditNotes.length > 0) {
    documentTables += `
      <h3 style="color: ${primaryColor}; margin-top: 20px;">Credit Notes (${creditNotes.length})</h3>
      <table style="width: 100%; border-collapse: collapse; margin: 10px 0;">
        <thead>
          <tr style="background: #f4f6fa;">
            <th style="padding: 10px; border: 1px solid #e0e0e0; text-align: left;">Credit Note Number</th>
            <th style="padding: 10px; border: 1px solid #e0e0e0; text-align: left;">Date</th>
            <th style="padding: 10px; border: 1px solid #e0e0e0; text-align: right;">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${creditNotes.map(cn => `
            <tr>
              <td style="padding: 10px; border: 1px solid #e0e0e0;">${cn.creditNoteNumber || cn.id}</td>
              <td style="padding: 10px; border: 1px solid #e0e0e0;">${cn.date ? new Date(cn.date).toLocaleDateString('en-GB') : '-'}</td>
              <td style="padding: 10px; border: 1px solid #e0e0e0; text-align: right;">${cn.amount ? `£${Number(cn.amount).toFixed(2)}` : '-'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }
  
  if (statements.length > 0) {
    documentTables += `
      <h3 style="color: ${primaryColor}; margin-top: 20px;">Statements (${statements.length})</h3>
      <table style="width: 100%; border-collapse: collapse; margin: 10px 0;">
        <thead>
          <tr style="background: #f4f6fa;">
            <th style="padding: 10px; border: 1px solid #e0e0e0; text-align: left;">Statement</th>
            <th style="padding: 10px; border: 1px solid #e0e0e0; text-align: left;">Period</th>
          </tr>
        </thead>
        <tbody>
          ${statements.map(st => `
            <tr>
              <td style="padding: 10px; border: 1px solid #e0e0e0;">${st.statementNumber || st.id}</td>
              <td style="padding: 10px; border: 1px solid #e0e0e0;">${st.periodStart ? new Date(st.periodStart).toLocaleDateString('en-GB') : '-'} - ${st.periodEnd ? new Date(st.periodEnd).toLocaleDateString('en-GB') : '-'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }
  
  // Get retention period for disclaimer
  const retentionDays = settings?.documentRetentionPeriod || 30;
  
  const subject = `${totalDocuments} New Document${totalDocuments > 1 ? 's' : ''} Available - ${companyName}`;
  const emailContent = `
    <h2 style="color: ${primaryColor}; margin-bottom: 20px;">New Documents Available</h2>
    <p>Hello ${recipient.name},</p>
    <p>${totalDocuments} new document${totalDocuments > 1 ? 's have' : ' has'} been uploaded for <strong>${companyName}</strong>:</p>
    
    ${documentTables}
    
    <p style="margin-top: 24px;">
      <a href="${portalUrl}" style="display: inline-block; padding: 12px 24px; background-color: ${primaryColor}; color: white; text-decoration: none; border-radius: 6px; font-weight: 500;">
        View All Documents
      </a>
    </p>
    
    <div style="margin-top: 24px; padding: 12px 16px; background-color: #fff3cd; border: 1px solid #ffc107; border-radius: 6px; color: #856404; font-size: 13px;">
      <strong>Important:</strong> Invoices and Credit Notes are only available for ${retentionDays} days from the upload date. Please download any documents you wish to keep for your records.
    </div>
  `;
  
  // Wrap with email theme (applies header, footer, branding)
  const html = wrapEmailContent(emailContent, settings);
  
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
  
  // Get settings for theming
  const settings = await Settings.getSettings();
  const primaryColor = settings?.primaryColor || '#206bc4';
  
  const documentTypeName = documentType === 'credit_note' ? 'Credit Note' 
    : documentType === 'statement' ? 'Statement' 
    : 'Invoice';
  
  const documentNumber = document.invoiceNumber || document.creditNoteNumber || 
    document.statementNumber || document.id;
  
  // Format amount with currency if present
  const formattedAmount = document.amount 
    ? (typeof document.amount === 'number' ? `£${document.amount.toFixed(2)}` : document.amount)
    : null;
  
  // Format date if present
  const formattedDate = document.date 
    ? new Date(document.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : null;
  
  // Get retention period for disclaimer
  const retentionDays = settings?.documentRetentionPeriod || 30;
  
  const subject = `New ${documentTypeName} Available - ${companyName}`;
  const emailContent = `
    <h2 style="color: ${primaryColor}; margin-bottom: 20px;">New ${documentTypeName} Available</h2>
    <p>Hello ${recipient.name},</p>
    <p>A new ${documentTypeName.toLowerCase()} has been uploaded for <strong>${companyName}</strong>:</p>
    
    <table style="width: 100%; border-collapse: collapse; margin: 20px 0; background: #f8f9fa; border-radius: 8px;">
      <tr>
        <td style="padding: 12px 16px; border-bottom: 1px solid #e9ecef; font-weight: 600; width: 40%;">${documentTypeName} Number</td>
        <td style="padding: 12px 16px; border-bottom: 1px solid #e9ecef;">${documentNumber}</td>
      </tr>
      ${formattedAmount ? `
      <tr>
        <td style="padding: 12px 16px; border-bottom: 1px solid #e9ecef; font-weight: 600;">Amount</td>
        <td style="padding: 12px 16px; border-bottom: 1px solid #e9ecef;">${formattedAmount}</td>
      </tr>
      ` : ''}
      ${formattedDate ? `
      <tr>
        <td style="padding: 12px 16px; font-weight: 600;">Date</td>
        <td style="padding: 12px 16px;">${formattedDate}</td>
      </tr>
      ` : ''}
    </table>
    
    <p style="margin-top: 24px;">
      <a href="${portalUrl}" style="display: inline-block; padding: 12px 24px; background-color: ${primaryColor}; color: white; text-decoration: none; border-radius: 6px; font-weight: 500;">
        View Document
      </a>
    </p>
    
    <div style="margin-top: 24px; padding: 12px 16px; background-color: #fff3cd; border: 1px solid #ffc107; border-radius: 6px; color: #856404; font-size: 13px;">
      <strong>Important:</strong> Invoices and Credit Notes are only available for ${retentionDays} days from the upload date. Please download any documents you wish to keep for your records.
    </div>
  `;
  
  // Wrap with email theme (applies header, footer, branding)
  const html = wrapEmailContent(emailContent, settings);
  
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

