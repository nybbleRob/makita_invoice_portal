/**
 * Nested Set Model utility for managing hierarchical data
 * Based on the nested set model pattern for efficient tree queries
 */

/**
 * Updates nested set indexes (left/right) for a hierarchical model
 * @param {Model} Model - Sequelize model class
 * @returns {Promise<void>}
 */
async function updateNestedSetIndexes(Model) {
  const { Op } = require('sequelize');
  
  // Get all records ordered by id
  const records = await Model.findAll({
    attributes: ['id', 'parentId', 'left', 'right'],
    order: [['id', 'ASC']],
    raw: true
  });

  if (records.length === 0) {
    return;
  }

  // Build children cache
  const childrenCache = {};
  records.forEach(record => {
    childrenCache[record.id] = [];
  });
  
  records.forEach(record => {
    if (record.parentId) {
      if (childrenCache[record.parentId]) {
        childrenCache[record.parentId].push(record);
      }
    }
  });

  // Compute nested set indexes
  let index = 1;
  
  function compute(node) {
    node.left = index++;
    
    // Process children
    const children = childrenCache[node.id] || [];
    children.forEach(child => {
      compute(child);
    });
    
    node.right = index++;
  }

  // Process root nodes (those without parentId)
  const rootNodes = records.filter(r => !r.parentId);
  rootNodes.forEach(root => {
    compute(root);
  });

  // Update all records with new left/right values
  for (const record of records) {
    await Model.update(
      { left: record.left, right: record.right },
      { where: { id: record.id } }
    );
  }
}

module.exports = {
  updateNestedSetIndexes
};

