/**
 * Company Hierarchy Utilities
 * Handles recursive company hierarchy queries for document access control
 * 
 * IMPORTANT: Documents are assigned to companies using account number (referenceNo)
 * during import/parsing. The invoice.companyId links to the company.
 */

const { Company } = require('../models');
const { Op } = require('sequelize').Sequelize;

/**
 * Get all descendant company IDs for a given company (recursive)
 * Uses nested set indexes if available for efficiency, otherwise falls back to recursive query
 * 
 * @param {string} companyId - UUID of the company
 * @param {boolean} includeSelf - Whether to include the company itself in results
 * @returns {Promise<string[]>} Array of company IDs (descendants)
 */
async function getDescendantCompanyIds(companyId, includeSelf = false) {
  const company = await Company.findByPk(companyId, {
    attributes: ['id', 'left', 'right']
  });
  
  if (!company) {
    return [];
  }
  
  const descendantIds = [];
  
  // If company has nested set indexes, use them for efficient query
  if (company.left !== null && company.right !== null) {
    const whereCondition = {
      left: { [Op.gte]: company.left },
      right: { [Op.lte]: company.right }
    };
    
    if (!includeSelf) {
      whereCondition.id = { [Op.ne]: company.id };
    }
    
    const descendants = await Company.findAll({
      where: whereCondition,
      attributes: ['id']
    });
    
    return descendants.map(d => d.id);
  }
  
  // Fallback: recursive query if nested set not initialized
  const getChildrenRecursive = async (parentId) => {
    const children = await Company.findAll({
      where: { parentId },
      attributes: ['id']
    });
    
    for (const child of children) {
      if (!descendantIds.includes(child.id)) {
        descendantIds.push(child.id);
      }
      // Recursively get children of children
      const grandChildren = await getChildrenRecursive(child.id);
      grandChildren.forEach(gcId => {
        if (!descendantIds.includes(gcId)) {
          descendantIds.push(gcId);
        }
      });
    }
    
    return children.map(c => c.id);
  };
  
  await getChildrenRecursive(companyId);
  
  if (includeSelf) {
    if (!descendantIds.includes(companyId)) {
      descendantIds.push(companyId);
    }
  }
  
  return descendantIds;
}

/**
 * Check if a company has children (any descendants)
 * 
 * @param {string} companyId - UUID of the company
 * @returns {Promise<boolean>} True if company has children, false otherwise
 */
async function hasChildren(companyId) {
  const company = await Company.findByPk(companyId, {
    attributes: ['id', 'left', 'right']
  });
  
  if (!company) {
    return false;
  }
  
  // Use nested set if available
  if (company.left !== null && company.right !== null) {
    const count = await Company.count({
      where: {
        left: { [Op.gte]: company.left },
        right: { [Op.lte]: company.right },
        id: { [Op.ne]: company.id }
      }
    });
    return count > 0;
  }
  
  // Fallback: check for direct children
  const children = await Company.count({
    where: { parentId: companyId }
  });
  
  if (children > 0) {
    return true;
  }
  
  // Check recursively if any descendants exist
  const descendants = await getDescendantCompanyIds(companyId, false);
  return descendants.length > 0;
}

/**
 * Get accessible company IDs for a user based on their assigned companies
 * Rules:
 * - If company has children: user sees own company + all descendants
 * - If company has no children (branch): user sees only own company
 * 
 * @param {string[]} assignedCompanyIds - Array of company IDs the user is assigned to
 * @returns {Promise<string[]>} Array of all accessible company IDs
 */
async function getAccessibleCompanyIds(assignedCompanyIds) {
  if (!assignedCompanyIds || assignedCompanyIds.length === 0) {
    return [];
  }
  
  const accessibleIds = new Set();
  
  for (const companyId of assignedCompanyIds) {
    // Always include the assigned company itself
    accessibleIds.add(companyId);
    
    // Check if this company has children
    const hasDescendants = await hasChildren(companyId);
    
    if (hasDescendants) {
      // Company has children - get all descendants
      const descendants = await getDescendantCompanyIds(companyId, false);
      descendants.forEach(id => accessibleIds.add(id));
    }
    // If no children, it's a branch - only see own (already added above)
  }
  
  return Array.from(accessibleIds);
}

module.exports = {
  getDescendantCompanyIds,
  hasChildren,
  getAccessibleCompanyIds
};

