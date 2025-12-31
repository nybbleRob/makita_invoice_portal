/**
 * Excel Parser Utility
 * Extracts invoice data from Excel files using template cell mappings
 */

const XLSX = require('xlsx');
const XLSX_CALC = require('xlsx-calc');

/**
 * Convert column letter to number (A=1, B=2, ..., Z=26, AA=27, etc.)
 */
function columnToNumber(column) {
  let result = 0;
  for (let i = 0; i < column.length; i++) {
    result = result * 26 + (column.charCodeAt(i) - 'A'.charCodeAt(0) + 1);
  }
  return result;
}

/**
 * Convert column number to letter (1=A, 2=B, ..., 26=Z, 27=AA, etc.)
 */
function numberToColumn(num) {
  let result = '';
  while (num > 0) {
    num--;
    result = String.fromCharCode(65 + (num % 26)) + result;
    num = Math.floor(num / 26);
  }
  return result;
}

/**
 * Extract fields from Excel file using template cell mappings
 * @param {Buffer|string} excelFile - Excel file buffer or file path
 * @param {Object} template - Template with excelCells mappings
 * @returns {Promise<Object>} - Extracted fields
 */
async function extractFieldsFromExcel(excelFile, template) {
  if (!template.excelCells || Object.keys(template.excelCells).length === 0) {
    throw new Error('Template has no Excel cell mappings defined');
  }

  let workbook;
  
  // Load workbook from buffer or file path
  if (Buffer.isBuffer(excelFile)) {
    workbook = XLSX.read(excelFile, { type: 'buffer' });
  } else if (typeof excelFile === 'string') {
    workbook = XLSX.readFile(excelFile);
  } else {
    throw new Error('Invalid Excel file format. Expected Buffer or file path.');
  }
  
  // Recalculate all formulas in the workbook using xlsx-calc
  // This populates cell.v with calculated values even if the file wasn't saved with them
  try {
    XLSX_CALC(workbook);
    console.log('✅ Formulas recalculated using xlsx-calc');
  } catch (calcError) {
    console.warn('⚠️  Error recalculating formulas with xlsx-calc:', calcError.message);
    // Continue anyway - some formulas might still work
  }

  // Start with empty object - only add fields that are actually mapped in the template
  const extracted = {
    fullText: ''
  };

  // Get sheet names
  const sheetNames = workbook.SheetNames;
  if (sheetNames.length === 0) {
    throw new Error('Excel file has no sheets');
  }
  
  // For multi-page files, always use the last sheet for parsing
  // This ensures we parse the most recent page when files have multiple pages
  const lastSheetIndex = sheetNames.length - 1;
  console.log(`📄 File has ${sheetNames.length} sheet(s). Using last sheet: "${sheetNames[lastSheetIndex]}"`);

  // Extract all text for fullText
  let allText = [];
  sheetNames.forEach(sheetName => {
    const worksheet = workbook.Sheets[sheetName];
    const sheetData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
    sheetData.forEach(row => {
      allText.push(row.join(' '));
    });
  });
  extracted.fullText = allText.join('\n');

  // Extract fields using cell mappings
  for (const [fieldName, cellMapping] of Object.entries(template.excelCells)) {
    if (!cellMapping || !cellMapping.column || !cellMapping.row) {
      console.warn(`⚠️  Skipping ${fieldName}: missing column or row`);
      continue;
    }

    // Always use the last sheet for parsing (for multi-page files)
    // The sheet index in the mapping is stored but we override to use last sheet
    const sheetIndex = lastSheetIndex;
    const sheetName = sheetNames[sheetIndex];
    const worksheet = workbook.Sheets[sheetName];
    
    console.log(`   Using sheet: "${sheetName}" (index ${sheetIndex}) for field ${fieldName}`);

    // Convert column letter to number (1-based)
    const colNum = columnToNumber(cellMapping.column.toUpperCase());
    const rowNum = parseInt(cellMapping.row);

    // Check if it's a range (has endColumn and endRow)
    const isRange = cellMapping.endColumn && cellMapping.endRow;
    let value = '';

    if (isRange) {
      // Extract range of cells
      const endColNum = columnToNumber(cellMapping.endColumn.toUpperCase());
      const endRowNum = parseInt(cellMapping.endRow);
      
      const values = [];
      for (let R = rowNum - 1; R < endRowNum; R++) {
        const rowValues = [];
        for (let C = colNum - 1; C < endColNum; C++) {
          const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
          const cell = worksheet[cellAddress];
          if (cell) {
            rowValues.push(cell.w || cell.v || '');
          }
        }
        if (rowValues.length > 0) {
          values.push(rowValues.join('\t')); // Tab-separated for rows
        }
      }
      value = values.join('\n'); // Newline-separated for multiple rows
      console.log(`   Extracted ${fieldName} from range ${cellMapping.column}${cellMapping.row}:${cellMapping.endColumn}${cellMapping.endRow}`);
    } else {
      // Single cell
      const cellAddress = XLSX.utils.encode_cell({ r: rowNum - 1, c: colNum - 1 });
      const cell = worksheet[cellAddress];

      if (!cell) {
        console.warn(`⚠️  Cell ${cellMapping.column}${cellMapping.row} not found in sheet "${sheetName}"`);
        continue;
      }

      // Get cell value - handle formulas and different cell types
      // For formulas: cell.f contains the formula, cell.v contains the calculated value
      // If cell.v is undefined, the formula result wasn't calculated (file might need recalculation)
      
      // Handle formulas - xlsx-calc should have already recalculated them
      // After xlsx-calc, cell.v should contain the calculated value
      if (cell.f) {
        console.log(`   📐 Cell ${cellMapping.column}${cellMapping.row} contains formula: ${cell.f}`);
        console.log(`   📐 Cell type: ${cell.t}, cell.v: ${JSON.stringify(cell.v)}, cell.w: ${JSON.stringify(cell.w)}`);
        
        // After xlsx-calc, cell.v should have the calculated value
        // Check if cell.v has a meaningful value (not undefined, null, or empty string)
        if (cell.v !== undefined && cell.v !== null && cell.v !== '') {
          // Has calculated value from xlsx-calc - use it
          value = cell.v.toString();
          console.log(`   ✅ Using calculated value from xlsx-calc: "${value}"`);
        } else if (cell.w && cell.w.trim() !== '') {
          // Fallback to formatted display if calculated value is missing
          console.log(`   📐 No calculated value, trying cell.w (formatted): "${cell.w}"`);
          
          // Try to extract numeric value from formatted string (e.g., "£0.00", "0.00", "£1,234.56")
          const cleaned = cell.w.replace(/[£$€,\s]/g, '');
          const numMatch = cleaned.match(/[\d.]+/);
          
          if (numMatch && !isNaN(parseFloat(numMatch[0]))) {
            value = parseFloat(numMatch[0]).toString();
            console.log(`   ✅ Extracted numeric value from formatted string "${cell.w}": "${value}"`);
          } else {
            value = cell.w;
            console.log(`   ⚠️  Could not extract number from "${cell.w}", using as-is`);
          }
        } else {
          // Formula couldn't be calculated - try to extract from fullText as last resort
          // This is useful when formulas use unsupported functions like INDIRECT
          console.warn(`   ⚠️  Formula in ${cellMapping.column}${cellMapping.row} could not be calculated. Formula: ${cell.f}`);
          console.log(`   🔍 Attempting to extract value from fullText as fallback...`);
          
          // The pattern in the text is: "VAT % Goods VAT Invoice Total" followed by VAT% (e.g., "20"),
          // then registration numbers, then three numbers (can be integers or decimals): "27.6 5.52 33.12" or "0 0 0"
          // Where: Goods=first number, VAT=second number, Invoice Total=third number
          const fieldNameLower = fieldName.toLowerCase();
          
          // Look for the sequence of three numbers after "Invoice Total" and registration numbers
          // Pattern: After "Invoice Total" comes VAT%, then registration info, then three numbers (integers or decimals)
          // More specifically: look for three consecutive numbers near the end before "Note"
          // Pattern: ([\d,]+(?:\.\d+)?) matches integers like "0" or decimals like "27.6"
          const threeNumbersMatch = extracted.fullText.match(/(?:Invoice\s+Total|NPWD\d+)\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)(?:\s+Note|\s*$)/i);
          
          if (threeNumbersMatch) {
            const goodsValue = threeNumbersMatch[1].replace(/,/g, '');
            const vatValue = threeNumbersMatch[2].replace(/,/g, '');
            const totalValue = threeNumbersMatch[3].replace(/,/g, '');
            
            console.log(`   📊 Found three values in sequence: Goods=${goodsValue}, VAT=${vatValue}, Total=${totalValue}`);
            
            if (fieldNameLower.includes('invoice_total') || fieldNameLower.includes('total')) {
              value = totalValue;
              console.log(`   ✅ Extracted Invoice Total from fullText: "${value}"`);
            } else if (fieldNameLower.includes('vat_amount') || (fieldNameLower.includes('vat') && !fieldNameLower.includes('rate'))) {
              value = vatValue;
              console.log(`   ✅ Extracted VAT Amount from fullText: "${value}"`);
            } else if (fieldNameLower.includes('goods') || fieldNameLower.includes('net')) {
              value = goodsValue;
              console.log(`   ✅ Extracted Goods Amount from fullText: "${value}"`);
            }
            } else {
              // Fallback: try to find individual patterns, but be more careful to avoid false matches
              // Updated to handle integers (like "0") as well as decimals
              if (fieldNameLower.includes('invoice_total') || fieldNameLower.includes('total')) {
                // Look for "Invoice Total" followed by a number, but avoid matching VAT%
                // The actual total should be after registration numbers
                const totalMatch = extracted.fullText.match(/Invoice\s+Total[\s\w\/]+\s+[\d]+\s+[\w\/\s]+\s+[\d,]+(?:\.\d+)?\s+[\d,]+(?:\.\d+)?\s+([\d,]+(?:\.\d+)?)/i);
                if (totalMatch && totalMatch[1]) {
                  value = totalMatch[1].replace(/,/g, '');
                  console.log(`   ✅ Extracted Invoice Total from fullText (fallback): "${value}"`);
                }
              } else if (fieldNameLower.includes('vat_amount') || (fieldNameLower.includes('vat') && !fieldNameLower.includes('rate'))) {
                // Look for VAT amount - should be the middle of three numbers after registration
                const vatMatch = extracted.fullText.match(/Invoice\s+Total[\s\w\/]+\s+[\d]+\s+[\w\/\s]+\s+[\d,]+(?:\.\d+)?\s+([\d,]+(?:\.\d+)?)\s+[\d,]+(?:\.\d+)?/i);
                if (vatMatch && vatMatch[1]) {
                  value = vatMatch[1].replace(/,/g, '');
                  console.log(`   ✅ Extracted VAT Amount from fullText (fallback): "${value}"`);
                }
              } else if (fieldNameLower.includes('goods') || fieldNameLower.includes('net')) {
                // Look for Goods - should be the first of three numbers after registration
                const goodsMatch = extracted.fullText.match(/Invoice\s+Total[\s\w\/]+\s+[\d]+\s+[\w\/\s]+\s+([\d,]+(?:\.\d+)?)\s+[\d,]+(?:\.\d+)?\s+[\d,]+(?:\.\d+)?/i);
                if (goodsMatch && goodsMatch[1]) {
                  value = goodsMatch[1].replace(/,/g, '');
                  console.log(`   ✅ Extracted Goods Amount from fullText (fallback): "${value}"`);
                }
              }
            }
          
          if (!value || value === '') {
            value = '';
            console.warn(`   ⚠️  Could not extract value for ${fieldName} from formula or fullText`);
          }
        }
      } else if (cell.t === 'n') {
        // Regular number (not a formula)
        value = cell.v !== undefined && cell.v !== null ? cell.v.toString() : '';
      } else if (cell.t === 'd') {
        // Date
        const dateValue = XLSX.SSF.parse_date_code(cell.v);
        if (dateValue) {
          // Format as YYYY-MM-DD
          value = `${dateValue.y}-${String(dateValue.m).padStart(2, '0')}-${String(dateValue.d).padStart(2, '0')}`;
        } else {
          value = cell.v !== undefined && cell.v !== null ? cell.v.toString() : '';
        }
      } else if (cell.t === 'b') {
        // Boolean
        value = cell.v ? 'true' : 'false';
      } else if (cell.t === 'e') {
        // Error
        value = cell.w || cell.v || '';
        console.warn(`   ⚠️  Cell ${cellMapping.column}${cellMapping.row} contains an error: ${value}`);
      } else {
        // String or other (not a formula, not a number, not a date, not boolean, not error)
        // Regular string cell
        value = cell.w || (cell.v !== undefined && cell.v !== null ? cell.v.toString() : '');
      }

      console.log(`   Extracted ${fieldName} from ${cellMapping.column}${cellMapping.row}: "${value}"`);
    }

    // Apply transformations if defined
    if (template.transformations && template.transformations[fieldName]) {
      const originalValue = value;
      value = applyTransformations(value, template.transformations[fieldName]);
      console.log(`   After transformations: "${value}" (from "${originalValue}")`);
    }

    // Store with the original prefixed field name for consistency
    // All fields (default and custom) use their template-prefixed names
    extracted[fieldName] = value;
    console.log(`   ✅ Stored as ${fieldName}: "${value}"`);
  }

  // Extract custom fields if template has customFields defined
  if (template.customFields && typeof template.customFields === 'object' && Object.keys(template.customFields).length > 0) {
    console.log(`📋 Extracting ${Object.keys(template.customFields).length} custom field(s) from Excel...`);
    
    const templateCode = template.code || '';
    
    for (const [customFieldName, customFieldConfig] of Object.entries(template.customFields)) {
      // Check if this custom field has excelCells mapping
      const prefixedFieldName = templateCode ? `${templateCode}_${customFieldName}` : customFieldName;
      const cellMapping = template.excelCells?.[prefixedFieldName] || template.excelCells?.[customFieldName];
      
      if (cellMapping && cellMapping.column && cellMapping.row) {
        const sheetIndex = sheetNames.length - 1; // Use last sheet
        const sheetName = sheetNames[sheetIndex];
        const worksheet = workbook.Sheets[sheetName];
        
        const colNum = columnToNumber(cellMapping.column.toUpperCase());
        const rowNum = parseInt(cellMapping.row);
        
        const isRange = cellMapping.endColumn && cellMapping.endRow;
        let value = '';
        
        if (isRange) {
          const endColNum = columnToNumber(cellMapping.endColumn.toUpperCase());
          const endRowNum = parseInt(cellMapping.endRow);
          
          const values = [];
          for (let R = rowNum - 1; R < endRowNum; R++) {
            const rowValues = [];
            for (let C = colNum - 1; C < endColNum; C++) {
              const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
              const cell = worksheet[cellAddress];
              if (cell) {
                rowValues.push(cell.w || cell.v || '');
              }
            }
            if (rowValues.length > 0) {
              values.push(rowValues.join('\t'));
            }
          }
          value = values.join('\n');
        } else {
          const cellAddress = XLSX.utils.encode_cell({ r: rowNum - 1, c: colNum - 1 });
          const cell = worksheet[cellAddress];
          
          if (cell) {
            if (cell.f) {
              // Formula - use calculated value
              value = cell.v !== undefined && cell.v !== null ? cell.v.toString() : (cell.w || '');
            } else if (cell.t === 'n') {
              value = cell.v !== undefined && cell.v !== null ? cell.v.toString() : '';
            } else if (cell.t === 'd') {
              const dateValue = XLSX.SSF.parse_date_code(cell.v);
              if (dateValue) {
                value = `${dateValue.y}-${String(dateValue.m).padStart(2, '0')}-${String(dateValue.d).padStart(2, '0')}`;
              } else {
                value = cell.v !== undefined && cell.v !== null ? cell.v.toString() : '';
              }
            } else {
              value = cell.w || (cell.v !== undefined && cell.v !== null ? cell.v.toString() : '');
            }
          }
        }
        
        // Format value based on dataType
        if (customFieldConfig.dataType === 'currency' || customFieldConfig.dataType === 'number') {
          // Clean amount value (remove currency symbols, commas, etc.)
          value = value.replace(/[£$€¥₹,\s]/g, '').replace(/[^\d.-]/g, '');
        }
        
        // Store custom field with its name (not prefixed)
        extracted[customFieldName] = value;
        console.log(`   ✅ Stored custom field "${customFieldName}" = "${value}"`);
      }
    }
  }

  // Don't add documentType if we already have a prefixed version
  // Only determine document type if not explicitly set via template mapping
  const hasDocumentTypeField = Object.keys(extracted).some(key => 
    key.includes('document_type') || key.includes('documentType')
  );
  
  if (!hasDocumentTypeField) {
    // Only set documentType if no template field mapped it
    const docTypeUpper = extracted.fullText.toUpperCase();
    if (docTypeUpper.includes('CREDIT') || docTypeUpper.includes('CN')) {
      extracted.documentType = 'credit_note';
    } else if (docTypeUpper.includes('STATEMENT')) {
      extracted.documentType = 'statement';
    } else {
      extracted.documentType = 'invoice';
    }
  }

  return extracted;
}

