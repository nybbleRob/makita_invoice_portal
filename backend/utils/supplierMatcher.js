/**
 * Supplier Matching Utility
 * Matches suppliers from parsed document data using code (primary) and name (fallback with fuzzy matching)
 */

const stringSimilarity = require('string-similarity');
const { Supplier } = require('../models');
const { Op } = require('sequelize');

/**
 * Match supplier by code (exact match, case-insensitive)
 * @param {string} code - The supplier code to search for
 * @returns {Promise<Object|null>} Supplier if found, null otherwise
 */
async function matchSupplierByCode(code) {
  if (!code || typeof code !== 'string' || code.trim() === '') {
    return null;
  }
  
  const normalizedCode = code.trim();
  
  try {
    // Try exact match first (case-insensitive)
    const supplier = await Supplier.findOne({
      where: {
        code: {
          [Op.iLike]: normalizedCode
        },
        isActive: true,
        deletedAt: null
      }
    });
    
    if (supplier) {
      console.log(`✓ Matched supplier by code: "${normalizedCode}" -> ${supplier.name} (ID: ${supplier.id})`);
      return supplier;
    }
    
    // Try with trimmed/normalized variations
    const suppliers = await Supplier.findAll({
      where: {
        isActive: true,
        deletedAt: null
      },
      attributes: ['id', 'name', 'code']
    });
    
    for (const s of suppliers) {
      if (s.code && s.code.trim().toLowerCase() === normalizedCode.toLowerCase()) {
        console.log(`✓ Matched supplier by normalized code: "${normalizedCode}" -> ${s.name} (ID: ${s.id})`);
        return s;
      }
    }
    
    console.log(`✗ No supplier found with code: "${normalizedCode}"`);
    return null;
  } catch (error) {
    console.error(`Error matching supplier by code: ${error.message}`);
    return null;
  }
}

/**
 * Match supplier by name using fuzzy matching
 * @param {string} name - The supplier name to search for
 * @param {number} threshold - Similarity threshold (0-1), default 0.7 (70% match)
 * @returns {Promise<Object|null>} Best matching supplier if above threshold, null otherwise
 */
async function matchSupplierByName(name, threshold = 0.7) {
  if (!name || typeof name !== 'string' || name.trim() === '') {
    return null;
  }
  
  const normalizedName = name.trim().toLowerCase();
  
  try {
    // Get all active suppliers
    const suppliers = await Supplier.findAll({
      where: {
        isActive: true,
        deletedAt: null
      },
      attributes: ['id', 'name', 'code']
    });
    
    if (suppliers.length === 0) {
      console.log('✗ No active suppliers in database to match against');
      return null;
    }
    
    // Build array of supplier names for comparison
    const supplierNames = suppliers.map(s => s.name.toLowerCase());
    
    // Find best match using string similarity
    const matches = stringSimilarity.findBestMatch(normalizedName, supplierNames);
    const bestMatch = matches.bestMatch;
    
    console.log(`🔍 Fuzzy matching "${name}" - Best match: "${bestMatch.target}" (${(bestMatch.rating * 100).toFixed(1)}% similarity)`);
    
    if (bestMatch.rating >= threshold) {
      // Find the supplier that corresponds to the best match
      const matchedSupplier = suppliers.find(s => s.name.toLowerCase() === bestMatch.target);
      
      if (matchedSupplier) {
        console.log(`✓ Matched supplier by name (fuzzy): "${name}" -> ${matchedSupplier.name} (ID: ${matchedSupplier.id}, ${(bestMatch.rating * 100).toFixed(1)}% match)`);
        return matchedSupplier;
      }
    }
    
    console.log(`✗ No supplier found matching name: "${name}" (best match was ${(bestMatch.rating * 100).toFixed(1)}%, threshold is ${threshold * 100}%)`);
    return null;
  } catch (error) {
    console.error(`Error matching supplier by name: ${error.message}`);
    return null;
  }
}

/**
 * Find supplier from parsed document data
 * Uses supplier code as primary identifier, falls back to supplier name with fuzzy matching
 * @param {Object} parsedData - Parsed document data containing extracted fields
 * @param {number} nameMatchThreshold - Similarity threshold for name matching (default 0.7)
 * @returns {Promise<Object>} Result object with supplier and match details
 */
async function findSupplierFromParsedData(parsedData, nameMatchThreshold = 0.7) {
  const result = {
    supplier: null,
    matchMethod: null,
    extractedCode: null,
    extractedName: null,
    error: null
  };
  
  if (!parsedData || typeof parsedData !== 'object') {
    result.error = 'No parsed data provided';
    return result;
  }
  
  // Try to extract supplier code from parsed data
  // Check various field names that might contain the code
  const codeFields = [
    'supplierCode', 'supplier_code', 'suppliercode',
    'accountNumber', 'account_number', 'account_no',
    'customerNumber', 'customer_number', 'customer_no',
    'ourRef', 'our_ref', 'ourReference', 'our_reference',
    'yourRef', 'your_ref', 'yourReference', 'your_reference'
  ];
  
  let extractedCode = null;
  for (const field of codeFields) {
    if (parsedData[field] && parsedData[field].toString().trim()) {
      extractedCode = parsedData[field].toString().trim();
      console.log(`📋 Found supplier code in field "${field}": ${extractedCode}`);
      break;
    }
  }
  result.extractedCode = extractedCode;
  
  // Try to match by code first (primary identifier)
  if (extractedCode) {
    const supplierByCode = await matchSupplierByCode(extractedCode);
    if (supplierByCode) {
      result.supplier = supplierByCode;
      result.matchMethod = 'code';
      return result;
    }
  }
  
  // Fallback: Try to extract and match by supplier name
  const nameFields = [
    'supplierName', 'supplier_name', 'suppliername',
    'companyName', 'company_name', 'company',
    'vendorName', 'vendor_name', 'vendor',
    'fromName', 'from_name', 'from'
  ];
  
  let extractedName = null;
  for (const field of nameFields) {
    if (parsedData[field] && parsedData[field].toString().trim()) {
      extractedName = parsedData[field].toString().trim();
      console.log(`📋 Found supplier name in field "${field}": ${extractedName}`);
      break;
    }
  }
  result.extractedName = extractedName;
  
  // Try to match by name (fallback with fuzzy matching)
  if (extractedName) {
    const supplierByName = await matchSupplierByName(extractedName, nameMatchThreshold);
    if (supplierByName) {
      result.supplier = supplierByName;
      result.matchMethod = 'name_fuzzy';
      return result;
    }
  }
  
  // No match found
  if (!extractedCode && !extractedName) {
    result.error = 'No supplier identifier (code or name) found in parsed document data';
  } else if (extractedCode && extractedName) {
    result.error = `No matching supplier found for code "${extractedCode}" or name "${extractedName}"`;
  } else if (extractedCode) {
    result.error = `No matching supplier found for code "${extractedCode}"`;
  } else {
    result.error = `No matching supplier found for name "${extractedName}"`;
  }
  
  return result;
}

module.exports = {
  matchSupplierByCode,
  matchSupplierByName,
  findSupplierFromParsedData
};
