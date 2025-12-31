/**
 * Helper functions for working with parsed data that uses template field names
 * with fieldLabels mapping to standard field names
 */

/**
 * Get a value from parsedData by standard field name
 * Looks up the template field name from fieldLabels and returns the value
 * @param {Object} parsedData - Parsed data object with template field names and fieldLabels
 * @param {string} standardFieldName - Standard field name (e.g., 'invoiceNumber', 'accountNumber')
 * @returns {*} The value from the template field, or undefined if not found
 */
function getParsedValue(parsedData, standardFieldName) {
  if (!parsedData || !parsedData.fieldLabels) {
    return undefined;
  }
  
  // First, try direct access (for backward compatibility)
  if (parsedData[standardFieldName] !== undefined) {
    return parsedData[standardFieldName];
  }
  
  // Look up template field name from fieldLabels
  for (const [templateFieldName, mappedStandardField] of Object.entries(parsedData.fieldLabels)) {
    if (mappedStandardField === standardFieldName) {
      return parsedData[templateFieldName];
    }
  }
  
  return undefined;
}

/**
 * Get all values from parsedData, returning an object with standard field names as keys
 * @param {Object} parsedData - Parsed data object with template field names and fieldLabels
 * @returns {Object} Object with standard field names as keys
 */
function getStandardFields(parsedData) {
  if (!parsedData || !parsedData.fieldLabels) {
    return {};
  }
  
  const standardFields = {};
  
  // Map template field names to standard field names
  for (const [templateFieldName, mappedStandardField] of Object.entries(parsedData.fieldLabels)) {
    if (mappedStandardField && parsedData[templateFieldName] !== undefined) {
      standardFields[mappedStandardField] = parsedData[templateFieldName];
    }
  }
  
  // Also include any direct standard field names (for backward compatibility)
  for (const key in parsedData) {
    if (key !== 'templateId' && key !== 'templateName' && key !== 'fieldLabels' && 
        !parsedData.fieldLabels[key]) {
      // This is likely a standard field name already
      standardFields[key] = parsedData[key];
    }
  }
  
  return standardFields;
}

module.exports = {
  getParsedValue,
  getStandardFields
};

