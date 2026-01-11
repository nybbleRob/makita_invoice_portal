/**
 * Supplier Standard Field Definitions
 * Defines mandatory and optional fields for supplier document templates
 * Ensures consistent field naming across all supplier templates
 */

// Standard field names (camelCase for JavaScript)
const STANDARD_FIELDS = {
  // CRUCIAL FIELDS - Must parse correctly or document fails
  documentType: {
    standardName: 'documentType',
    displayName: 'Document Type',
    description: 'Type of document (Invoice, Credit Note, Statement)',
    isCrucial: true,
    isMandatory: true,
    parsingOrder: 2, // Parse second - needed to determine document type
    aliases: ['document_type', 'documenttype', 'doc_type', 'type']
  },
  documentDate: {
    standardName: 'documentDate',
    displayName: 'Document Date',
    description: 'Date of document or tax point date',
    isCrucial: true,
    isMandatory: true,
    parsingOrder: 3, // Parse third - date validation
    aliases: ['date', 'document_date', 'invoice_date', 'tax_point', 'taxpoint', 'date_tax_point', 'invoiceDate', 'taxPoint']
  },
  
  // IMPORTANT FIELDS - Should parse but can fail
  invoiceNumber: {
    standardName: 'invoiceNumber',
    displayName: 'Invoice Number',
    description: 'Invoice number or reference',
    isCrucial: false,
    isMandatory: true,
    parsingOrder: 4, // Parse fourth - document identifier
    templateTypes: ['invoice', 'statement'], // Only for invoices and statements
    aliases: ['invoice_number', 'invoice_no', 'invoicenumber', 'inv_no', 'invoice_ref']
  },
  creditNumber: {
    standardName: 'creditNumber',
    displayName: 'Credit Number',
    description: 'Credit note number or reference',
    isCrucial: false,
    isMandatory: true,
    parsingOrder: 4, // Same priority as invoiceNumber
    templateTypes: ['credit_note'], // Only for credit notes
    aliases: ['credit_number', 'credit_no', 'creditnumber', 'credit_note_number', 'credit_ref', 'creditNoteNumber']
  },
  poNumber: {
    standardName: 'poNumber',
    displayName: 'PO Number',
    description: 'Purchase Order Number (optional, configurable per template)',
    isCrucial: false,
    isMandatory: false, // Optional by default, but can be marked as mandatory per template
    parsingOrder: 5, // Parse fifth
    aliases: ['po_number', 'po_no', 'ponumber', 'purchase_order', 'purchase_order_number', 'po']
  },
  // Amount fields
  totalAmount: {
    standardName: 'totalAmount',
    displayName: 'Total Amount',
    description: 'Total document amount',
    isCrucial: false,
    isMandatory: true,
    parsingOrder: 6, // Parse sixth
    aliases: ['total', 'amount', 'invoice_total', 'invoicetotal', 'total_amount', 'grand_total']
  },
  taxAmount: {
    standardName: 'taxAmount',
    displayName: 'Tax Amount',
    description: 'Tax amount',
    isCrucial: false,
    isMandatory: false, // Optional
    parsingOrder: 7,
    aliases: ['tax_amount', 'tax_total', 'taxamount', 'tax']
  },
  vatAmount: {
    standardName: 'vatAmount',
    displayName: 'VAT Amount',
    description: 'VAT amount',
    isCrucial: false,
    isMandatory: false, // Optional
    parsingOrder: 8,
    aliases: ['vat_amount', 'vat_total', 'vatamount', 'vat']
  },
  goodsAmount: {
    standardName: 'goodsAmount',
    displayName: 'Goods Amount',
    description: 'Subtotal before VAT',
    isCrucial: false,
    isMandatory: false, // Optional
    parsingOrder: 9,
    aliases: ['goods_amount', 'goods', 'goodsamount', 'subtotal', 'net_amount']
  },
  dueDate: {
    standardName: 'dueDate',
    displayName: 'Due Date',
    description: 'Due date if applicable',
    isCrucial: false,
    isMandatory: false, // Optional
    parsingOrder: 10,
    aliases: ['due_date', 'duedate', 'payment_due_date']
  },
  
  // OPTIONAL FIELDS - Can be added but not required
  supplierName: {
    standardName: 'supplierName',
    displayName: 'Supplier Name',
    description: 'Supplier or company name',
    isCrucial: false,
    isMandatory: false,
    parsingOrder: 11,
    aliases: ['supplier_name', 'suppliername', 'company_name', 'company', 'vendor_name']
  },
  supplierAddress: {
    standardName: 'supplierAddress',
    displayName: 'Supplier Address',
    description: 'Supplier address',
    isCrucial: false,
    isMandatory: false,
    parsingOrder: 12,
    aliases: ['supplier_address', 'supplieraddress', 'address']
  }
};

/**
 * Get all mandatory fields for a specific template type
 * Note: Each supplier template can override which fields are mandatory
 * @param {string} templateType - 'invoice', 'credit_note', or 'statement'
 * @param {Array} templateMandatoryFields - Optional array of mandatory fields from template config
 */
