/**
 * Supplier Matcher Utility
 * Matches parsed document data to existing suppliers in the system.
 * Uses exact code matching (primary) and fuzzy name matching (fallback).
 */

const stringSimilarity = require('string-similarity');
const { Supplier } = require('../models');
const { Op } = require('sequelize');

/**
 * Find supplier by exact code match
 * @param {string} code - Supplier code to match
 * @returns {Promise<Object|null>} Supplier if found, null otherwise
 */
async function matchSupplierByCode(code) {
  if (!code || typeof code !== 'string') {
    return null;
  }
  
  const normalizedCode = code.trim().toUpperCase();
  if (!normalizedCode) {
    return null;
  }
  
  try {
    // Try exact match first (case-insensitive)
    const supplier = await Supplier.findOne({
      where: {
        code: { [Op.iLike]: normalizedCode },
        deletedAt: null,
        isActive: true
      }
    });
    
    return supplier;
  } catch (error) {
    console.error('Error matching supplier by code:', error);
    return null;
  }
}

/**
 * Find supplier by fuzzy name matching
 * @param {string} name - Supplier name to match
 * @param {number} threshold - Minimum similarity score (0-1), default 0.7
 * @returns {Promise<Object|null>} Best matching supplier if above threshold, null otherwise
 */
async function matchSupplierByName(name, threshold = 0.7) {
  if (!name || typeof name !== 'string') {
    return null;
  }
  
  const normalizedName = name.trim().toLowerCase();
  if (!normalizedName || normalizedName.length < 3) {
    return null;
  }
  
  try {
    // Get all active suppliers
    const suppliers = await Supplier.findAll({
      where: {
        deletedAt: null,
        isActive: true
      },
      attributes: ['id', 'name', 'code']
    });
    
    if (suppliers.length === 0) {
      return null;
    }
    
    // Build array of supplier names for comparison
    const supplierNames = suppliers.map(s => s.name.toLowerCase());
    
    // Find best match using string similarity
    const matches = stringSimilarity.findBestMatch(normalizedName, supplierNames);
    
    if (matches.bestMatch.rating >= threshold) {
      const bestMatchIndex = matches.bestMatchIndex;
      const matchedSupplier = suppliers[bestMatchIndex];
      
      console.log(`🔍 Fuzzy match found: "${name}" -> "${matchedSupplier.name}" (score: ${matches.bestMatch.rating.toFixed(3)})`);
      
      return matchedSupplier;
    }
    
    console.log(`🔍 No fuzzy match above threshold for: "${name}" (best score: ${matches.bestMatch.rating.toFixed(3)})`);
    return null;
  } catch (error) {
    console.error('Error matching supplier by name:', error);
    return null;
  }
}

/**
 * Find supplier from parsed document data
 * Tries code first (checking multiple possible field names), then falls back to name matching
 * @param {Object} parsedData - Parsed data from document
 * @param {number} nameMatchThreshold - Threshold for fuzzy name matching (default 0.7)
 * @returns {Promise<{supplier: Object|null, matchMethod: string|null, error: string|null}>}
 */
async function findSupplierFromParsedData(parsedData, nameMatchThreshold = 0.7) {
  // Check multiple possible field names for supplier code
  // accountNumber is the standard field that should match Supplier.code
  const supplierCode = parsedData.supplierCode || 
                       parsedData.accountNumber || 
                       parsedData.account_number ||
                       parsedData.accountNo ||
                       parsedData.account_no ||
                       parsedData.customerCode ||
                       parsedData.customer_code;
  
  // Check multiple possible field names for supplier name
  const supplierName = parsedData.supplierName || 
                       parsedData.supplier_name ||
                       parsedData.vendorName ||
                       parsedData.vendor_name ||
                       parsedData.companyName ||
                       parsedData.company_name;
  
  let supplier = null;
  let matchMethod = null;
  
  console.log(`🔍 Looking for supplier with code: "${supplierCode || 'N/A'}", name: "${supplierName || 'N/A'}"`);
  
  // Try exact code match first
  if (supplierCode) {
    supplier = await matchSupplierByCode(String(supplierCode));
    if (supplier) {
      matchMethod = 'code';
      console.log(`✅ Supplier matched by code: ${supplierCode} -> ${supplier.name} (ID: ${supplier.id})`);
      return { supplier, matchMethod, error: null };
    }
  }
  
  // Fall back to fuzzy name matching
  if (supplierName) {
    supplier = await matchSupplierByName(supplierName, nameMatchThreshold);
    if (supplier) {
      matchMethod = 'name_fuzzy';
      console.log(`✅ Supplier matched by name: ${supplierName} -> ${supplier.name} (ID: ${supplier.id})`);
      return { supplier, matchMethod, error: null };
    }
  }
  
  // No match found - provide helpful error message
  let error = 'Could not identify supplier from document';
  if (supplierCode) {
    error = `No supplier found with code "${supplierCode}". Please create a supplier with this code first.`;
  } else if (supplierName) {
    error = `No supplier found matching name "${supplierName}". Please create a supplier with this name first.`;
  } else {
    error = 'No account number or supplier name found in document. Please check the template configuration.';
  }
  
  console.log(`❌ ${error}`);
  return { supplier: null, matchMethod: null, error };
}

module.exports = {
  matchSupplierByCode,
  matchSupplierByName,
  findSupplierFromParsedData
};
