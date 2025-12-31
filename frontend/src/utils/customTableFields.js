/**
 * Utility to get custom fields that should be displayed in tables
 * Fetches all active templates and extracts custom fields with showInTable: true
 */

import api from '../services/api';

/**
 * Get all custom fields that should be shown in the table for a given template type
 * @param {string} templateType - 'invoice' or 'credit_note'
 * @returns {Promise<Array>} Array of custom field configs with fieldName and displayName
 */
export async function getTableCustomFields(templateType = 'invoice') {
  try {
    // Use the public endpoint that returns only custom fields for table display
    const response = await api.get(`/api/templates/table-fields?type=${templateType}`);
    return response.data || [];
  } catch (error) {
    console.error('Error fetching table custom fields:', error);
    return [];
  }
}

/**
 * Get custom field value from invoice/creditNote metadata
 * @param {Object} document - Invoice or CreditNote object
 * @param {string} fieldName - Custom field name
 * @returns {string} Field value or '-'
 */
export function getCustomFieldValue(document, fieldName) {
  if (!document || !document.metadata || !document.metadata.parsedData) {
    return '-';
  }
  
  const value = document.metadata.parsedData[fieldName];
  if (value === undefined || value === null || value === '') {
    return '-';
  }
  
  // Format based on data type if needed
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  
  return String(value);
}

