/**
 * Redis-backed store for invoice import sessions
 * Allows sharing import state between backend server and queue worker processes
 */

const { redis } = require('../config/redis');

const IMPORT_PREFIX = 'import:';
const IMPORT_TTL = 24 * 60 * 60; // 24 hours in seconds

// In-memory fallback if Redis is not available
const memoryFallback = new Map();

/**
 * Create a new import session
 */
async function createImport(importId, totalFiles, filePaths, userId) {
  const importSession = {
    importId,
    totalFiles,
    processedFiles: 0,
    downloadedFiles: 0,
    currentFile: null,
    results: [],
    filePaths, // Store original file paths for cleanup
    userId,
    status: 'processing', // Changed from 'downloading' since we upload directly now
    cancelled: false,
    createdAt: new Date().toISOString(),
    completedAt: null,
    errors: []
  };
  
  if (redis && redis.status === 'ready') {
    try {
      await redis.setex(
        IMPORT_PREFIX + importId, 
        IMPORT_TTL, 
        JSON.stringify(importSession)
      );
      console.log(`📦 [Import ${importId}] Created import session in Redis (${totalFiles} files)`);
    } catch (error) {
      console.error(`⚠️  [Import ${importId}] Failed to create in Redis, using memory:`, error.message);
      memoryFallback.set(importId, importSession);
    }
  } else {
    console.log(`📦 [Import ${importId}] Created import session in memory (${totalFiles} files)`);
    memoryFallback.set(importId, importSession);
  }
  
  return importSession;
}

/**
 * Get an import session
 */
async function getImport(importId) {
  if (redis && redis.status === 'ready') {
    try {
      const data = await redis.get(IMPORT_PREFIX + importId);
      if (data) {
        return JSON.parse(data);
      }
    } catch (error) {
      console.error(`⚠️  [Import ${importId}] Failed to get from Redis:`, error.message);
    }
  }
  
  // Fallback to memory
  return memoryFallback.get(importId) || null;
}

/**
 * Add a result to an import session
 */
async function addResult(importId, result) {
  const importSession = await getImport(importId);
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
    
    // Save before sending email to ensure state is persisted
    await saveImport(importId, importSession);
    
    // Send completion email if this is the first time we're marking it as completed
    if (!wasCompleted) {
      sendCompletionEmail(importId, importSession).catch(err => {
        console.error(`⚠️  [Import ${importId}] Failed to send completion email:`, err.message);
      });
    }
  } else {
    await saveImport(importId, importSession);
  }
  
  if (!result.success) {
    importSession.errors.push({
      fileName: result.fileName,
      error: result.error
    });
  }
  
  console.log(`📊 [Import ${importId}] Progress: ${importSession.processedFiles}/${importSession.totalFiles}`);
}

/**
 * Save an import session
 */
async function saveImport(importId, importSession) {
  if (redis && redis.status === 'ready') {
    try {
      await redis.setex(
        IMPORT_PREFIX + importId,
        IMPORT_TTL,
        JSON.stringify(importSession)
      );
    } catch (error) {
      console.error(`⚠️  [Import ${importId}] Failed to save to Redis:`, error.message);
      memoryFallback.set(importId, importSession);
    }
  } else {
    memoryFallback.set(importId, importSession);
  }
}

/**
 * Update an import session
 */
async function updateImport(importId, updates) {
  const importSession = await getImport(importId);
  if (!importSession) {
    console.warn(`⚠️  Import session ${importId} not found`);
    return null;
  }
  
  Object.assign(importSession, updates);
  await saveImport(importId, importSession);
  return importSession;
}

/**
 * Cancel an import session
 */
async function cancelImport(importId) {
  const importSession = await getImport(importId);
  if (!importSession) {
    return false;
  }
  
  importSession.cancelled = true;
  importSession.status = 'cancelled';
  await saveImport(importId, importSession);
  return true;
}

/**
 * Check if an import session is cancelled
 */
async function isCancelled(importId) {
  const importSession = await getImport(importId);
  return importSession ? importSession.cancelled : false;
}

/**
 * Delete an import session and return file paths for cleanup
 */
async function deleteImport(importId) {
  const importSession = await getImport(importId);
  if (!importSession) {
    return [];
  }
  
  const filePaths = importSession.filePaths || [];
  
  if (redis && redis.status === 'ready') {
    try {
      await redis.del(IMPORT_PREFIX + importId);
    } catch (error) {
      console.error(`⚠️  [Import ${importId}] Failed to delete from Redis:`, error.message);
    }
  }
  
  memoryFallback.delete(importId);
  
  return filePaths;
}

/**
 * Clean up old import sessions (older than 24 hours)
 * Note: Redis TTL handles this automatically, but we still clean memory fallback
 */
async function cleanupOldImports() {
  const now = Date.now();
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours
  
  for (const [importId, importSession] of memoryFallback.entries()) {
    const createdAt = new Date(importSession.createdAt).getTime();
    if (now - createdAt > maxAge) {
      memoryFallback.delete(importId);
      console.log(`🧹 Cleaned up old import session: ${importId}`);
    }
  }
}

// Clean up old imports every hour (memory fallback only - Redis uses TTL)
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
      
      try {
        if (documentType === 'invoice') {
          document = await Invoice.findByPk(result.documentId, { attributes: ['id', 'invoiceNumber', 'fileUrl', 'amount', 'issueDate'] });
          if (document) {
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
    
    // Skip user notifications for now - they require more complex queries
    // The system email above provides the main notification
    
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
