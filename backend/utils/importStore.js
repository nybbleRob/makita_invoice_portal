/**
 * In-memory store for invoice import sessions
 * Similar to bulkTestStore but for actual imports
 */

const imports = new Map();

/**
 * Create a new import session
 */
function createImport(importId, totalFiles, filePaths, userId) {
  imports.set(importId, {
    importId,
    totalFiles,
    processedFiles: 0,
    downloadedFiles: 0,
    currentFile: null,
    results: [],
    filePaths, // Store original file paths for cleanup
    userId,
    status: 'downloading',
    cancelled: false,
    createdAt: new Date().toISOString(),
    completedAt: null,
    errors: []
  });
  
  return imports.get(importId);
}

/**
 * Add a result to an import session
 */
function addResult(importId, result) {
  const importSession = imports.get(importId);
  if (!importSession) {
    console.warn(`⚠️  Import session ${importId} not found`);
    return;
  }
  
  importSession.results.push(result);
  importSession.processedFiles++;
  
  // Update status
  if (importSession.processedFiles >= importSession.totalFiles) {
    const wasCompleted = importSession.status === 'completed';
    importSession.status = 'completed';
    importSession.completedAt = new Date().toISOString();
    
    // Send completion email if this is the first time we're marking it as completed
    if (!wasCompleted) {
      sendCompletionEmail(importId, importSession).catch(err => {
        console.error(`⚠️  [Import ${importId}] Failed to send completion email:`, err.message);
      });
    }
  }
  
  if (!result.success) {
    importSession.errors.push({
      fileName: result.fileName,
      error: result.error
    });
  }
}

/**
 * Update an import session
 */
function updateImport(importId, updates) {
  const importSession = imports.get(importId);
  if (!importSession) {
    console.warn(`⚠️  Import session ${importId} not found`);
    return;
  }
  
  Object.assign(importSession, updates);
  return importSession;
}

/**
 * Get an import session
 */
function getImport(importId) {
  return imports.get(importId);
}

/**
 * Cancel an import session
 */
function cancelImport(importId) {
  const importSession = imports.get(importId);
  if (!importSession) {
    return false;
  }
  
  importSession.cancelled = true;
  importSession.status = 'cancelled';
  return true;
}

/**
 * Check if an import session is cancelled
 */
function isCancelled(importId) {
  const importSession = imports.get(importId);
  return importSession ? importSession.cancelled : false;
}

/**
 * Delete an import session and return file paths for cleanup
 */
function deleteImport(importId) {
  const importSession = imports.get(importId);
  if (!importSession) {
    return [];
  }
  
  const filePaths = importSession.filePaths || [];
  imports.delete(importId);
  
  return filePaths;
}

/**
 * Clean up old import sessions (older than 24 hours)
 */
function cleanupOldImports() {
  const now = Date.now();
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours
  
  for (const [importId, importSession] of imports.entries()) {
    const createdAt = new Date(importSession.createdAt).getTime();
    if (now - createdAt > maxAge) {
      imports.delete(importId);
      console.log(`🧹 Cleaned up old import session: ${importId}`);
    }
  }
}

// Clean up old imports every hour
setInterval(cleanupOldImports, 60 * 60 * 1000);

/**
 * Send completion email when import finishes
 * Sends to:
 * 1. System global email (Settings.systemEmail)
 * 2. Users assigned to companies that received invoices/credit notes (based on email preferences)
 */
