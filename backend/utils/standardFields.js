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
    templateTypes: ['invoice', 'credit_note'], // Statements use statementDate instead
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
    templateTypes: ['invoice'], // Statements no longer use invoiceNumber as a parsed field
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
    templateTypes: ['invoice', 'credit_note'], // Not used on statements
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
    templateTypes: ['invoice', 'credit_note'], // Statements use totalBalance instead
    aliases: ['total', 'amount', 'invoice_total', 'invoicetotal', 'total_amount', 'grand_total']
  },
  vatAmount: {
    standardName: 'vatAmount',
    displayName: 'VAT Amount',
    description: 'VAT/tax amount - typically on last page for multi-page documents',
    isCrucial: false,
    isMandatory: true,
    parsingOrder: 8, // Parse eighth - from last page if multi-page
    templateTypes: ['invoice', 'credit_note'], // Not used on statements
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
    templateTypes: ['invoice', 'credit_note'], // Not used on statements
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
    templateTypes: ['invoice', 'credit_note'], // Statements identify customer via accountNumber, not supplier
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
    templateTypes: ['invoice', 'credit_note'], // Not used on statements
    aliases: ['invoice_to', 'invoiceto', 'bill_to', 'billto']
  },
  deliveryAddress: {
    standardName: 'deliveryAddress',
    displayName: 'Delivery Address',
    description: 'Delivery address',
    isCrucial: false,
    isMandatory: false,
    parsingOrder: 12,
    templateTypes: ['invoice', 'credit_note'], // Not used on statements
    aliases: ['delivery_address', 'deliveryaddress', 'ship_to', 'shipto', 'shipping_address']
  },

  // STATEMENT-ONLY FIELDS - Customer statement aging buckets and totals
  // These fields ONLY appear on statement templates and never on invoice/credit_note templates.
  statementDate: {
    standardName: 'statementDate',
    displayName: 'Statement Date',
    description: 'Date the statement was issued (used as the period end / retention metric)',
    isCrucial: true,
    isMandatory: true,
    parsingOrder: 4, // Parsed early like invoiceDate (date validation)
    templateTypes: ['statement'],
    aliases: ['statement_date', 'statementdate', 'period_end', 'period_end_date']
  },
  totalBalance: {
    standardName: 'totalBalance',
    displayName: 'Total Balance',
    description: 'Total outstanding balance shown on the statement (closing balance)',
    isCrucial: false,
    isMandatory: true,
    parsingOrder: 7,
    templateTypes: ['statement'],
    // Aliases include printed-label variants seen on real statements; the resolver
    // normalizes whitespace and dash glyphs, so we don't have to enumerate every spelling.
    aliases: [
      'total_balance', 'totalbalance', 'closing_balance', 'balance_due', 'amount_owed', 'total_owed',
      'total balance', 'total balance gbp', 'total balance £', 'total outstanding', 'balance outstanding'
    ]
  },
  currentAmount: {
    standardName: 'currentAmount',
    displayName: 'Current Amount',
    description: 'Amount due in the current period (not yet overdue)',
    isCrucial: false,
    isMandatory: false,
    parsingOrder: 13,
    templateTypes: ['statement'],
    aliases: ['current_amount', 'currentamount', 'current', 'current_balance', 'not_due']
  },
  overdue1To30: {
    standardName: 'overdue1To30',
    displayName: 'Overdue 1-30',
    description: 'Amount overdue between 1 and 30 days',
    isCrucial: false,
    isMandatory: false,
    parsingOrder: 14,
    templateTypes: ['statement'],
    // Aliases use 1-3 underscore-separated parts so mapToStandardName can resolve them,
    // plus printed-label variants (the resolver tightens whitespace around dashes).
    aliases: [
      'overdue_1to30', 'overdue30', 'overdue_30',
      'overdue 1-30', '1-30 days', '1 to 30'
    ]
  },
  overdue31To60: {
    standardName: 'overdue31To60',
    displayName: 'Overdue 31-60',
    description: 'Amount overdue between 31 and 60 days',
    isCrucial: false,
    isMandatory: false,
    parsingOrder: 15,
    templateTypes: ['statement'],
    aliases: [
      'overdue_31to60', 'overdue60', 'overdue_60',
      'overdue 31-60', '31-60 days', '31 to 60'
    ]
  },
  overdue61To90: {
    standardName: 'overdue61To90',
    displayName: 'Overdue 61-90',
    description: 'Amount overdue between 61 and 90 days',
    isCrucial: false,
    isMandatory: false,
    parsingOrder: 16,
    templateTypes: ['statement'],
    aliases: [
      'overdue_61to90', 'overdue90', 'overdue_90',
      'overdue 61-90', '61-90 days', '61 to 90'
    ]
  },
  overdue91Plus: {
    standardName: 'overdue91Plus',
    displayName: 'Overdue 91+',
    description: 'Amount overdue 91 days or more',
    isCrucial: false,
    isMandatory: false,
    parsingOrder: 17,
    templateTypes: ['statement'],
    aliases: [
      'overdue_91plus', 'overdue91', 'overdue_91',
      'overdue 91+', 'overdue 91 plus', '91+ days', '91 plus days'
    ]
  }
};

/**
 * Normalize a field-name candidate for alias resolution.
 * Backwards-compatible with prior callers (still strips trailing .: and trims),
 * additionally:
 *   - lowercases
 *   - replaces NBSP-family Unicode spaces with normal spaces
 *   - unifies dash glyphs (hyphen, en-dash, em-dash, minus) to '-'
 *   - collapses runs of internal whitespace to a single space
 *   - removes whitespace around dashes so "31 - 60" and "31-60" are equal
 *
 * The output of this function is what alias arrays must match against; existing
 * snake_case lowercase aliases are unaffected by these rules.
 */