/**
 * Map field name from template to extracted object
 * Handles both prefixed (templateCode_fieldName) and unprefixed field names
 */
function mapFieldName(fieldName) {
  // Known field names that might be prefixed with template code
  // Order matters: longer/more specific names first
  const knownFields = [
    'invoice_total',
    'invoice_number',
    'account_number',
    'account_no',
    'document_type',
    'vat_amount',
    'customer_name',
    'customer_po',
    'goods_amount',
    'date',
    'amount',
    'total',
    'customerPO',
    'goodsAmount',
    'vatAmount'
  ];
  
  // Extract actual field name by removing template code prefix
  // Format: {templateCode}_{fieldName} or just {fieldName}
  let actualFieldName = fieldName;
  
  // First, try to extract the base field name by removing any template code prefix
  // Template code prefix pattern: {templateCode}_{fieldName}
  // We'll look for known fields after the last underscore
  const lastUnderscoreIndex = fieldName.lastIndexOf('_');
  if (lastUnderscoreIndex > 0) {
    const possibleBaseName = fieldName.substring(lastUnderscoreIndex + 1);
    // Check if this matches a known field
    if (knownFields.includes(possibleBaseName)) {
      actualFieldName = possibleBaseName;
    } else {
      // Try matching the full suffix after first underscore (for multi-part field names)
      // e.g., "rtewast_invoice_total" -> "invoice_total"
      for (const knownField of knownFields) {
        if (fieldName.endsWith('_' + knownField)) {
          actualFieldName = knownField;
          break;
        }
      }
    }
  }
  
  // If no prefix found, check if it's already a known field
  if (actualFieldName === fieldName && !knownFields.includes(fieldName)) {
    // Field doesn't match known patterns - might be a custom field
    // Return as-is (will keep the prefix if present)
    return fieldName;
  }
  
  const mapping = {
    'document_type': 'documentType',
    'invoice_number': 'invoiceNumber',
    'account_number': 'accountNumber',
    'account_no': 'accountNumber', // Also handle account_no
    'customer_name': 'customerName',
    'date': 'date',
    'amount': 'amount',
    'total': 'amount',
    'invoice_total': 'amount', // Map invoice_total to amount
    'customer_po': 'customerPO',
    'customerPO': 'customerPO',
    'goods_amount': 'goodsAmount',
    'goodsAmount': 'goodsAmount',
    'vat_amount': 'vatAmount',
    'vatAmount': 'vatAmount'
  };
  
  return mapping[actualFieldName] || actualFieldName;
}

