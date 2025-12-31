import api from '../services/api';

/**
 * Get all available fields for a page type
 * @param {string} pageType - 'invoices' or 'credit_notes'
 * @returns {Promise<Array>} Array of field metadata objects
 */
export async function getAvailableFields(pageType) {
  try {
    const response = await api.get(`/api/column-config/${pageType}/available-fields`);
    return response.data.fields || [];
  } catch (error) {
    console.error('Error fetching available fields:', error);
    return [];
  }
}

/**
 * Get column configuration for a page type
 * @param {string} pageType - 'invoices' or 'credit_notes'
 * @returns {Promise<Object>} Column configuration object
 */
export async function getColumnConfiguration(pageType) {
  try {
    const response = await api.get(`/api/column-config/${pageType}`);
    return response.data;
  } catch (error) {
    console.error('Error fetching column configuration:', error);
    return null;
  }
}

/**
 * Update column configuration for a page type
 * @param {string} pageType - 'invoices' or 'credit_notes'
 * @param {Object} config - Configuration object with visibleColumns, columnOrder, columnWidths
 * @returns {Promise<Object>} Updated configuration
 */
export async function updateColumnConfiguration(pageType, config) {
  try {
    const response = await api.put(`/api/column-config/${pageType}`, config);
    return response.data;
  } catch (error) {
    console.error('Error updating column configuration:', error);
    throw error;
  }
}

/**
 * Map field name to display name
 * @param {string} fieldName - Field name (e.g., 'invoiceNumber')
 * @param {Array} availableFields - Array of available field objects
 * @returns {string} Display name
 */
export function getFieldDisplayName(fieldName, availableFields = []) {
  const field = availableFields.find(f => f.fieldName === fieldName);
  return field?.displayName || fieldName;
}

/**
 * Filter fields by visibility option
 * @param {Array} fields - Array of field objects
 * @param {string} option - 'table' or 'filter'
 * @returns {Array} Filtered fields
 */
export function filterFieldsByVisibility(fields, option) {
  if (option === 'table') {
    return fields.filter(f => f.showInTable);
  } else if (option === 'filter') {
    return fields.filter(f => f.showInFilter);
  }
  return fields;
}