function normalizeFieldKey(fieldName) {
  if (!fieldName) return '';
  return String(fieldName)
    .replace(/[\u00A0\u2007\u202F]/g, ' ')        // NBSP-family -> space
    .replace(/[\u2010-\u2015\u2212]/g, '-')       // dash-family -> hyphen
    .toLowerCase()
    .replace(/[.:]+$/, '')                        // existing trailing-punct strip
    .trim()
    .replace(/\s+/g, ' ')                         // collapse internal whitespace
    .replace(/\s*-\s*/g, '-');                    // tighten around dashes
}

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
 * Get standard field by alias or name.
 *
 * @param {string} fieldName - the input field name (may be a printed label, alias, or standard name)
 * @param {object} [options]
 * @param {string|null} [options.templateType] - if provided, restrict resolution to fields whose
 *   `templateTypes` includes this value (or fields with no `templateTypes` restriction). Defaults
 *   to null which preserves prior global-lookup behaviour for existing callers.
 *   Pass 'statement' from the statement-summary scan so generic tokens like 'current' don't pollute
 *   invoice/credit-note resolution paths.
 */
function getStandardField(fieldName, { templateType = null } = {}) {
  if (!fieldName) return null;

  const normalized = normalizeFieldKey(fieldName);
  if (!normalized) return null;

  const inScope = (field) =>
    !templateType || !field.templateTypes || field.templateTypes.includes(templateType);

  // Direct match by standard name (lowercased)
  if (STANDARD_FIELDS[normalized] && inScope(STANDARD_FIELDS[normalized])) {
    return STANDARD_FIELDS[normalized];
  }

  // Match by alias - normalize each alias the same way so the comparison is symmetric
  for (const field of Object.values(STANDARD_FIELDS)) {
    if (!inScope(field)) continue;
    if (field.aliases.some(alias => normalizeFieldKey(alias) === normalized)) {
      return field;
    }
  }

  // Case-insensitive match against standardName itself
  for (const [standardName, field] of Object.entries(STANDARD_FIELDS)) {
    if (!inScope(field)) continue;
    if (standardName.toLowerCase() === normalized) {
      return field;
    }
  }

  return null;
}

/**
 * Map a field name to its standard name
 * Handles template-prefixed names (e.g., "makita_invoice_template_document_type" → "documentType")
 *
 * Accepts the same `{ templateType }` option as getStandardField; defaults to null for
 * backwards compatibility with existing callers.
 */
function mapToStandardName(fieldName, options = {}) {
  if (!fieldName) return null;

  // If already a standard field name (camelCase), return it
  if (STANDARD_FIELDS[fieldName]) {
    const field = STANDARD_FIELDS[fieldName];
    if (!options.templateType || !field.templateTypes || field.templateTypes.includes(options.templateType)) {
      return fieldName;
    }
  }

  const normalized = normalizeFieldKey(fieldName);

  // Check if it's already a standard name (case-insensitive, scoped)
  for (const [standardName, field] of Object.entries(STANDARD_FIELDS)) {
    if (options.templateType && field.templateTypes && !field.templateTypes.includes(options.templateType)) continue;
    if (standardName.toLowerCase() === normalized) {
      return standardName;
    }
  }

  // Extract base field name (remove template prefix if present)
  // Template format: {template_code}_{field_name} or just {field_name}
  // Use underscore-form for splitting (replace any spaces) since our aliases use both shapes.
  const underscoreNormalized = normalized.replace(/\s+/g, '_');
  const parts = underscoreNormalized.split('_');
  if (parts.length > 1) {
    // Try last 2-3 parts (e.g., "document_type", "invoice_number", "date_tax_point")
    for (let i = Math.min(3, parts.length); i >= 1; i--) {
      const candidate = parts.slice(-i).join('_');
      const field = getStandardField(candidate, options);
      if (field) {
        return field.standardName;
      }
    }
  }

  // Check aliases
  const field = getStandardField(normalized, options);
  return field ? field.standardName : null;
}

/**
 * Validate that crucial fields are present in parsed data
 */
function validateCrucialFields(parsedData, template = null) {
  const crucialFields = getCrucialFields();
  const missing = [];
  const errors = [];
  
  // Get template coordinates to check which fields are actually defined
  const templateCoordinates = template?.coordinates || {};
  
  // Build set of standard field names that are defined in template
  // This ensures we only validate fields that are actually in the template
  const templateFieldNames = new Set();
  for (const [fieldId, coords] of Object.entries(templateCoordinates)) {
    if (coords && (coords.normalized || coords.x !== undefined)) {
      const standardName = mapToStandardName(fieldId) || fieldId;
      if (standardName) {
        templateFieldNames.add(standardName);
      }
    }
  }
  
  // Only validate crucial fields that are actually defined in the template
  // This prevents requiring supplierName for regular (customer) templates
  for (const field of crucialFields) {
    // Skip validation if this field is not in the template coordinates
    if (!templateFieldNames.has(field.standardName)) {
      continue; // Field not in template, skip validation
    }
    
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
  normalizeFieldKey,
  getMandatoryFields,
  getCrucialFields,
  getRequiredFields,
  getOptionalFields,
  getStandardField,
  mapToStandardName,
  validateCrucialFields,
  getFieldDisplayName
};

