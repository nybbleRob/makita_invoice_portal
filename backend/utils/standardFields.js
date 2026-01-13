/**
 * Standard Field Definitions
 * Defines mandatory and optional fields for invoice templates
 * Ensures consistent field naming across all templates
 */

// Standard field names (camelCase for JavaScript)
const STANDARD_FIELDS = {
  // CRUCIAL FIELDS - Must parse correctly or document fails
  // Note: pageNo was removed - multi-page detection is automatic via pdf.numPages
  documentType: {
    standardName: 'documentType',
    displayName: 'Document Type',
    description: 'Type of document (Invoice, Credit Note, Statement)',
    isCrucial: true,
    isMandatory: true,
    isRequired: true, // Required for supplier templates - detect document type
    parsingOrder: 2, // Parse second - needed to determine document type
    aliases: ['document_type', 'documenttype', 'doc_type', 'type']
  },
  accountNumber: {
    standardName: 'accountNumber',
    displayName: 'Account Number / Supplier Code',
    description: 'Supplier account/code for primary matching',
    isCrucial: true,
    isMandatory: true,
    isRequired: true, // Required for supplier templates - primary matching key
    parsingOrder: 3, // Parse third - needed for company matching
    aliases: ['account_number', 'account_no', 'accountno', 'customer_number', 'customer_no', 'account', 'supplier_code', 'vendor_code']
  },
  invoiceDate: {
    standardName: 'invoiceDate',
    displayName: 'Date / Tax Point',
    description: 'Date of document or tax point date - needed for retention',
    isCrucial: true,
    isMandatory: true,
    isRequired: true, // Required for supplier templates - retention metric
    parsingOrder: 4, // Parse fourth - date validation
    aliases: ['date', 'invoice_date', 'tax_point', 'taxpoint', 'date_tax_point', 'invoiceDate', 'taxPoint', 'invoice_date', 'tax_point_date']
  },
  
  // IMPORTANT FIELDS - Should parse but can fail
  invoiceNumber: {
    standardName: 'invoiceNumber',
    displayName: 'Invoice Number',
    description: 'Invoice number or reference',
    isCrucial: false,
    isMandatory: true,
    parsingOrder: 5, // Parse fifth - document identifier
    templateTypes: ['invoice', 'statement'], // Only for invoices and statements
    aliases: ['invoice_number', 'invoice_no', 'invoicenumber', 'inv_no', 'invoice_ref']
  },
  creditNumber: {
    standardName: 'creditNumber',
    displayName: 'Credit Number',
    description: 'Credit note number or reference',
    isCrucial: false,
    isMandatory: true,
    parsingOrder: 5, // Same priority as invoiceNumber
    templateTypes: ['credit_note'], // Only for credit notes
    aliases: ['credit_number', 'credit_no', 'creditnumber', 'credit_note_number', 'credit_ref', 'creditNoteNumber']
  },
  customerPO: {
    standardName: 'customerPO',
    displayName: 'PO Number',
    description: 'Customer purchase order number',
    isCrucial: false,
    isMandatory: true,
    parsingOrder: 6, // Parse sixth
    aliases: ['customer_po', 'customerpo', 'po_number', 'po_no', 'purchase_order', 'po']
  },
  // Amount fields - parse from last page if multi-page (order 7-9)
  totalAmount: {
    standardName: 'totalAmount',
    displayName: 'Total',
    description: 'Total invoice amount - typically on last page for multi-page documents',
    isCrucial: false,
    isMandatory: true,
    parsingOrder: 7, // Parse seventh - from last page if multi-page
    aliases: ['total', 'amount', 'invoice_total', 'invoicetotal', 'total_amount', 'grand_total']
  },
  vatAmount: {
    standardName: 'vatAmount',
    displayName: 'VAT Amount',
    description: 'VAT/tax amount - typically on last page for multi-page documents',
    isCrucial: false,
    isMandatory: true,
    parsingOrder: 8, // Parse eighth - from last page if multi-page
    aliases: ['vat_amount', 'vat_total', 'vatamount', 'tax_amount', 'tax']
  },
  goodsAmount: {
    standardName: 'goodsAmount',
    displayName: 'Goods Amount',
    description: 'Subtotal before VAT - typically on last page for multi-page documents',
    isCrucial: false,
    isMandatory: false, // Optional for invoices, but will be made mandatory for credit notes
    mandatoryForTypes: ['credit_note'], // Mandatory for credit notes
    parsingOrder: 9, // Parse ninth - from last page if multi-page
    aliases: ['goods_amount', 'goods', 'goodsamount', 'subtotal', 'net_amount']
  },
  
  // SUPPLIER MATCHING FIELD - Required for supplier document templates
  supplierName: {
    standardName: 'supplierName',
    displayName: 'Supplier Name',
    description: 'Supplier/vendor name - fallback for supplier matching if Account Number fails',
    isCrucial: true,
    isMandatory: true,
    isRequired: true, // Required for supplier templates - fallback matching
    parsingOrder: 1, // Parse first for supplier matching
    aliases: ['supplier_name', 'vendor_name', 'vendor', 'supplier']
  },
  
  // OPTIONAL FIELDS - Can be added but not required
  customerName: {
    standardName: 'customerName',
    displayName: 'Customer Name',
    description: 'Customer or company name',
    isCrucial: false,
    isMandatory: false,
    parsingOrder: 10, // Parse last
    aliases: ['customer_name', 'customername', 'company_name', 'company']
  },
  invoiceTo: {
    standardName: 'invoiceTo',
    displayName: 'Invoice To',
    description: 'Invoice to address or name',
    isCrucial: false,
    isMandatory: false,
    parsingOrder: 11,
    aliases: ['invoice_to', 'invoiceto', 'bill_to', 'billto']
  },
  deliveryAddress: {
    standardName: 'deliveryAddress',
    displayName: 'Delivery Address',
    description: 'Delivery address',
    isCrucial: false,
    isMandatory: false,
    parsingOrder: 12,
    aliases: ['delivery_address', 'deliveryaddress', 'ship_to', 'shipto', 'shipping_address']
  }
};

