const { Template } = require('../models');
const { STANDARD_FIELDS } = require('./standardFields');

/**
 * Get all available fields across all templates
 * Merges standard fields with custom fields from all active templates
 * @param {string} templateType - 'invoice', 'credit_note', or 'statement'
 * @returns {Promise<Object>} Object mapping field names to field metadata
 */
async function getAllAvailableFields(templateType = 'invoice') {
  const availableFields = {};

  // Add all standard fields
  Object.values(STANDARD_FIELDS).forEach(field => {
    // Check if field applies to this template type
    if (field.templateTypes && !field.templateTypes.includes(templateType)) {
      return; // Skip fields not for this template type
    }

    availableFields[field.standardName] = {
      fieldName: field.standardName,
      displayName: field.displayName,
      dataType: inferDataType(field.standardName),
      isStandard: true,
      isCustom: false,
      showInTable: true, // Standard fields default to visible
      showInFilter: true, // Standard fields default to filterable
      description: field.description
    };
  });

  // Get all active templates for this type
  const templates = await Template.findAll({
    where: {
      templateType: templateType,
      enabled: true
    }
  });

  // Merge custom fields from all templates
  templates.forEach(template => {
    if (template.customFields && typeof template.customFields === 'object') {
      Object.entries(template.customFields).forEach(([fieldName, fieldConfig]) => {
        // Skip if already exists (standard field takes precedence)
        if (availableFields[fieldName]) {
          return;
        }

        // Validate field config
        if (!fieldConfig || typeof fieldConfig !== 'object') {
          return;
        }

        availableFields[fieldName] = {
          fieldName: fieldName,
          displayName: fieldConfig.displayName || fieldName,
          dataType: fieldConfig.dataType || 'text',
          isStandard: false,
          isCustom: true,
          showInTable: fieldConfig.showInTable || false,
          showInFilter: fieldConfig.showInFilter || false,
          description: fieldConfig.description || '',
          templateId: template.id,
          templateName: template.name
        };
      });
    }
  });

  return availableFields;
}

/**
 * Get fields that should be shown in table columns
 * @param {string} templateType - 'invoice', 'credit_note', or 'statement'
 * @returns {Promise<Array>} Array of field metadata objects
 */
async function getTableFields(templateType = 'invoice') {
  const allFields = await getAllAvailableFields(templateType);
  return Object.values(allFields).filter(field => field.showInTable);
}

/**
 * Get fields that should be available for filtering
 * @param {string} templateType - 'invoice', 'credit_note', or 'statement'
 * @returns {Promise<Array>} Array of field metadata objects
 */
async function getFilterFields(templateType = 'invoice') {
  const allFields = await getAllAvailableFields(templateType);
  return Object.values(allFields).filter(field => field.showInFilter);
}

/**
 * Infer data type from field name
 * @param {string} fieldName - Field name in camelCase
 * @returns {string} Data type: 'text', 'number', 'date', 'currency'
 */
function inferDataType(fieldName) {
  const lowerName = fieldName.toLowerCase();
  
  if (lowerName.includes('date') || lowerName.includes('date')) {
    return 'date';
  }
  if (lowerName.includes('amount') || lowerName.includes('total') || lowerName.includes('price') || lowerName.includes('cost')) {
    return 'currency';
  }
  if (lowerName.includes('number') || lowerName.includes('count') || lowerName.includes('quantity')) {
    return 'number';
  }
  
  return 'text';
}

/**
 * Validate custom field name
 * @param {string} fieldName - Field name to validate
 * @returns {Object} { valid: boolean, error?: string }
 */
function validateCustomFieldName(fieldName) {
  if (!fieldName || typeof fieldName !== 'string') {
    return { valid: false, error: 'Field name is required' };
  }

  // Must be camelCase
  if (!/^[a-z][a-zA-Z0-9]*$/.test(fieldName)) {
    return { valid: false, error: 'Field name must be camelCase (start with lowercase letter, no spaces or special characters)' };
  }

  // Check if conflicts with standard field
  if (STANDARD_FIELDS[fieldName]) {
    return { valid: false, error: `Field name "${fieldName}" conflicts with a standard field` };
  }

  // Check reserved names
  const reservedNames = ['id', 'metadata', 'createdAt', 'updatedAt', 'company', 'companyId'];
  if (reservedNames.includes(fieldName)) {
    return { valid: false, error: `Field name "${fieldName}" is reserved` };
  }

  return { valid: true };
}

module.exports = {
  getAllAvailableFields,
  getTableFields,
  getFilterFields,
  inferDataType,
  validateCustomFieldName
};

