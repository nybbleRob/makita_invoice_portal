/**
 * Nested Set Model utility for managing hierarchical data
 * Based on the nested set model pattern for efficient tree queries
 */

const { sequelize } = require('../models');

/**
 * Updates nested set indexes (left/right) for a hierarchical model
 * Uses bulk SQL update for performance (single query instead of N queries)
 * @param {Model} Model - Sequelize model class
 * @returns {Promise<void>}
 */
async function updateNestedSetIndexes(Model) {
  const startTime = Date.now();
  
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

  // Bulk update using PostgreSQL VALUES clause
  // This is MUCH faster than individual updates (1 query instead of N)
  if (records.length > 0) {
    // Build values list for bulk update
    const values = records
      .filter(r => r.left !== undefined && r.right !== undefined)
      .map(r => `('${r.id}'::uuid, ${r.left}, ${r.right})`)
      .join(',\n');
    
    if (values) {
      const tableName = Model.getTableName();
      const query = `
        UPDATE "${tableName}" AS c SET 
          "left" = v.left_val::integer, 
          "right" = v.right_val::integer
        FROM (VALUES ${values}) AS v(id, left_val, right_val)
        WHERE c.id = v.id
      `;
      
      await sequelize.query(query, { type: sequelize.QueryTypes.UPDATE });
    }
  }
  
  const duration = Date.now() - startTime;
  console.log(`Nested set indexes updated for ${records.length} records in ${duration}ms`);
}

/**
 * Queue nested set update for background processing
 * Returns immediately, update happens asynchronously
 * @param {Model} Model - Sequelize model class
 * @returns {Promise<void>}
 */
async function queueNestedSetUpdate() {
  const { nestedSetQueue } = require('../config/queue');
  
  if (nestedSetQueue) {
    await nestedSetQueue.add('update-nested-set', {}, {
      removeOnComplete: true,
      removeOnFail: 100
    });
    console.log('Nested set update queued for background processing');
  } else {
    // Fallback to synchronous if queue not available
    const { Company } = require('../models');
    await updateNestedSetIndexes(Company);
  }
}

module.exports = {
  updateNestedSetIndexes,
  queueNestedSetUpdate
};
