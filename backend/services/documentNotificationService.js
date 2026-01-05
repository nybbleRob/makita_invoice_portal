/**
 * Document Notification Service
 * Handles email notifications when documents (invoices, credit notes, statements) are uploaded
 * 
 * Features:
 * - Sends notifications to company's primary contact
 * - Sends notifications to all assigned users with notifications enabled
 * - Supports individual emails per document or summary emails per import batch
 * - Integrates with BullMQ email queue for rate limiting and reliability
 * - Uses Tabler email templates for professional, Outlook-compatible emails
 */

const { Company, User, UserCompany, Settings, sequelize } = require('../models');
const { queueEmail } = require('../utils/emailQueue');
const { renderTemplate, formatDate, formatCurrency } = require('../utils/tablerEmailRenderer');
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
  
  // Check if test mode is active
  const settings = await Settings.getSettings();
  const testMode = settings?.emailProvider?.testMode;
  const isTestMode = testMode?.enabled && testMode?.redirectEmail;
  
  if (isTestMode) {
    console.log(`[NotificationService] 🧪 TEST MODE ACTIVE - Using test company's notification settings, emails will redirect to ${testMode.redirectEmail}`);
  }
  
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
  
  // TEST MODE FALLBACK: If test mode is enabled but no recipients found,
  // add a test recipient so we can still test the email flow
  if (recipients.length === 0 && isTestMode) {
    console.log(`[NotificationService] 🧪 TEST MODE: No recipients configured for test company, adding fallback test recipient`);
    
    // Use company-level settings if available, otherwise defaults
    const company = await Company.findByPk(companyId, { attributes: ['id', 'name', 'sendInvoiceEmail', 'sendInvoiceAttachment', 'sendStatementEmail', 'sendStatementAttachment', 'sendEmailAsSummary'] });
    
    recipients.push({
      userId: 'test-fallback',
      name: `Test Recipient (${company?.name || 'Unknown'})`,
      email: testMode.redirectEmail,
      role: 'test_recipient',
      isPrimaryContact: false,
      sendAttachment: notificationType === 'invoice' 
        ? (company?.sendInvoiceAttachment !== false)  // Default true
        : (company?.sendStatementAttachment !== false),
      sendAsSummary: company?.sendEmailAsSummary === true  // Default false (individual)
    });
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
  
  // Get company to check for sendBulkEmail setting
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
    return { recipientCount: 0, emailsQueued: 0, emails: [] };
  }
  
  // Check if bulk email is enabled
  const useBulkEmail = company.sendBulkEmail && company.primaryContact && company.primaryContact.isActive;
  
  if (useBulkEmail) {
    console.log(`[NotificationService] Bulk email enabled for ${companyName} - will send 1 email to Primary Contact with CC to others`);
    return await queueBulkEmailNotifications({
      company,
      companyId,
      companyName,
      invoices,
      creditNotes,
      statements,
      importId,
      portalName,
      portalUrl,
      triggeredByUserId,
      triggeredByEmail
    });
  }
  
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
  
  // Group recipients by email content for batching (Office 365 optimization)
  // Group summary recipients together
  const summaryRecipients = [];
  const individualEmailGroups = new Map(); // Key: documentId, Value: array of recipients
  
  for (const [email, recipient] of allRecipients) {
    if (recipient.sendAsSummary) {
      summaryRecipients.push(recipient);
    } else {
      // Group individual emails by document
      if (recipient.receiveInvoiceNotification) {
        for (const invoice of invoices) {
          const key = `invoice_${invoice.id}`;
          if (!individualEmailGroups.has(key)) {
            individualEmailGroups.set(key, { document: invoice, documentType: 'invoice', recipients: [] });
          }
          individualEmailGroups.get(key).recipients.push(recipient);
        }
        for (const creditNote of creditNotes) {
          const key = `creditnote_${creditNote.id}`;
          if (!individualEmailGroups.has(key)) {
            individualEmailGroups.set(key, { document: creditNote, documentType: 'credit_note', recipients: [] });
          }
          individualEmailGroups.get(key).recipients.push(recipient);
        }
      }
      if (recipient.receiveStatementNotification) {
        for (const statement of statements) {
          const key = `statement_${statement.id}`;
          if (!individualEmailGroups.has(key)) {
            individualEmailGroups.set(key, { document: statement, documentType: 'statement', recipients: [] });
          }
          individualEmailGroups.get(key).recipients.push(recipient);
        }
      }
    }
  }
  
  // Queue batch summary email if recipients exist
  if (summaryRecipients.length > 0) {
    try {
      const summaryEmail = await queueBatchSummaryEmail({
        recipients: summaryRecipients,
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
      });
      queuedEmails.push(summaryEmail);
    } catch (error) {
      console.error(`[NotificationService] Error queuing batch summary email:`, error.message);
    }
  }
  
  // Queue individual emails (batch when possible for Office 365)
  for (const [key, group] of individualEmailGroups) {
    try {
      if (group.recipients.length > 1) {
        // Batch recipients for same document (Office 365 optimization)
        const batchEmail = await queueBatchIndividualEmail({
          recipients: group.recipients,
          document: group.document,
          documentType: group.documentType,
          companyName,
          companyId,
          portalName,
          portalUrl,
          triggeredByUserId,
          triggeredByEmail
        });
        queuedEmails.push(batchEmail);
      } else {
        // Single recipient - use existing individual email function
        const emailResult = await queueIndividualEmail({
          recipient: group.recipients[0],
          document: group.document,
          documentType: group.documentType,
          companyName,
          companyId,
          portalName,
          portalUrl,
          triggeredByUserId,
          triggeredByEmail
        });
        queuedEmails.push(emailResult);
      }
    } catch (error) {
      console.error(`[NotificationService] Error queuing email for ${key}:`, error.message);
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
 * Queue a batch summary email for multiple recipients (Office 365 optimization)
 * @param {Object} options - Batch summary email options
 * @returns {Promise<Object>} Queue result
 */
async function queueBatchSummaryEmail(options) {
  const {
    recipients,
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
  
  if (!recipients || recipients.length === 0) {
    return null;
  }
  
  const totalDocuments = invoices.length + creditNotes.length + statements.length;
  
  if (totalDocuments === 0) {
    return null;
  }
  
  // Get settings for template
  const settings = await Settings.getSettings();
  const retentionDays = settings?.documentRetentionPeriod || 30;
  
  // Render template (use first recipient's name for template, but send to all)
  const html = renderTemplate('document-summary', {
    userName: 'Valued Customer', // Generic greeting for batch
    totalDocuments: totalDocuments.toString(),
    invoiceCount: invoices.length > 0 ? invoices.length.toString() : '',
    creditNoteCount: creditNotes.length > 0 ? creditNotes.length.toString() : '',
    statementCount: statements.length > 0 ? statements.length.toString() : '',
    retentionPeriod: retentionDays.toString()
  }, settings);
  
  const subject = `Document Summary - ${totalDocuments} new document${totalDocuments > 1 ? 's' : ''} available`;
  
  // Get recipient emails
  const recipientEmails = recipients.map(r => r.email);
  
  const result = await queueEmail({
    to: recipientEmails, // Array for batch
    subject,
    html,
    templateName: 'document_upload_summary',
    metadata: {
      userId: triggeredByUserId || null,
      userEmail: triggeredByEmail || 'system',
      companyId,
      companyName,
      importId,
      notificationType: 'summary_batch',
      documentCounts: {
        invoices: invoices.length,
        creditNotes: creditNotes.length,
        statements: statements.length
      },
      recipientCount: recipients.length
    }
  });
  
  console.log(`[NotificationService] Queued batch summary email to ${recipients.length} recipients`);
  
  return { type: 'summary_batch', recipientCount: recipients.length, jobId: result.job?.id };
}

/**
 * Queue a batch individual email for multiple recipients (Office 365 optimization)
 * @param {Object} options - Batch individual email options
 * @returns {Promise<Object>} Queue result
 */
async function queueBatchIndividualEmail(options) {
  const {
    recipients,
    document,
    documentType,
    companyName,
    companyId,
    portalName,
    portalUrl,
    triggeredByUserId,
    triggeredByEmail
  } = options;
  
  if (!recipients || recipients.length === 0 || !document) {
    return null;
  }
  
  // Get settings for template
  const settings = await Settings.getSettings();
  const retentionDays = settings?.documentRetentionPeriod || 30;
  
  // Determine document type name
  const documentTypeName = documentType === 'credit_note' ? 'Credit Note' : 
                          documentType === 'statement' ? 'Statement' : 'Invoice';
  
  // Build document URL
  const documentUrl = documentType === 'credit_note' 
    ? `${portalUrl}/credit-notes/${document.id}/view`
    : documentType === 'statement'
    ? `${portalUrl}/statements/${document.id}/view`
    : `${portalUrl}/invoices/${document.id}/view`;
  
  // Render template (generic greeting for batch)
  const html = renderTemplate('document-notification', {
    userName: 'Valued Customer', // Generic for batch
    documentTypeName,
    documentNumber: document.invoiceNumber || document.creditNoteNumber || document.statementNumber || 'N/A',
    documentDate: formatDate(document.issueDate || document.createdAt),
    documentAmount: formatCurrency(document.amount || 0),
    supplierName: companyName,
    documentUrl,
    retentionPeriod: retentionDays.toString()
  }, settings);
  
  const subject = `New ${documentTypeName} - ${document.invoiceNumber || document.creditNoteNumber || document.statementNumber || 'Document'}`;
  
  // Get recipient emails
  const recipientEmails = recipients.map(r => r.email);
  
  const result = await queueEmail({
    to: recipientEmails, // Array for batch
    subject,
    html,
    templateName: `document_${documentType}_notification`,
    metadata: {
      userId: triggeredByUserId || null,
      userEmail: triggeredByEmail || 'system',
      companyId,
      companyName,
      documentId: document.id,
      documentType,
      notificationType: 'individual_batch',
      recipientCount: recipients.length
    }
  });
  
  console.log(`[NotificationService] Queued batch individual email for ${documentTypeName} to ${recipients.length} recipients`);
  
  return { type: 'individual_batch', documentType, recipientCount: recipients.length, jobId: result.job?.id };
}

/**
 * Queue a summary email for a recipient (using Tabler template)
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
  
  // Get settings for template
  const settings = await Settings.getSettings();
  const retentionDays = settings?.documentRetentionPeriod || 30;
  
  // Render using Tabler template
  const html = renderTemplate('document-summary', {
    userName: recipient.name,
    totalDocuments: totalDocuments.toString(),
    invoiceCount: invoices.length > 0 ? invoices.length.toString() : '',
    creditNoteCount: creditNotes.length > 0 ? creditNotes.length.toString() : '',
    statementCount: statements.length > 0 ? statements.length.toString() : '',
    retentionPeriod: retentionDays.toString()
  }, settings);
  
  const subject = `Document Summary - ${totalDocuments} new document${totalDocuments > 1 ? 's' : ''} available`;
  
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
 * Queue an individual document notification email (using Tabler template)
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
  
  // Get settings for template
  const settings = await Settings.getSettings();
  
  const documentTypeName = documentType === 'credit_note' ? 'Credit Note' 
    : documentType === 'statement' ? 'Statement' 
    : 'Invoice';
  
  // Build direct document URL (e.g., /invoices/123 or /credit-notes/456)
  const documentPath = documentType === 'credit_note' ? 'credit-notes' 
    : documentType === 'statement' ? 'statements' 
    : 'invoices';
  const documentUrl = `${portalUrl}/${documentPath}/${document.id}`;
  
  const documentNumber = document.invoiceNumber || document.creditNoteNumber || 
    document.statementNumber || document.id;
  
  // Format amount with currency if present
  const formattedAmount = document.amount 
    ? formatCurrency(document.amount)
    : '';
  
  // Format date if present
  const formattedDate = document.date 
    ? formatDate(document.date)
    : '';
  
  // Get retention period for disclaimer
  const retentionDays = settings?.documentRetentionPeriod || 30;
  
  // Render using Tabler template
  const html = renderTemplate('document-notification', {
    userName: recipient.name,
    documentTypeName,
    documentNumber: documentNumber.toString(),
    documentDate: formattedDate,
    documentAmount: formattedAmount,
    documentUrl,
    supplierName: companyName,
    hasAttachment: recipient.sendAttachment && document.fileUrl ? 'true' : '',
    retentionPeriod: retentionDays.toString()
  }, settings);
  
  const subject = `New ${documentTypeName} Available - ${companyName}`;
  
  // Prepare attachments if enabled
  const attachments = [];
  if (recipient.sendAttachment && document.fileUrl) {
    const fs = require('fs');
    const path = require('path');
    
    if (fs.existsSync(document.fileUrl)) {
      attachments.push({
        filename: document.originalName || path.basename(document.fileUrl),
        path: document.fileUrl
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

/**
 * Queue bulk email notifications (1 email to Primary Contact with CC to others)
 * Only used when company has sendBulkEmail enabled
 */
async function queueBulkEmailNotifications(options) {
  const {
    company,
    companyId,
    companyName,
    invoices,
    creditNotes,
    statements,
    importId,
    portalName,
    portalUrl,
    triggeredByUserId,
    triggeredByEmail
  } = options;
  
  const primaryContact = company.primaryContact;
  
  if (!primaryContact || !primaryContact.isActive) {
    console.warn(`[NotificationService] Bulk email enabled but no active primary contact for ${companyName}`);
    return { recipientCount: 0, emailsQueued: 0, emails: [] };
  }
  
  // Get all ancestor company IDs (users assigned to parent companies should also be included)
  const ancestorIds = [companyId];
  if (company.parentId) {
    let currentParentId = company.parentId;
    const maxDepth = 10;
    let depth = 0;
    while (currentParentId && depth < maxDepth) {
      ancestorIds.push(currentParentId);
      const parentCompany = await Company.findByPk(currentParentId, { attributes: ['id', 'parentId'] });
      currentParentId = parentCompany?.parentId;
      depth++;
    }
  }
  
  // Get all users assigned to this company or any of its ancestors (for CC)
  const allAssignedUsers = await User.findAll({
    include: [{
      model: Company,
      as: 'companies',
      where: { id: { [Op.in]: ancestorIds } },
      through: { attributes: [] }
    }],
    where: { isActive: true },
    attributes: ['id', 'name', 'email', 'role', 'isActive',
      'sendInvoiceEmail', 'sendInvoiceAttachment',
      'sendStatementEmail', 'sendStatementAttachment',
      'sendEmailAsSummary']
  });
  
  // Determine which users should receive notifications based on document types
  const hasInvoicesOrCreditNotes = invoices.length > 0 || creditNotes.length > 0;
  const hasStatements = statements.length > 0;
  
  // Get users who should be CC'd (those with notifications enabled, excluding primary contact)
  const ccRecipients = allAssignedUsers.filter(user => {
    if (user.id === primaryContact.id) return false;
    if (hasInvoicesOrCreditNotes && user.sendInvoiceEmail) return true;
    if (hasStatements && user.sendStatementEmail) return true;
    return false;
  }).map(user => ({
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    isPrimaryContact: false,
    sendAttachment: hasInvoicesOrCreditNotes ? (user.sendInvoiceAttachment || false) : (user.sendStatementAttachment || false),
    sendAsSummary: user.sendEmailAsSummary || false,
    receiveInvoiceNotification: hasInvoicesOrCreditNotes && user.sendInvoiceEmail,
    receiveStatementNotification: hasStatements && user.sendStatementEmail
  }));
  
  // Check if primary contact has notifications enabled
  const primaryContactShouldReceive = 
    (hasInvoicesOrCreditNotes && primaryContact.sendInvoiceEmail) ||
    (hasStatements && primaryContact.sendStatementEmail);
  
  if (!primaryContactShouldReceive) {
    console.log(`[NotificationService] Primary Contact ${primaryContact.email} does not have notifications enabled`);
    if (ccRecipients.length === 0) {
      return { recipientCount: 0, emailsQueued: 0, emails: [] };
    }
    // Use first CC recipient as TO if primary contact doesn't have notifications
    const toRecipient = ccRecipients[0];
    const remainingCC = ccRecipients.slice(1);
    return await sendBulkEmail({
      toRecipient,
      ccRecipients: remainingCC,
      companyName,
      companyId,
      invoices,
      creditNotes,
      statements,
      importId,
      portalName,
      portalUrl,
      triggeredByUserId,
      triggeredByEmail
    });
  }
  
  const toRecipient = {
    userId: primaryContact.id,
    name: primaryContact.name,
    email: primaryContact.email,
    role: primaryContact.role,
    isPrimaryContact: true,
    sendAttachment: hasInvoicesOrCreditNotes ? (primaryContact.sendInvoiceAttachment || false) : (primaryContact.sendStatementAttachment || false),
    sendAsSummary: primaryContact.sendEmailAsSummary || false,
    receiveInvoiceNotification: hasInvoicesOrCreditNotes && primaryContact.sendInvoiceEmail,
    receiveStatementNotification: hasStatements && primaryContact.sendStatementEmail
  };
  
  console.log(`[NotificationService] Bulk email: TO=${primaryContact.email}, CC=${ccRecipients.length} recipients`);
  
  return await sendBulkEmail({
    toRecipient,
    ccRecipients,
    companyName,
    companyId,
    invoices,
    creditNotes,
    statements,
    importId,
    portalName,
    portalUrl,
    triggeredByUserId,
    triggeredByEmail
  });
}

/**
 * Send bulk email (1 email TO primary contact, CC to others)
 */
async function sendBulkEmail(options) {
  const {
    toRecipient,
    ccRecipients,
    companyName,
    companyId,
    invoices,
    creditNotes,
    statements,
    importId,
    portalName,
    portalUrl,
    triggeredByUserId,
    triggeredByEmail
  } = options;
  
  const totalDocuments = invoices.length + creditNotes.length + statements.length;
  if (totalDocuments === 0) {
    return { recipientCount: 0, emailsQueued: 0, emails: [] };
  }
  
  const settings = await Settings.getSettings();
  const retentionDays = settings?.documentRetentionPeriod || 30;
  const sendAsSummary = toRecipient.sendAsSummary;
  const queuedEmails = [];
  
  if (sendAsSummary) {
    // Send summary email
    const html = renderTemplate('document-summary', {
      userName: toRecipient.name,
      totalDocuments: totalDocuments.toString(),
      invoiceCount: invoices.length > 0 ? invoices.length.toString() : '',
      creditNoteCount: creditNotes.length > 0 ? creditNotes.length.toString() : '',
      statementCount: statements.length > 0 ? statements.length.toString() : '',
      retentionPeriod: retentionDays.toString()
    }, settings);
    
    const subject = `Document Summary - ${totalDocuments} new document${totalDocuments > 1 ? 's' : ''} available`;
    const ccEmails = ccRecipients.map(r => r.email);
    
    const result = await queueEmail({
      to: toRecipient.email,
      cc: ccEmails.length > 0 ? ccEmails : undefined,
      subject,
      html,
      templateName: 'document_upload_summary',
      metadata: {
        userId: triggeredByUserId || null,
        userEmail: triggeredByEmail || 'system',
        companyId,
        companyName,
        importId,
        notificationType: 'bulk_email',
        toRecipient: toRecipient.email,
        ccRecipients: ccEmails,
        recipientCount: 1 + ccEmails.length,
        isBulkEmail: true
      }
    });
    
    queuedEmails.push({ type: 'bulk_summary', toRecipient: toRecipient.email, ccRecipients: ccEmails.length, jobId: result.job?.id });
  } else {
    // Send individual emails for each document
    const hasInvoicesOrCreditNotes = invoices.length > 0 || creditNotes.length > 0;
    const hasStatements = statements.length > 0;
    
    // Process invoices
    for (const invoice of invoices) {
      if (!toRecipient.receiveInvoiceNotification) continue;
      
      const documentUrl = `${portalUrl}/invoices/${invoice.id}/view`;
      const html = renderTemplate('document-notification', {
        userName: toRecipient.name,
        documentTypeName: 'Invoice',
        documentNumber: invoice.invoiceNumber || 'N/A',
        documentDate: formatDate(invoice.issueDate || invoice.createdAt),
        documentAmount: formatCurrency(invoice.amount || 0),
        supplierName: companyName,
        documentUrl,
        retentionPeriod: retentionDays.toString()
      }, settings);
      
      const subject = `New Invoice - ${invoice.invoiceNumber || 'Document'}`;
      const invoiceCC = ccRecipients.filter(r => r.receiveInvoiceNotification);
      const ccEmails = invoiceCC.map(r => r.email);
      
      const result = await queueEmail({
        to: toRecipient.email,
        cc: ccEmails.length > 0 ? ccEmails : undefined,
        subject,
        html,
        templateName: 'document_invoice_notification',
        metadata: {
          userId: triggeredByUserId || null,
          userEmail: triggeredByEmail || 'system',
          companyId,
          companyName,
          importId,
          documentId: invoice.id,
          documentType: 'invoice',
          notificationType: 'bulk_email',
          toRecipient: toRecipient.email,
          ccRecipients: ccEmails,
          recipientCount: 1 + ccEmails.length,
          isBulkEmail: true
        }
      });
      
      queuedEmails.push({ type: 'bulk_individual', documentType: 'invoice', jobId: result.job?.id });
    }
    
    // Process credit notes
    for (const creditNote of creditNotes) {
      if (!toRecipient.receiveInvoiceNotification) continue;
      
      const documentUrl = `${portalUrl}/credit-notes/${creditNote.id}/view`;
      const html = renderTemplate('document-notification', {
        userName: toRecipient.name,
        documentTypeName: 'Credit Note',
        documentNumber: creditNote.creditNoteNumber || 'N/A',
        documentDate: formatDate(creditNote.issueDate || creditNote.createdAt),
        documentAmount: formatCurrency(creditNote.amount || 0),
        supplierName: companyName,
        documentUrl,
        retentionPeriod: retentionDays.toString()
      }, settings);
      
      const subject = `New Credit Note - ${creditNote.creditNoteNumber || 'Document'}`;
      const invoiceCC = ccRecipients.filter(r => r.receiveInvoiceNotification);
      const ccEmails = invoiceCC.map(r => r.email);
      
      const result = await queueEmail({
        to: toRecipient.email,
        cc: ccEmails.length > 0 ? ccEmails : undefined,
        subject,
        html,
        templateName: 'document_credit_note_notification',
        metadata: {
          userId: triggeredByUserId || null,
          userEmail: triggeredByEmail || 'system',
          companyId,
          companyName,
          importId,
          documentId: creditNote.id,
          documentType: 'credit_note',
          notificationType: 'bulk_email',
          toRecipient: toRecipient.email,
          ccRecipients: ccEmails,
          recipientCount: 1 + ccEmails.length,
          isBulkEmail: true
        }
      });
      
      queuedEmails.push({ type: 'bulk_individual', documentType: 'credit_note', jobId: result.job?.id });
    }
    
    // Process statements
    for (const statement of statements) {
      if (!toRecipient.receiveStatementNotification) continue;
      
      const documentUrl = `${portalUrl}/statements/${statement.id}/view`;
      const html = renderTemplate('document-notification', {
        userName: toRecipient.name,
        documentTypeName: 'Statement',
        documentNumber: statement.statementNumber || 'N/A',
        documentDate: formatDate(statement.issueDate || statement.createdAt),
        documentAmount: formatCurrency(statement.amount || 0),
        supplierName: companyName,
        documentUrl,
        retentionPeriod: retentionDays.toString()
      }, settings);
      
      const subject = `New Statement - ${statement.statementNumber || 'Document'}`;
      const statementCC = ccRecipients.filter(r => r.receiveStatementNotification);
      const ccEmails = statementCC.map(r => r.email);
      
      const result = await queueEmail({
        to: toRecipient.email,
        cc: ccEmails.length > 0 ? ccEmails : undefined,
        subject,
        html,
        templateName: 'document_statement_notification',
        metadata: {
          userId: triggeredByUserId || null,
          userEmail: triggeredByEmail || 'system',
          companyId,
          companyName,
          importId,
          documentId: statement.id,
          documentType: 'statement',
          notificationType: 'bulk_email',
          toRecipient: toRecipient.email,
          ccRecipients: ccEmails,
          recipientCount: 1 + ccEmails.length,
          isBulkEmail: true
        }
      });
      
      queuedEmails.push({ type: 'bulk_individual', documentType: 'statement', jobId: result.job?.id });
    }
  }
  
  console.log(`[NotificationService] Queued ${queuedEmails.length} bulk emails with CC`);
  
  return {
    recipientCount: 1 + ccRecipients.length,
    emailsQueued: queuedEmails.length,
    emails: queuedEmails
  };
}

module.exports = {
  getNotificationRecipients,
  queueDocumentNotifications,
  queueSummaryEmail,
  queueBatchSummaryEmail,
  queueIndividualEmail,
  queueBatchIndividualEmail
};
