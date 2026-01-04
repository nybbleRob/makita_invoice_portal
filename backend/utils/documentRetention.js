/**
 * Document Retention Utility
 * Calculates retention start dates, expiry dates, and checks if documents should be deleted
 */

/**
 * Calculate retention expiry date from start date and retention period
 * @param {number|null} retentionPeriod - Retention period in days (14, 30, 60, 90, or null for disabled)
 * @param {Date} startDate - Date when retention countdown begins
 * @returns {Date|null} - Calculated expiry date, or null if retention is disabled
 */
function calculateRetentionExpiryDate(retentionPeriod, startDate) {
  if (!retentionPeriod || !startDate) {
    return null;
  }
  
  if (!(startDate instanceof Date)) {
    startDate = new Date(startDate);
  }
  
  const expiryDate = new Date(startDate);
  expiryDate.setDate(expiryDate.getDate() + retentionPeriod);
  
  // Normalize to midnight (00:00:00) of the expiry day
  // This ensures the daily midnight cleanup job catches all documents expiring that day
  expiryDate.setHours(0, 0, 0, 0);
  
  return expiryDate;
}

/**
 * Get retention start date based on date trigger setting
 * @param {Object} document - Document object (Invoice, CreditNote, or Statement)
 * @param {string} dateTrigger - 'upload_date' or 'invoice_date'
 * @returns {Date|null} - Start date for retention countdown, or null if date cannot be determined
 */
function getRetentionStartDate(document, dateTrigger) {
  if (!document) {
    return null;
  }
  
  if (dateTrigger === 'invoice_date') {
    // Use invoice/tax point date
    // For Invoice/CreditNote: use issueDate
    // For Statement: use periodEnd (end of statement period)
    if (document.issueDate) {
      return new Date(document.issueDate);
    } else if (document.periodEnd) {
      return new Date(document.periodEnd);
    }
    // Fallback to createdAt if invoice date not available
    return document.createdAt ? new Date(document.createdAt) : new Date();
  } else {
    // upload_date: Use when document status became 'ready' or createdAt
    // If documentStatus is 'ready' and createdAt exists, use createdAt
    // Otherwise, use current date as fallback
    if (document.createdAt) {
      return new Date(document.createdAt);
    }
    return new Date();
  }
}

/**
 * Check if document should be deleted based on retention settings
 * @param {Object} document - Document object with retentionExpiryDate
 * @param {Object} settings - Settings object with documentRetentionPeriod
 * @returns {boolean} - True if document should be deleted
 */
function shouldDeleteDocument(document, settings) {
  // If retention is disabled, don't delete
  if (!settings.documentRetentionPeriod) {
    return false;
  }
  
  // If document already deleted, don't delete again
  if (document.retentionDeletedAt || document.deletedAt) {
    return false;
  }
  
  // If no expiry date set, don't delete
  if (!document.retentionExpiryDate) {
    return false;
  }
  
  // Check if expiry date has passed
  const expiryDate = new Date(document.retentionExpiryDate);
  const now = new Date();
  
  return expiryDate <= now;
}

/**
 * Calculate and set retention dates for a document
 * @param {Object} document - Document object (Invoice, CreditNote, or Statement)
 * @param {Object} settings - Settings object with retention configuration
 * @returns {Object} - Object with retentionStartDate and retentionExpiryDate
 */
function calculateDocumentRetentionDates(document, settings) {
  const retentionPeriod = settings.documentRetentionPeriod;
  const dateTrigger = settings.documentRetentionDateTrigger || 'upload_date';
  
  // If retention is disabled, return null dates
  if (!retentionPeriod) {
    return {
      retentionStartDate: null,
      retentionExpiryDate: null
    };
  }
  
  // Get start date based on trigger
  const startDate = getRetentionStartDate(document, dateTrigger);
  
  // Calculate expiry date
  const expiryDate = calculateRetentionExpiryDate(retentionPeriod, startDate);
  
  return {
    retentionStartDate: startDate,
    retentionExpiryDate: expiryDate
  };
}

module.exports = {
  calculateRetentionExpiryDate,
  getRetentionStartDate,
  shouldDeleteDocument,
  calculateDocumentRetentionDates
};

