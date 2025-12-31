/**
 * Script to run file cleanup job manually
 * This can also be scheduled via cron or task scheduler
 */

require('dotenv').config();
const { sequelize, testConnection } = require('../config/database');
const { cleanupOldFiles } = require('../jobs/fileCleanup');

async function runCleanup() {
  try {
    console.log('🔌 Testing PostgreSQL connection...');
    const connected = await testConnection();
    
    if (!connected) {
      console.error('❌ Cannot connect to PostgreSQL');
      process.exit(1);
    }

    console.log('\n🧹 Running file cleanup job...');
    const result = await cleanupOldFiles();
    
    console.log('\n✅ Cleanup completed:', result);
    
    await sequelize.close();
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.original) {
      console.error('   Original error:', error.original.message);
    }
    await sequelize.close();
    process.exit(1);
  }
}

runCleanup();