/**
 * Get all mandatory fields for a specific template type
 * @param {string} templateType - 'invoice', 'credit_note', or 'statement'
 */
function getMandatoryFields(templateType = 'invoice') {
  return Object.values(STANDARD_FIELDS).filter(field => {
    // Check if field is mandatory by default
    if (field.isMandatory) {
      // If field has templateTypes restriction, check if it applies
      if (field.templateTypes && !field.templateTypes.includes(templateType)) {
        return false; // Field is not for this template type
      }
      return true; // Field is mandatory and applies to this template type
    }
    
    // Check if field is mandatory for this specific template type
    if (field.mandatoryForTypes && field.mandatoryForTypes.includes(templateType)) {
      return true; // Field is mandatory for this template type
    }
    
    return false; // Field is not mandatory
  });
}

/**
 * Get all crucial fields (must parse correctly)
 */
function getCrucialFields() {
  return Object.values(STANDARD_FIELDS).filter(field => field.isCrucial);
}

/**
 * Get required fields for supplier templates
 * These must be mapped before saving a supplier template
 */
function getRequiredFields() {
  return Object.values(STANDARD_FIELDS).filter(field => field.isRequired);
}

/**
 * Get optional standard fields (pre-defined but not required)
 * Excludes required fields and customerName
 */
function getOptionalFields(templateType = 'invoice') {
  return Object.values(STANDARD_FIELDS).filter(field => {
    // Exclude required fields
    if (field.isRequired) return false;
    // Exclude customerName (not relevant for supplier documents)
    if (field.standardName === 'customerName') return false;
    // Exclude fields restricted to other template types
    if (field.templateTypes && !field.templateTypes.includes(templateType)) {
      return false;
    }
    return true;
  });
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
 * Handles template-prefixed names (e.g., "makita_invoice_template_document_type" → "documentType")
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
  // Template format: {template_code}_{field_name} or just {field_name}
  let baseFieldName = normalized;
  
  // Try to extract the field name after the last underscore (common pattern)
  const parts = normalized.split('_');
  if (parts.length > 1) {
    // Try last 2-3 parts (e.g., "document_type", "invoice_number", "date_tax_point")
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
 * Get field display name
 */
function getFieldDisplayName(standardName) {
  const field = STANDARD_FIELDS[standardName];
  return field ? field.displayName : standardName;
}

module.exports = {
  STANDARD_FIELDS,
  getMandatoryFields,
  getCrucialFields,
  getRequiredFields,
  getOptionalFields,
  getStandardField,
  mapToStandardName,
  validateCrucialFields,
  getFieldDisplayName
};

