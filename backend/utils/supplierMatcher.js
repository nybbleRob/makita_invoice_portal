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
 * Tries code first, then falls back to name matching
 * @param {Object} parsedData - Parsed data from document (should contain supplierCode and/or supplierName)
 * @param {number} nameMatchThreshold - Threshold for fuzzy name matching (default 0.7)
 * @returns {Promise<{supplier: Object|null, matchMethod: string|null}>}
 */
async function findSupplierFromParsedData(parsedData, nameMatchThreshold = 0.7) {
  const { supplierCode, supplierName } = parsedData;
  
  let supplier = null;
  let matchMethod = null;
  
  // Try exact code match first
  if (supplierCode) {
    supplier = await matchSupplierByCode(supplierCode);
    if (supplier) {
      matchMethod = 'code';
      console.log(`✅ Supplier matched by code: ${supplierCode} -> ${supplier.name} (ID: ${supplier.id})`);
      return { supplier, matchMethod };
    }
  }
  
  // Fall back to fuzzy name matching
  if (supplierName) {
    supplier = await matchSupplierByName(supplierName, nameMatchThreshold);
    if (supplier) {
      matchMethod = 'name_fuzzy';
      console.log(`✅ Supplier matched by name: ${supplierName} -> ${supplier.name} (ID: ${supplier.id})`);
      return { supplier, matchMethod };
    }
  }
  
  // No match found
  console.log(`❌ No supplier match found. Code: "${supplierCode || 'N/A'}", Name: "${supplierName || 'N/A'}"`);
  return { supplier: null, matchMethod: null };
}

module.exports = {
  matchSupplierByCode,
  matchSupplierByName,
  findSupplierFromParsedData
};
