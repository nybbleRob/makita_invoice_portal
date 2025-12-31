/**
 * Local PDF text extraction using pdf-parse
 * No cloud costs - extracts embedded text directly from PDFs
 */

const pdfParse = require('pdf-parse');
const fs = require('fs');

/**
 * Extract text from PDF file
 * @param {string} filePath - Path to PDF file
 * @returns {Promise<Object>} - Extracted text and metadata
 */
async function extractTextFromPDF(filePath) {
  try {
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdfParse(dataBuffer);
    
    return {
      text: data.text,
      numPages: data.numpages,
      info: data.info,
      metadata: data.metadata,
      version: data.version
    };
  } catch (error) {
    throw new Error(`Failed to extract text from PDF: ${error.message}`);
  }
}

/**
 * Extract text and basic invoice fields using simple patterns
 * @param {string} filePath - Path to PDF file
 * @returns {Promise<Object>} - Parsed invoice data
 */
async function extractInvoiceData(filePath) {
  const extracted = await extractTextFromPDF(filePath);
  const text = extracted.text;
  
  // Basic field extraction using common patterns
  // These will be replaced by supplier-specific templates
  const invoiceNumber = extractInvoiceNumber(text);
  const date = extractDate(text);
  const amount = extractAmount(text);
  const accountNumber = extractAccountNumber(text);
  const customerName = extractCustomerName(text);
  const customerPO = extractCustomerPO(text);
  const goodsAmount = extractGoodsAmount(text);
  const vatAmount = extractVatAmount(text);
  
  return {
    fullText: text,
    invoiceNumber,
    date,
    amount,
    accountNumber,
    customerName,
    customerPO,
    goodsAmount,
    vatAmount,
    numPages: extracted.numPages,
    metadata: extracted.metadata,
    rawText: text
  };
}

/**
 * Extract invoice number using common patterns
 * Improved patterns to handle various formats including "Invoice No.5942501" and "Invoice No. 5942480"
 */
function extractInvoiceNumber(text) {
  const patterns = [
    // "Invoice No. 5942480" or "Invoice No.5942501" or "Invoice No: 5942501" or "Invoice No 5942501"
    // This pattern specifically handles the space after "No." and captures the number
    /invoice\s+no\.?\s+:?\s*(\d{4,}[A-Z0-9\-_]*)/i,
    // "Invoice #5942501" or "Invoice #: 5942501"
    /invoice\s*#\s*:?\s*([A-Z0-9\-_]+)/i,
    // "Invoice Number: 5942501" or "Invoice Number 5942501"
    /invoice\s+number\s*:?\s*([A-Z0-9\-_]+)/i,
    // "INV-5942501" or "INV 5942501"
    /(?:^|\s)(INV[-\s]?[A-Z0-9\-_]+)/i,
    // "OC1_INV_05942483" format
    /(?:^|\s)([A-Z]{2,}[-\s_]?INV[-\s_]?\d+[A-Z0-9\-_]*)/i,
    // Generic: "Invoice 5942501"
    /invoice\s+([A-Z0-9\-_]+)/i,
    // Fallback: long numeric sequences that might be invoice numbers (7+ digits)
    /(?:^|\s)(\d{7,}[A-Z0-9\-_]*)/i
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const invoiceNum = match[1].trim();
      // Validate it looks like an invoice number
      // Must be at least 4 characters (to avoid matching "No" or short numbers)
      if (invoiceNum.length >= 4 && invoiceNum.length <= 50) {
        // Don't match if it's just "No" or common words
        if (!/^(no|yes|na|n\/a)$/i.test(invoiceNum)) {
          return invoiceNum;
        }
      }
    }
  }
  
  return null;
}

/**
 * Extract date using common patterns
 */
