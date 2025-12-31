/**
 * Database Transaction Utility
 * Provides helper functions for wrapping operations in transactions
 */

const { sequelize } = require('../config/database');

/**
 * Execute a function within a database transaction
 * Automatically commits on success and rolls back on error
 * 
 * @param {Function} fn - Async function to execute (receives transaction as argument)
 * @returns {Promise<any>} Result from the function
 * @throws {Error} Re-throws any error after rolling back
 * 
 * @example
 * const result = await withTransaction(async (t) => {
 *   const file = await File.create({ ... }, { transaction: t });
 *   const invoice = await Invoice.create({ ... }, { transaction: t });
 *   return { file, invoice };
 * });
 */
async function withTransaction(fn) {
  const t = await sequelize.transaction();
  
  try {
    const result = await fn(t);
    await t.commit();
    return result;
  } catch (error) {
    await t.rollback();
    throw error;
  }
}

/**
 * Create multiple related records atomically
 * Useful for creating File + Invoice/CreditNote pairs
 * 
 * @param {Object} options - Options object
 * @param {Object} options.fileData - Data for File.create()
 * @param {Object} options.documentData - Data for Invoice.create() or CreditNote.create()
 * @param {string} options.documentType - 'invoice' or 'credit_note'
 * @returns {Promise<Object>} Object containing { file, document }
 */
async function createFileWithDocument(options) {
  const { fileData, documentData, documentType } = options;
  const { File, Invoice, CreditNote } = require('../models');
  
  return withTransaction(async (t) => {
    // Create file record first
    const file = await File.create(fileData, { transaction: t });
    
    // Create document record if data provided
    let document = null;
    if (documentData) {
      // Add file reference to document
      const docDataWithFile = {
        ...documentData,
        fileUrl: file.filePath,
        metadata: {
          ...(documentData.metadata || {}),
          fileId: file.id
        }
      };
      
      if (documentType === 'credit_note') {
        document = await CreditNote.create(docDataWithFile, { transaction: t });
      } else {
        document = await Invoice.create(docDataWithFile, { transaction: t });
      }
    }
    
    return { file, document };
  });
}

/**
 * Update file and create document atomically
 * Used when file record already exists but document needs to be created
 * 
 * @param {Object} options - Options object
 * @param {Object} options.file - Existing file instance to update
 * @param {Object} options.fileUpdates - Data to update on file
 * @param {Object} options.documentData - Data for Invoice.create() or CreditNote.create()
 * @param {string} options.documentType - 'invoice' or 'credit_note'
 * @returns {Promise<Object>} Object containing { file, document }
 */
async function updateFileAndCreateDocument(options) {
  const { file, fileUpdates, documentData, documentType } = options;
  const { Invoice, CreditNote } = require('../models');
  
  return withTransaction(async (t) => {
    // Update file record
    if (fileUpdates) {
      Object.assign(file, fileUpdates);
      await file.save({ transaction: t });
    }
    
    // Create document record if data provided
    let document = null;
    if (documentData) {
      // Add file reference to document
      const docDataWithFile = {
        ...documentData,
        fileUrl: file.filePath,
        metadata: {
          ...(documentData.metadata || {}),
          fileId: file.id
        }
      };
      
      if (documentType === 'credit_note') {
        document = await CreditNote.create(docDataWithFile, { transaction: t });
      } else {
        document = await Invoice.create(docDataWithFile, { transaction: t });
      }
    }
    
    return { file, document };
  });
}

module.exports = {
  withTransaction,
  createFileWithDocument,
  updateFileAndCreateDocument
};