/**
 * Apply transformations to extracted value
 */
function applyTransformations(value, transformations) {
  let result = value;

  if (transformations.remove) {
    for (const char of transformations.remove) {
      result = result.replace(new RegExp(char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '');
    }
  }

  if (transformations.trim) {
    result = result.trim();
  }

  if (transformations.uppercase) {
    result = result.toUpperCase();
  }

  if (transformations.lowercase) {
    result = result.toLowerCase();
  }

  if (transformations.parseFloat) {
    result = parseFloat(result.replace(/[^\d.-]/g, ''));
  }

  if (transformations.parseInt) {
    result = parseInt(result.replace(/[^\d-]/g, ''), 10);
  }

  return result;
}

/**
 * Get Excel file preview data (for template builder)
 * @param {Buffer|string} excelFile - Excel file buffer or file path
 * @returns {Promise<Object>} - Sheet data and metadata
 */
async function getExcelPreview(excelFile) {
  let workbook;
  
  if (Buffer.isBuffer(excelFile)) {
    workbook = XLSX.read(excelFile, { type: 'buffer' });
  } else if (typeof excelFile === 'string') {
    workbook = XLSX.readFile(excelFile);
  } else {
    throw new Error('Invalid Excel file format. Expected Buffer or file path.');
  }

  const sheets = {};
  workbook.SheetNames.forEach(sheetName => {
    const worksheet = workbook.Sheets[sheetName];
    // Get raw data with cell addresses
    const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
    const sheetData = [];
    
    for (let R = range.s.r; R <= range.e.r; R++) {
      const row = [];
      for (let C = range.s.c; C <= range.e.c; C++) {
        const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
        const cell = worksheet[cellAddress];
        row.push(cell ? (cell.w || cell.v) : '');
      }
      sheetData.push(row);
    }
    
    sheets[sheetName] = sheetData;
  });

  return {
    sheets,
    sheetNames: workbook.SheetNames
  };
}

module.exports = {
  extractFieldsFromExcel,
  getExcelPreview,
  columnToNumber,
  numberToColumn
};

