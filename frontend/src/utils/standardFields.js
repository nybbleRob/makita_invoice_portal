/**
 * Standard Field Definitions (Frontend)
 * Matches backend/utils/standardFields.js
 */

export const STANDARD_FIELDS = {
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
    displayName: 'Account Number',
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
  customerAddress: {
    standardName: 'customerAddress',
    displayName: 'Customer Address',
    description: 'Customer / account billing address printed on the statement header',
    isCrucial: false,
    isMandatory: false,
    parsingOrder: 11,
    templateTypes: ['statement'],
    aliases: ['customer_address', 'customeraddress', 'account_address', 'billing_address', 'address']
  },
  totalBalance: {
    standardName: 'totalBalance',
    displayName: 'Total Balance',
    description: 'Total outstanding balance shown on the statement (closing balance)',
    isCrucial: false,
    isMandatory: true,
    parsingOrder: 7,
    templateTypes: ['statement'],
    aliases: ['total_balance', 'totalbalance', 'closing_balance', 'balance_due', 'amount_owed', 'total_owed']
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
    // Aliases use 1-3 underscore-separated parts so mapToStandardName can resolve them.
    aliases: ['overdue_1to30', 'overdue30', 'overdue_30']
  },
  overdue31To60: {
    standardName: 'overdue31To60',
    displayName: 'Overdue 31-60',
    description: 'Amount overdue between 31 and 60 days',
    isCrucial: false,
    isMandatory: false,
    parsingOrder: 15,
    templateTypes: ['statement'],
    aliases: ['overdue_31to60', 'overdue60', 'overdue_60']
  },
  overdue61To90: {
    standardName: 'overdue61To90',
    displayName: 'Overdue 61-90',
    description: 'Amount overdue between 61 and 90 days',
    isCrucial: false,
    isMandatory: false,
    parsingOrder: 16,
    templateTypes: ['statement'],
    aliases: ['overdue_61to90', 'overdue90', 'overdue_90']
  },
  overdue91Plus: {
    standardName: 'overdue91Plus',
    displayName: 'Overdue 91+',
    description: 'Amount overdue 91 days or more',
    isCrucial: false,
    isMandatory: false,
    parsingOrder: 17,
    templateTypes: ['statement'],
    aliases: ['overdue_91plus', 'overdue91', 'overdue_91']
  }
};

/**
 * Get all mandatory fields for a specific template type
 * @param {string} templateType - 'invoice', 'credit_note', or 'statement'
 */
export function getMandatoryFields(templateType = 'invoice') {
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
export function getCrucialFields() {
  return Object.values(STANDARD_FIELDS).filter(field => field.isCrucial);
}

/**
 * Get all available fields for a specific template type (mandatory + optional)
 * @param {string} templateType - 'invoice', 'credit_note', or 'statement'
 */
export function getAvailableFields(templateType = 'invoice') {
  return Object.values(STANDARD_FIELDS).filter(field => {
    // Exclude fields that are restricted to other template types
    if (field.templateTypes && !field.templateTypes.includes(templateType)) {
      return false; // Field is only for other template types
    }
    
    // Exclude customerName - not needed for template creation
    if (field.standardName === 'customerName') {
      return false;
    }
    
    // Exclude supplierName - only needed for supplier templates, not regular templates
    if (field.standardName === 'supplierName') {
      return false;
    }
    
    // Include all fields that are available for this template type
    // (both mandatory and optional)
    return true;
  });
}

/**
 * Get field by standard name
 */
export function getStandardField(standardName) {
  return STANDARD_FIELDS[standardName] || null;
}

/**
 * Get required fields for supplier templates
 * These must be mapped before saving a supplier template
 */
export function getRequiredFields() {
  return Object.values(STANDARD_FIELDS).filter(field => field.isRequired);
}

/**
 * Get optional standard fields (pre-defined but not required)
 * Excludes required fields and customerName
 * @param {string} templateType - 'invoice', 'credit_note', or 'statement'
 */
export function getOptionalFields(templateType = 'invoice') {
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
 * Generate a custom field definition
 * @param {string} displayName - User-provided display name
 * @returns {object} Field definition with generated standardName
 */
export function createCustomField(displayName) {
  // Generate standardName from display name: "Order Reference" -> "custom_order_reference"
  const slug = displayName
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '_');
  
  return {
    standardName: `custom_${slug}`,
    displayName: displayName.trim(),
    description: `Custom field: ${displayName.trim()}`,
    isCrucial: false,
    isMandatory: false,
    isRequired: false,
    isCustom: true,
    parsingOrder: 100, // Custom fields parse last
    aliases: []
  };
}