function getMandatoryFields(templateType = 'invoice', templateMandatoryFields = null) {
  // If template specifies mandatory fields, use those
  if (templateMandatoryFields && Array.isArray(templateMandatoryFields) && templateMandatoryFields.length > 0) {
    return Object.values(STANDARD_FIELDS).filter(field => {
      // Check if field is in template's mandatory list (case-insensitive)
      return templateMandatoryFields.some(tf => {
        const tfLower = tf.toLowerCase();
        return field.standardName.toLowerCase() === tfLower ||
               field.aliases.some(alias => alias.toLowerCase() === tfLower) ||
               field.displayName.toLowerCase() === tfLower;
      });
    });
  }
  
  // Default mandatory fields if template doesn't specify
  return Object.values(STANDARD_FIELDS).filter(field => {
    // Check if field is mandatory by default
    if (field.isMandatory) {
      // If field has templateTypes restriction, check if it applies
      if (field.templateTypes && !field.templateTypes.includes(templateType)) {
        return false; // Field is not for this template type
      }
      return true; // Field is mandatory and applies to this template type
    }
    
    return false; // Field is not mandatory by default
  });
}

/**
 * Get default mandatory fields (before template override)
 * @param {string} templateType - 'invoice', 'credit_note', or 'statement'
 */
function getDefaultMandatoryFields(templateType = 'invoice') {
  return Object.values(STANDARD_FIELDS).filter(field => {
    if (field.isMandatory) {
      if (field.templateTypes && !field.templateTypes.includes(templateType)) {
        return false;
      }
      return true;
    }
    return false;
  });
}

/**
 * Get all crucial fields (must parse correctly)
 */
function getCrucialFields() {
  return Object.values(STANDARD_FIELDS).filter(field => field.isCrucial);
}

/**
 * Get standard field by alias or name
 */
function getStandardField(fieldName) {
  if (!fieldName) return null;
  
  const normalized = fieldName.toLowerCase().replace(/[.:]+$/, '').trim();
  
  // Check direct match first
  if (STANDARD_FIELDS[normalized]) {
    return STANDARD_FIELDS[normalized];
  }
  
  // Check aliases (case-insensitive)
  for (const [standardName, field] of Object.entries(STANDARD_FIELDS)) {
    if (field.aliases.some(alias => alias.toLowerCase() === normalized)) {
      return field;
    }
  }
  
  // Also check if normalized matches standardName (case-insensitive)
  for (const [standardName, field] of Object.entries(STANDARD_FIELDS)) {
    if (standardName.toLowerCase() === normalized) {
      return field;
    }
  }
  
  return null;
}

/**
 * Map a field name to its standard name
 */
function mapToStandardName(fieldName) {
  if (!fieldName) return null;
  
  // If already a standard field name (camelCase), return it
  if (STANDARD_FIELDS[fieldName]) {
    return fieldName;
  }
  
  // Normalize: remove trailing periods/colons and convert to lowercase
  const normalized = fieldName.replace(/[.:]+$/, '').toLowerCase().trim();
  
  // Check if it's already a standard name (case-insensitive)
  for (const [standardName] of Object.keys(STANDARD_FIELDS)) {
    if (standardName.toLowerCase() === normalized) {
      return standardName;
    }
  }
  
  // Extract base field name (remove template prefix if present)
  let baseFieldName = normalized;
  
  // Try to extract the field name after the last underscore (common pattern)
  const parts = normalized.split('_');
  if (parts.length > 1) {
    // Try last 2-3 parts
    for (let i = Math.min(3, parts.length); i >= 1; i--) {
      const candidate = parts.slice(-i).join('_');
      const field = getStandardField(candidate);
      if (field) {
        return field.standardName;
      }
    }
  }
  
  // Check aliases
  const field = getStandardField(normalized);
  return field ? field.standardName : null;
}

/**
 * Validate that crucial fields are present in parsed data
 */
function validateCrucialFields(parsedData) {
  const crucialFields = getCrucialFields();
  const missing = [];
  const errors = [];
  
  for (const field of crucialFields) {
    const value = parsedData[field.standardName];
    if (!value || (typeof value === 'string' && value.trim() === '')) {
      missing.push(field.displayName);
      errors.push({
        field: field.standardName,
        displayName: field.displayName,
        message: `Missing crucial field: ${field.displayName}`
      });
    }
  }
  
  return {
    isValid: missing.length === 0,
    missing,
    errors
  };
}

/**
 * Validate mandatory fields against parsed data
 * @param {Object} parsedData - Parsed field data
 * @param {Array} mandatoryFields - Array of mandatory field definitions or field names
 */
function validateMandatoryFields(parsedData, mandatoryFields) {
  if (!mandatoryFields || mandatoryFields.length === 0) {
    return { isValid: true, missing: [], errors: [] };
  }
  
  const missing = [];
  const errors = [];
  
  for (const field of mandatoryFields) {
    const fieldName = typeof field === 'string' ? field : field.standardName;
    const fieldDef = typeof field === 'string' ? getStandardField(field) : field;
    const displayName = fieldDef ? fieldDef.displayName : fieldName;
    
    const value = parsedData[fieldName] || parsedData[fieldName.toLowerCase()];
    if (!value || (typeof value === 'string' && value.trim() === '')) {
      missing.push(displayName);
      errors.push({
        field: fieldName,
        displayName,
        message: `Missing mandatory field: ${displayName}`
      });
    }
  }
  
  return {
    isValid: missing.length === 0,
    missing,
    errors
  });
}

/**
 * Get field display name
 */
function getFieldDisplayName(standardName) {
  const field = STANDARD_FIELDS[standardName];
  return field ? field.displayName : standardName;
}

module.exports = {
  STANDARD_FIELDS,
  getMandatoryFields,
  getDefaultMandatoryFields,
  getCrucialFields,
  getStandardField,
  mapToStandardName,
  validateCrucialFields,
  validateMandatoryFields,
  getFieldDisplayName
};