async function sendCompletionEmail(importId, importSession) {
  try {
    const { Settings, User, Company, Invoice, CreditNote, Statement } = require('../models');
    const { queueEmail } = require('./emailQueue');
    const fs = require('fs');
    const path = require('path');
    const { Op } = require('sequelize');
    
    // Get settings to find email configuration
    const settings = await Settings.findOne();
    if (!settings) {
      console.log(`⚠️  [Import ${importId}] No settings found, skipping completion email`);
      return;
    }
    
    // Get email provider config
    const emailProvider = settings.emailProvider;
    if (!emailProvider || !emailProvider.enabled) {
      console.log(`⚠️  [Import ${importId}] Email provider not configured, skipping completion email`);
      return;
    }
    
    // Calculate summary
    const successful = importSession.results.filter(r => r.success).length;
    const failed = importSession.results.filter(r => !r.success).length;
    const matched = importSession.results.filter(r => r.companyId).length;
    const unallocated = importSession.results.filter(r => r.success && !r.companyId).length;
    
    // Build email content using the same template system as other emails
    const { wrapEmailContent } = require('./emailTheme');
    
    // 1. Send summary email to system global email
    if (settings.systemEmail) {
      const emailSubject = `Document Import Completed - ${importSession.totalFiles} file(s) processed`;
      const emailContent = `
        <h2>Document Import Completed</h2>
        <p>The document import has been completed successfully.</p>
        <table style="border-collapse: collapse; width: 100%; margin: 20px 0;">
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd;"><strong>Total Files:</strong></td>
            <td style="padding: 8px; border: 1px solid #ddd;">${importSession.totalFiles}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd;"><strong>Successfully Processed:</strong></td>
            <td style="padding: 8px; border: 1px solid #ddd;">${successful}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd;"><strong>Matched to Companies:</strong></td>
            <td style="padding: 8px; border: 1px solid #ddd;">${matched}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd;"><strong>Unallocated:</strong></td>
            <td style="padding: 8px; border: 1px solid #ddd;">${unallocated}</td>
          </tr>
          ${failed > 0 ? `
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd;"><strong>Failed:</strong></td>
            <td style="padding: 8px; border: 1px solid #ddd; color: #dc3545;">${failed}</td>
          </tr>
          ` : ''}
        </table>
        <p><strong>Import ID:</strong> ${importId}</p>
        <p><strong>Completed:</strong> ${new Date(importSession.completedAt).toLocaleString()}</p>
      `;
      
      const themedContent = wrapEmailContent(emailContent, settings);
      
      try {
        await queueEmail({
          to: settings.systemEmail,
          subject: emailSubject,
          html: themedContent,
          settings,
          metadata: {
            type: 'system_summary',
            importId
          },
          priority: 10 // Higher priority for system emails
        });
        console.log(`📧 [Import ${importId}] Queued summary email to system email: ${settings.systemEmail}`);
      } catch (emailError) {
        console.error(`⚠️  [Import ${importId}] Failed to send system email:`, emailError.message);
      }
    }
    
    // 2. Group successful results by company and document type
    const companyDocuments = new Map(); // companyId -> { invoices: [], creditNotes: [], statements: [] }
    
    for (const result of importSession.results) {
      if (!result.success || !result.companyId || !result.documentId) {
        continue; // Skip failed or unallocated documents
      }
      
      const companyId = result.companyId;
      const documentType = result.documentType || 'invoice'; // Default to invoice
      
      if (!companyDocuments.has(companyId)) {
        companyDocuments.set(companyId, {
          invoices: [],
          creditNotes: [],
          statements: []
        });
      }
      
      const companyData = companyDocuments.get(companyId);
      
      // Fetch the actual document to get fileUrl
      let document = null;
      let fileUrl = null;
      
      try {
        if (documentType === 'invoice') {
          document = await Invoice.findByPk(result.documentId, { attributes: ['id', 'invoiceNumber', 'fileUrl', 'amount', 'issueDate'] });
          if (document) {
            fileUrl = document.fileUrl;
            companyData.invoices.push({
              id: document.id,
              number: document.invoiceNumber,
              amount: document.amount,
              date: document.issueDate,
              fileUrl: document.fileUrl,
              fileName: result.fileName
            });
          }
        } else if (documentType === 'credit_note') {
          document = await CreditNote.findByPk(result.documentId, { attributes: ['id', 'creditNoteNumber', 'fileUrl', 'amount', 'issueDate'] });
          if (document) {
            fileUrl = document.fileUrl;
            companyData.creditNotes.push({
              id: document.id,
              number: document.creditNoteNumber,
              amount: document.amount,
              date: document.issueDate,
              fileUrl: document.fileUrl,
              fileName: result.fileName
            });
          }
        } else if (documentType === 'statement') {
          document = await Statement.findByPk(result.documentId, { attributes: ['id', 'statementNumber', 'fileUrl', 'periodStart', 'periodEnd'] });
          if (document) {
            fileUrl = document.fileUrl;
            companyData.statements.push({
              id: document.id,
              number: document.statementNumber,
              periodStart: document.periodStart,
              periodEnd: document.periodEnd,
              fileUrl: document.fileUrl,
              fileName: result.fileName
            });
          }
        }
      } catch (docError) {
        console.error(`⚠️  [Import ${importId}] Failed to fetch document ${result.documentId}:`, docError.message);
        continue;
      }
    }
    
    // 3. Collect all users who should receive emails (across all companies)
    // First, get all unique company IDs
    const allCompanyIds = Array.from(companyDocuments.keys());
    
    // Get all users with allCompanies = true
    const usersWithAllCompanies = await User.findAll({
      where: {
        isActive: true,
        allCompanies: true
      },
      attributes: ['id', 'name', 'email', 'sendInvoiceEmail', 'sendInvoiceAttachment', 'sendStatementEmail', 'sendStatementAttachment', 'sendEmailAsSummary']
    });
    
    // Get all users assigned to any of the companies
    const usersAssignedToCompanies = await User.findAll({
      where: {
        isActive: true,
        allCompanies: false
      },
      include: [{
        model: Company,
        as: 'companies',
        where: { id: { [Op.in]: allCompanyIds } },
        through: { attributes: [] },
        required: true
      }],
      attributes: ['id', 'name', 'email', 'sendInvoiceEmail', 'sendInvoiceAttachment', 'sendStatementEmail', 'sendStatementAttachment', 'sendEmailAsSummary']
    });
    
    // Combine and deduplicate users
    const allUsersMap = new Map();
    for (const user of usersWithAllCompanies) {
      allUsersMap.set(user.id, user);
    }
    for (const user of usersAssignedToCompanies) {
      allUsersMap.set(user.id, user);
    }
    const allUsers = Array.from(allUsersMap.values());
    
    // Separate users into summary and individual email groups
    const summaryUsers = allUsers.filter(user => user.sendEmailAsSummary);
    const individualUsers = allUsers.filter(user => !user.sendEmailAsSummary);
    
    // 4. Send summary emails to users who prefer summaries
    for (const user of summaryUsers) {
      try {
        // Collect all documents from all companies for this user
        const userInvoices = [];
        const userCreditNotes = [];
        const userStatements = [];
        const userCompanies = new Set();
        
        for (const [companyId, documents] of companyDocuments.entries()) {
          // Check if user has access to this company
          // Users with allCompanies have access to all companies
          let hasAccess = user.allCompanies;
          
          // If not allCompanies, check if user is assigned to this company
          if (!hasAccess) {
            // Check if user is in the usersAssignedToCompanies list (which includes this company)
            const userWithCompanies = usersAssignedToCompanies.find(u => u.id === user.id);
            hasAccess = userWithCompanies && userWithCompanies.companies && 
                       userWithCompanies.companies.some(c => c.id === companyId);
          }
          
          if (!hasAccess) continue;
          
          const company = await Company.findByPk(companyId, { attributes: ['id', 'name', 'referenceNo'] });
          if (!company) continue;
          
          userCompanies.add(company);
          
          // Add documents with company info
          for (const invoice of documents.invoices) {
            userInvoices.push({ ...invoice, companyName: company.name, companyReference: company.referenceNo });
          }
          for (const creditNote of documents.creditNotes) {
            userCreditNotes.push({ ...creditNote, companyName: company.name, companyReference: company.referenceNo });
          }
          for (const statement of documents.statements) {
            userStatements.push({ ...statement, companyName: company.name, companyReference: company.referenceNo });
          }
        }
        
        // Send summary email if user has enabled emails and there are documents
        if ((userInvoices.length > 0 || userCreditNotes.length > 0) && user.sendInvoiceEmail) {
          const invoiceCount = userInvoices.length;
          const creditNoteCount = userCreditNotes.length;
          const totalCount = invoiceCount + creditNoteCount;
          
          const emailSubject = `Document Import Summary - ${totalCount} new document${totalCount !== 1 ? 's' : ''} available`;
          
          let emailContent = `
            <h2>Document Import Summary</h2>
            <p>Dear ${user.name || user.email},</p>
            <p>${totalCount} new document${totalCount !== 1 ? 's' : ''} ${totalCount !== 1 ? 'have' : 'has'} been processed across ${userCompanies.size} compan${userCompanies.size !== 1 ? 'ies' : 'y'}.</p>
          `;
          
          if (userInvoices.length > 0) {
            emailContent += `
              <h3>Invoices (${invoiceCount})</h3>
              <table style="border-collapse: collapse; width: 100%; margin: 10px 0;">
                <thead>
                  <tr style="background-color: #f5f5f5;">
                    <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Company</th>
                    <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Invoice Number</th>
                    <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Date</th>
                    <th style="padding: 8px; border: 1px solid #ddd; text-align: right;">Amount</th>
                  </tr>
                </thead>
                <tbody>
            `;
            for (const invoice of userInvoices) {
              const formattedAmount = `£${parseFloat(invoice.amount || 0).toFixed(2)}`;
              const formattedDate = invoice.date ? new Date(invoice.date).toLocaleDateString('en-GB') : 'N/A';
              emailContent += `
                <tr>
                  <td style="padding: 8px; border: 1px solid #ddd;">${invoice.companyName} (${invoice.companyReference || 'N/A'})</td>
                  <td style="padding: 8px; border: 1px solid #ddd;">${invoice.number}</td>
                  <td style="padding: 8px; border: 1px solid #ddd;">${formattedDate}</td>
                  <td style="padding: 8px; border: 1px solid #ddd; text-align: right;">${formattedAmount}</td>
                </tr>
              `;
            }
            emailContent += `</tbody></table>`;
          }
          
          if (userCreditNotes.length > 0) {
            emailContent += `
              <h3>Credit Notes (${creditNoteCount})</h3>
              <table style="border-collapse: collapse; width: 100%; margin: 10px 0;">
                <thead>
                  <tr style="background-color: #f5f5f5;">
                    <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Company</th>
                    <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Credit Note Number</th>
                    <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Date</th>
                    <th style="padding: 8px; border: 1px solid #ddd; text-align: right;">Amount</th>
                  </tr>
                </thead>
                <tbody>
            `;
            for (const creditNote of userCreditNotes) {
              const formattedAmount = `£${parseFloat(creditNote.amount || 0).toFixed(2)}`;
              const formattedDate = creditNote.date ? new Date(creditNote.date).toLocaleDateString('en-GB') : 'N/A';
              emailContent += `
                <tr>
                  <td style="padding: 8px; border: 1px solid #ddd;">${creditNote.companyName} (${creditNote.companyReference || 'N/A'})</td>
                  <td style="padding: 8px; border: 1px solid #ddd;">${creditNote.number}</td>
                  <td style="padding: 8px; border: 1px solid #ddd;">${formattedDate}</td>
                  <td style="padding: 8px; border: 1px solid #ddd; text-align: right;">${formattedAmount}</td>
                </tr>
              `;
            }
            emailContent += `</tbody></table>`;
          }
          
          emailContent += `
            <p style="margin-top: 20px;">
              <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/invoices" style="background-color: #206bc4; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; display: inline-block;">
                View All Documents
              </a>
            </p>
          `;
          
          const themedContent = wrapEmailContent(emailContent, settings);
          
          // Prepare attachments if user wants them
          const attachments = [];
          if (user.sendInvoiceAttachment) {
            const { STORAGE_BASE } = require('../config/storage');
            
            for (const invoice of userInvoices) {
              if (invoice.fileUrl) {
                let filePath = invoice.fileUrl;
                if (!path.isAbsolute(filePath)) {
                  filePath = path.join(STORAGE_BASE, filePath.replace(/^\//, ''));
                }
                if (fs.existsSync(filePath)) {
                  attachments.push({
                    filename: invoice.fileName || `Invoice_${invoice.number}.pdf`,
                    path: filePath,
                    contentType: 'application/pdf'
                  });
                }
              }
            }
            for (const creditNote of userCreditNotes) {
              if (creditNote.fileUrl) {
                let filePath = creditNote.fileUrl;
                if (!path.isAbsolute(filePath)) {
                  filePath = path.join(STORAGE_BASE, filePath.replace(/^\//, ''));
                }
                if (fs.existsSync(filePath)) {
                  attachments.push({
                    filename: creditNote.fileName || `CreditNote_${creditNote.number}.pdf`,
                    path: filePath,
                    contentType: 'application/pdf'
                  });
                }
              }
            }
          }
          
          // Queue email instead of sending synchronously
          const { queueEmail } = require('./emailQueue');
          await queueEmail({
            to: user.email,
            subject: emailSubject,
            html: themedContent,
            attachments: attachments.length > 0 ? attachments : undefined,
            settings,
            metadata: {
              type: 'summary',
              importId,
              userId: user.id,
              documentCount: totalCount
            }
          });
          
          console.log(`📧 [Import ${importId}] Sent summary email to ${user.email} (${totalCount} documents, ${attachments.length} attachment${attachments.length !== 1 ? 's' : ''})`);
        }
        
        // Send statement summary email if enabled
        if (userStatements.length > 0 && user.sendStatementEmail) {
          const statementCount = userStatements.length;
          const emailSubject = `Statement Import Summary - ${statementCount} new statement${statementCount !== 1 ? 's' : ''} available`;
          
          let emailContent = `
            <h2>Statement Import Summary</h2>
            <p>Dear ${user.name || user.email},</p>
            <p>${statementCount} new statement${statementCount !== 1 ? 's' : ''} ${statementCount !== 1 ? 'have' : 'has'} been processed across ${userCompanies.size} compan${userCompanies.size !== 1 ? 'ies' : 'y'}.</p>
            <table style="border-collapse: collapse; width: 100%; margin: 10px 0;">
              <thead>
                <tr style="background-color: #f5f5f5;">
                  <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Company</th>
                  <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Statement Number</th>
                  <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Period</th>
                </tr>
              </thead>
              <tbody>
          `;
          
          for (const statement of userStatements) {
            const periodStart = statement.periodStart ? new Date(statement.periodStart).toLocaleDateString('en-GB') : 'N/A';
            const periodEnd = statement.periodEnd ? new Date(statement.periodEnd).toLocaleDateString('en-GB') : 'N/A';
            emailContent += `
              <tr>
                <td style="padding: 8px; border: 1px solid #ddd;">${statement.companyName} (${statement.companyReference || 'N/A'})</td>
                <td style="padding: 8px; border: 1px solid #ddd;">${statement.number}</td>
                <td style="padding: 8px; border: 1px solid #ddd;">${periodStart} - ${periodEnd}</td>
              </tr>
            `;
          }
          
          emailContent += `
              </tbody>
            </table>
            <p style="margin-top: 20px;">
              <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/statements" style="background-color: #206bc4; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; display: inline-block;">
                View All Statements
              </a>
            </p>
          `;
          
          const themedContent = wrapEmailContent(emailContent, settings);
          
          // Prepare attachments if user wants them
          const attachments = [];
          if (user.sendStatementAttachment) {
            const { STORAGE_BASE } = require('../config/storage');
            
            for (const statement of userStatements) {
              if (statement.fileUrl) {
                let filePath = statement.fileUrl;
                if (!path.isAbsolute(filePath)) {
                  filePath = path.join(STORAGE_BASE, filePath.replace(/^\//, ''));
                }
                if (fs.existsSync(filePath)) {
                  attachments.push({
                    filename: statement.fileName || `Statement_${statement.number}.pdf`,
                    path: filePath,
                    contentType: 'application/pdf'
                  });
                }
              }
            }
          }
          
          // Queue email instead of sending synchronously
          const { queueEmail } = require('./emailQueue');
          await queueEmail({
            to: user.email,
            subject: emailSubject,
            html: themedContent,
            attachments: attachments.length > 0 ? attachments : undefined,
            settings,
            metadata: {
              type: 'summary',
              importId,
              userId: user.id,
              documentCount: totalCount
            }
          });
          
          console.log(`📧 [Import ${importId}] Sent statement summary email to ${user.email} (${statementCount} statements, ${attachments.length} attachment${attachments.length !== 1 ? 's' : ''})`);
        }
      } catch (userError) {
        console.error(`⚠️  [Import ${importId}] Failed to send summary email to user ${user.email}:`, userError.message);
      }
    }
    
    // 5. Send individual emails per company to users who prefer individual emails
    for (const [companyId, documents] of companyDocuments.entries()) {
      try {
        // Get company info
        const company = await Company.findByPk(companyId, { attributes: ['id', 'name', 'referenceNo'] });
        if (!company) {
          console.warn(`⚠️  [Import ${importId}] Company ${companyId} not found, skipping email notifications`);
          continue;
        }
        
        // Filter to only users who want individual emails and have access to this company
        const companyUsers = individualUsers.filter(user => {
          if (user.allCompanies) return true;
          return user.companies && user.companies.some(c => c.id === companyId);
        });
        
        // Send emails to each user based on their preferences
        for (const user of companyUsers) {
          try {
            // Check if user wants invoice/credit note emails
            const hasInvoices = documents.invoices.length > 0;
            const hasCreditNotes = documents.creditNotes.length > 0;
            const hasStatements = documents.statements.length > 0;
            
            // Send invoice/credit note email if enabled
            if ((hasInvoices || hasCreditNotes) && user.sendInvoiceEmail) {
              const invoiceCount = documents.invoices.length;
              const creditNoteCount = documents.creditNotes.length;
              const totalCount = invoiceCount + creditNoteCount;
              
              const documentTypeLabel = invoiceCount > 0 && creditNoteCount > 0 
                ? 'Invoices and Credit Notes'
                : invoiceCount > 0 
                  ? 'Invoices' 
                  : 'Credit Notes';
              
              const emailSubject = `New ${documentTypeLabel} Available - ${company.name}`;
              
              let emailContent = `
                <h2>New ${documentTypeLabel} Available</h2>
                <p>Dear ${user.name || user.email},</p>
                <p>${totalCount} new document${totalCount !== 1 ? 's' : ''} ${totalCount !== 1 ? 'have' : 'has'} been processed for <strong>${company.name}</strong> (Account: ${company.referenceNo || 'N/A'}).</p>
              `;
              
              if (hasInvoices) {
                emailContent += `
                  <h3>Invoices (${invoiceCount})</h3>
                  <table style="border-collapse: collapse; width: 100%; margin: 10px 0;">
                    <thead>
                      <tr style="background-color: #f5f5f5;">
                        <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Invoice Number</th>
                        <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Date</th>
                        <th style="padding: 8px; border: 1px solid #ddd; text-align: right;">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                `;
                for (const invoice of documents.invoices) {
                  const formattedAmount = `£${parseFloat(invoice.amount || 0).toFixed(2)}`;
                  const formattedDate = invoice.date ? new Date(invoice.date).toLocaleDateString('en-GB') : 'N/A';
                  emailContent += `
                    <tr>
                      <td style="padding: 8px; border: 1px solid #ddd;">${invoice.number}</td>
                      <td style="padding: 8px; border: 1px solid #ddd;">${formattedDate}</td>
                      <td style="padding: 8px; border: 1px solid #ddd; text-align: right;">${formattedAmount}</td>
                    </tr>
                  `;
                }
                emailContent += `</tbody></table>`;
              }
              
              if (hasCreditNotes) {
                emailContent += `
                  <h3>Credit Notes (${creditNoteCount})</h3>
                  <table style="border-collapse: collapse; width: 100%; margin: 10px 0;">
                    <thead>
                      <tr style="background-color: #f5f5f5;">
                        <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Credit Note Number</th>
                        <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Date</th>
                        <th style="padding: 8px; border: 1px solid #ddd; text-align: right;">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                `;
                for (const creditNote of documents.creditNotes) {
                  const formattedAmount = `£${parseFloat(creditNote.amount || 0).toFixed(2)}`;
                  const formattedDate = creditNote.date ? new Date(creditNote.date).toLocaleDateString('en-GB') : 'N/A';
                  emailContent += `
                    <tr>
                      <td style="padding: 8px; border: 1px solid #ddd;">${creditNote.number}</td>
                      <td style="padding: 8px; border: 1px solid #ddd;">${formattedDate}</td>
                      <td style="padding: 8px; border: 1px solid #ddd; text-align: right;">${formattedAmount}</td>
                    </tr>
                  `;
                }
                emailContent += `</tbody></table>`;
              }
              
              emailContent += `
                <p style="margin-top: 20px;">
                  <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/invoices" style="background-color: #206bc4; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; display: inline-block;">
                    View Documents
                  </a>
                </p>
              `;
              
              const themedContent = wrapEmailContent(emailContent, settings);
              
              // Prepare attachments if user wants them
              const attachments = [];
              if (user.sendInvoiceAttachment) {
                const { STORAGE_BASE } = require('../config/storage');
                
                // Add invoice attachments
                for (const invoice of documents.invoices) {
                  if (invoice.fileUrl) {
                    // Handle both absolute and relative paths
                    let filePath = invoice.fileUrl;
                    if (!path.isAbsolute(filePath)) {
                      filePath = path.join(STORAGE_BASE, filePath.replace(/^\//, ''));
                    }
                    
                    if (fs.existsSync(filePath)) {
                      attachments.push({
                        filename: invoice.fileName || `Invoice_${invoice.number}.pdf`,
                        path: filePath,
                        contentType: 'application/pdf'
                      });
                    } else {
                      console.warn(`⚠️  [Import ${importId}] Invoice file not found: ${filePath}`);
                    }
                  }
                }
                // Add credit note attachments
                for (const creditNote of documents.creditNotes) {
                  if (creditNote.fileUrl) {
                    // Handle both absolute and relative paths
                    let filePath = creditNote.fileUrl;
                    if (!path.isAbsolute(filePath)) {
                      filePath = path.join(STORAGE_BASE, filePath.replace(/^\//, ''));
                    }
                    
                    if (fs.existsSync(filePath)) {
                      attachments.push({
                        filename: creditNote.fileName || `CreditNote_${creditNote.number}.pdf`,
                        path: filePath,
                        contentType: 'application/pdf'
                      });
                    } else {
                      console.warn(`⚠️  [Import ${importId}] Credit note file not found: ${filePath}`);
                    }
                  }
                }
              }
              
              // Queue email instead of sending synchronously
              await queueEmail({
                to: user.email,
                subject: emailSubject,
                html: themedContent,
                attachments: attachments.length > 0 ? attachments : undefined,
                settings,
                metadata: {
                  type: 'individual_invoice',
                  importId,
                  userId: user.id,
                  companyId: company.id,
                  documentCount: totalCount
                }
              });
              
              console.log(`📧 [Import ${importId}] Queued ${documentTypeLabel} email to ${user.email} (${attachments.length} attachment${attachments.length !== 1 ? 's' : ''})`);
            }
            
            // Send statement email if enabled
            if (hasStatements && user.sendStatementEmail) {
              const statementCount = documents.statements.length;
              const emailSubject = `New Statement${statementCount !== 1 ? 's' : ''} Available - ${company.name}`;
              
              let emailContent = `
                <h2>New Statement${statementCount !== 1 ? 's' : ''} Available</h2>
                <p>Dear ${user.name || user.email},</p>
                <p>${statementCount} new statement${statementCount !== 1 ? 's' : ''} ${statementCount !== 1 ? 'have' : 'has'} been processed for <strong>${company.name}</strong> (Account: ${company.referenceNo || 'N/A'}).</p>
                <table style="border-collapse: collapse; width: 100%; margin: 10px 0;">
                  <thead>
                    <tr style="background-color: #f5f5f5;">
                      <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Statement Number</th>
                      <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Period</th>
                    </tr>
                  </thead>
                  <tbody>
              `;
              
              for (const statement of documents.statements) {
                const periodStart = statement.periodStart ? new Date(statement.periodStart).toLocaleDateString('en-GB') : 'N/A';
                const periodEnd = statement.periodEnd ? new Date(statement.periodEnd).toLocaleDateString('en-GB') : 'N/A';
                emailContent += `
                  <tr>
                    <td style="padding: 8px; border: 1px solid #ddd;">${statement.number}</td>
                    <td style="padding: 8px; border: 1px solid #ddd;">${periodStart} - ${periodEnd}</td>
                  </tr>
                `;
              }
              
              emailContent += `
                  </tbody>
                </table>
                <p style="margin-top: 20px;">
                  <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/statements" style="background-color: #206bc4; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; display: inline-block;">
                    View Statements
                  </a>
                </p>
              `;
              
              const themedContent = wrapEmailContent(emailContent, settings);
              
              // Prepare attachments if user wants them
              const attachments = [];
              if (user.sendStatementAttachment) {
                const { STORAGE_BASE } = require('../config/storage');
                
                for (const statement of documents.statements) {
                  if (statement.fileUrl) {
                    // Handle both absolute and relative paths
                    let filePath = statement.fileUrl;
                    if (!path.isAbsolute(filePath)) {
                      filePath = path.join(STORAGE_BASE, filePath.replace(/^\//, ''));
                    }
                    
                    if (fs.existsSync(filePath)) {
                      attachments.push({
                        filename: statement.fileName || `Statement_${statement.number}.pdf`,
                        path: filePath,
                        contentType: 'application/pdf'
                      });
                    } else {
                      console.warn(`⚠️  [Import ${importId}] Statement file not found: ${filePath}`);
                    }
                  }
                }
              }
              
              // Queue email instead of sending synchronously
              await queueEmail({
                to: user.email,
                subject: emailSubject,
                html: themedContent,
                attachments: attachments.length > 0 ? attachments : undefined,
                settings,
                metadata: {
                  type: 'individual_statement',
                  importId,
                  userId: user.id,
                  companyId: company.id,
                  statementCount: documents.statements.length
                }
              });
              
              console.log(`📧 [Import ${importId}] Queued statement email to ${user.email} (${attachments.length} attachment${attachments.length !== 1 ? 's' : ''})`);
            }
          } catch (userEmailError) {
            console.error(`⚠️  [Import ${importId}] Failed to send email to user ${user.email}:`, userEmailError.message);
            // Continue with other users
          }
        }
      } catch (companyError) {
        console.error(`⚠️  [Import ${importId}] Error processing company ${companyId}:`, companyError.message);
        // Continue with other companies
      }
    }
    
    console.log(`✅ [Import ${importId}] Email notifications completed`);
  } catch (error) {
    console.error(`⚠️  [Import ${importId}] Error sending completion emails:`, error.message);
    console.error(error.stack);
    // Don't throw - email failure shouldn't break the import
  }
}

module.exports = {
  createImport,
  addResult,
  updateImport,
  getImport,
  cancelImport,
  isCancelled,
  deleteImport,
  cleanupOldImports
};

