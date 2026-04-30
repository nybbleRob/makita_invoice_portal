/**
 * Migration Script: Purge all document queries from the system
 * WARNING: This will permanently delete all query data. Use for testing only.
 */

const { sequelize } = require('../models');
const { DocumentQuery } = require('../models');

async function purgeAllQueries() {
  try {
    console.log('⚠️  WARNING: This will delete ALL document queries from the system!');
    console.log('🔄 Purging all queries...');
    
    // Count queries before deletion
    const count = await DocumentQuery.count();
    console.log(`📊 Found ${count} queries to delete`);
    
    if (count === 0) {
      console.log('✅ No queries found. Nothing to delete.');
      return;
    }
    
    // Delete all queries
    await DocumentQuery.destroy({
      where: {},
      force: true // Hard delete
    });
    
    console.log(`✅ Successfully deleted ${count} queries!`);
    console.log('⚠️  Note: Activity logs related to queries are preserved for audit purposes.');
    
  } catch (error) {
    console.error('❌ Error purging queries:', error);
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  sequelize.authenticate()
    .then(() => {
      console.log('📦 Database connection established');
      return purgeAllQueries();
    })
    .then(() => {
      console.log('✅ Purge complete');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Purge failed:', error);
      process.exit(1);
    });
}

module.exports = { purgeAllQueries };