function extractDate(text) {
  // Common date patterns
  const patterns = [
    /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/, // DD/MM/YYYY or DD-MM-YYYY
    /(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})/, // YYYY/MM/DD or YYYY-MM-DD
    /(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{2,4})/i, // DD MMM YYYY
    /((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{2,4})/i // MMM DD, YYYY
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  
  return null;
}

/**
 * Extract amount/total using common patterns
 * Handles formats like "Invoice Total£0.00" or "Total: £0.00"
 */
function extractAmount(text) {
  // Look for currency symbols and amounts
  const patterns = [
    // "Invoice Total£0.00" or "Invoice Total: £0.00" - most specific
    /invoice\s+total\s*:?\s*[£$€]?\s*([\d,]+\.?\d{2})/i,
    // "Total: £0.00" or "Total £0.00"
    /(?:^|\s)total\s*:?\s*[£$€]?\s*([\d,]+\.?\d{2})/i,
    // "Amount Due: £0.00"
    /(?:amount\s+due|balance\s+due|grand\s+total)\s*:?\s*[£$€]?\s*([\d,]+\.?\d{2})/i,
    // Currency symbol followed by amount (get the last one, usually the total)
    /[£$€]\s*([\d,]+\.?\d{2})/g
  ];
  
  // Try specific patterns first
  for (let i = 0; i < patterns.length - 1; i++) {
    const pattern = patterns[i];
    const match = text.match(pattern);
    if (match && match[1]) {
      const amountStr = match[1].trim().replace(/,/g, '');
      const amount = parseFloat(amountStr);
      if (!isNaN(amount)) {
        return amount;
      }
    }
  }
  
  // For currency pattern, get all matches and return the last one (usually the total)
  const currencyPattern = patterns[patterns.length - 1];
  const matches = [...text.matchAll(currencyPattern)];
  if (matches && matches.length > 0) {
    // Return the last match (usually the total/invoice total)
    const lastMatch = matches[matches.length - 1];
    if (lastMatch && lastMatch[1]) {
      const amountStr = lastMatch[1].trim().replace(/,/g, '');
      const amount = parseFloat(amountStr);
      if (!isNaN(amount)) {
        return amount;
      }
    }
  }
  
  return null;
}

/**
 * Extract account number from text
 * Looks for common patterns like "Account Number:", "Account:", "Acc No:", etc.
 * IMPORTANT: Excludes bank account numbers (usually longer, near "Bank Details")
 */
function extractAccountNumber(text) {
  // First, try to find customer account number (usually shorter, near top)
  // Exclude bank account numbers which are usually longer and near "Bank Details"
  const bankAccountSection = text.toLowerCase().indexOf('bank details');
  const textBeforeBank = bankAccountSection > 0 ? text.substring(0, bankAccountSection) : text;
  
  const patterns = [
    // "Account No.: 999999" or "Account No.999401" or "Account No: 999401" or "Account No 999401"
    // This pattern handles the colon after "No." and captures the number
    /account\s+no\.?\s*:?\s*(\d{4,}[A-Z0-9\-]*)/i,
    // "Account #999401" or "Account #: 999401"
    /account\s*#\s*:?\s*([A-Z0-9\-]+)/i,
    // "Account Number: 999401" or "Account Number 999401"
    /account\s+number\s*:?\s*([A-Z0-9\-]+)/i,
    // "Acc No.999401" or "Acc No: 999401"
    /acc\s+no\.?\s*:?\s*(\d{4,}[A-Z0-9\-]*)/i,
    // "Account Code: 999401"
    /account\s+code\s*:?\s*([A-Z0-9\-]+)/i,
    // "Customer Account: 999401"
    /customer\s+account\s*:?\s*([A-Z0-9\-]+)/i,
    // "Account ID: 999401"
    /account\s+id\s*:?\s*([A-Z0-9\-]+)/i
  ];
  
  // Search in text before bank details section first (customer account is usually at top)
  for (const pattern of patterns) {
    const match = textBeforeBank.match(pattern);
    if (match && match[1]) {
      const accountNumber = match[1].trim();
      // Validate it looks like an account number
      // Must be at least 4 characters (to avoid matching "No")
      // Usually customer accounts are shorter than bank accounts
      if (accountNumber.length >= 4 && accountNumber.length <= 20) {
        // Don't match if it's just "No" or common words
        if (!/^(no|yes|na|n\/a)$/i.test(accountNumber)) {
          return accountNumber;
        }
      }
    }
  }
  
  // Try to find account number in common positions (near top of document, before bank details)
  const lines = textBeforeBank.split('\n').slice(0, 20); // Check first 20 lines
  for (const line of lines) {
    // Look for lines that might contain account numbers
    // Pattern: alphanumeric, usually starts with letters then numbers
    const accountMatch = line.match(/\b([A-Z0-9]{4,20})\b/);
    if (accountMatch && accountMatch[1]) {
      const potentialAccount = accountMatch[1];
      // Check if line contains account-related keywords
      if ((line.toLowerCase().includes('account') || line.toLowerCase().includes('acc')) &&
          !line.toLowerCase().includes('bank')) {
        // Validate it looks like an account number (not just numbers, reasonable length)
        if (potentialAccount.length >= 4 && potentialAccount.length <= 20) {
          return potentialAccount;
        }
      }
    }
  }
  
  return null;
}

/**
 * Extract customer name using common patterns
 */
function extractCustomerName(text) {
  // Look for "Bill To", "Customer", "Client" labels
  const patterns = [
    /(?:bill\s*to|customer|client)[\s:]*\n?([A-Z][A-Za-z\s&,\.\-']+)/i,
    /(?:sold\s*to)[\s:]*\n?([A-Z][A-Za-z\s&,\.\-']+)/i
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const name = match[1].trim();
      // Take first line only (usually the company name)
      return name.split('\n')[0].trim();
    }
  }
  
  return null;
}

/**
 * Extract Customer PO (Purchase Order) number
 * Handles both numeric POs and text-based POs like "DROP OFF"
 * Also handles cases where PO value is on a different line
 */
function extractCustomerPO(text) {
  // First, try patterns that match on the same line
  const sameLinePatterns = [
    // "Customer PO: DROP OFF" or "Customer PO: ABC123" - handles multi-word POs
    /customer\s+po\s*:?\s*([A-Z0-9\s\-_]{2,50})/i,
    // "PO Number: ABC123" or "PO: DROP OFF"
    /po\s+(?:number\s*)?:?\s*([A-Z0-9\s\-_]{2,50})/i,
    // "Purchase Order: ABC123"
    /purchase\s+order\s*:?\s*([A-Z0-9\s\-_]{2,50})/i,
    // "PO #: ABC123"
    /po\s*#?\s*:?\s*([A-Z0-9\s\-_]{2,50})/i
  ];
  
  for (const pattern of sameLinePatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const po = match[1].trim();
      // Validate it looks like a PO (at least 2 chars, max 50)
      // Can contain spaces for multi-word POs like "DROP OFF"
      if (po.length >= 2 && po.length <= 50 && !/^(no|yes|na|n\/a)$/i.test(po)) {
        return po;
      }
    }
  }
  
  // If no match on same line, try to find "Customer PO:" and then look for value on next line(s)
  const poLabelMatch = text.match(/customer\s+po\s*:?\s*/i);
  if (poLabelMatch) {
    const afterLabel = text.substring(poLabelMatch.index + poLabelMatch[0].length);
    // Look for PO value in the next 200 characters (could be on next line)
    const nextSection = afterLabel.substring(0, 200);
    // Try to find a valid PO value (alphanumeric, possibly with spaces/hyphens)
    const poValueMatch = nextSection.match(/\b([A-Z0-9\s\-_]{2,50})\b/);
    if (poValueMatch && poValueMatch[1]) {
      const po = poValueMatch[1].trim();
      // Validate it's not just whitespace or common words
      if (po.length >= 2 && po.length <= 50 && 
          !/^(no|yes|na|n\/a|order|date|packing|list|number)$/i.test(po) &&
          !po.match(/^\d{1,2}[\/\-]\d{1,2}/)) { // Not a date
        return po;
      }
    }
  }
  
  // Standalone "PO ABC123" or "PO-ABC123" or "DROP OFF" near "Customer PO"
  const standaloneMatch = text.match(/(?:^|\s)(?:PO[-\s]+|)([A-Z][A-Z0-9\s\-_]{1,49})/);
  if (standaloneMatch && standaloneMatch[1]) {
    const po = standaloneMatch[1].trim();
    // Check if it's near "Customer PO" in the text
    const poIndex = text.toLowerCase().indexOf('customer po');
    const matchIndex = standaloneMatch.index;
    if (poIndex >= 0 && Math.abs(matchIndex - poIndex) < 500) {
      if (po.length >= 2 && po.length <= 50 && 
          !/^(no|yes|na|n\/a|order|date|packing|list|number|invoice|account)$/i.test(po)) {
        return po;
      }
    }
  }
  
  return null;
}

/**
 * Extract Goods/Net Amount (subtotal before VAT)
 * Handles formats like "Goods£0.00" or "Goods: £0.00"
 */
function extractGoodsAmount(text) {
  const patterns = [
    // "Goods£0.00" or "Goods: £0.00" or "Goods £0.00"
    /goods\s*:?\s*[£$€]?\s*([\d,]+\.?\d{2})/i,
    // "Net Amount: £0.00"
    /net\s+amount\s*:?\s*[£$€]?\s*([\d,]+\.?\d{2})/i,
    // "Subtotal: £0.00"
    /subtotal\s*:?\s*[£$€]?\s*([\d,]+\.?\d{2})/i,
    // "Goods Value: £0.00"
    /goods\s+value\s*:?\s*[£$€]?\s*([\d,]+\.?\d{2})/i,
    // Look for "Goods" followed by currency amount on same or next line
    /goods\s*:?\s*[£$€]?\s*([\d,]+\.?\d*)/i
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const amountStr = match[1].trim().replace(/,/g, '');
      const amount = parseFloat(amountStr);
      if (!isNaN(amount)) {
        return amount;
      }
    }
  }
  
  return null;
}

/**
 * Extract VAT Amount
 * Handles formats like "VAT£0.00" or "VAT: £0.00" or "VAT £0.00"
 */
function extractVatAmount(text) {
  const patterns = [
    // "VAT£0.00" or "VAT: £0.00" or "VAT £0.00"
    /vat\s*:?\s*[£$€]?\s*([\d,]+\.?\d{2})/i,
    // "VAT Amount: £0.00"
    /vat\s+amount\s*:?\s*[£$€]?\s*([\d,]+\.?\d{2})/i,
    // "Tax Amount: £0.00"
    /tax\s+amount\s*:?\s*[£$€]?\s*([\d,]+\.?\d{2})/i,
    // "Tax: £0.00"
    /tax\s*:?\s*[£$€]?\s*([\d,]+\.?\d{2})/i
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const amountStr = match[1].trim().replace(/,/g, '');
      const amount = parseFloat(amountStr);
      if (!isNaN(amount)) {
        return amount;
      }
    }
  }
  
  return null;
}

module.exports = {
  extractTextFromPDF,
  extractInvoiceData,
  extractInvoiceNumber,
  extractDate,
  extractAmount,
  extractAccountNumber,
  extractCustomerName,
  extractCustomerPO,
  extractGoodsAmount,
  extractVatAmount
};

