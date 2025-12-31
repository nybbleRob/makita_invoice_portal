/**
 * Script to delete all File records from the database
 * WARNING: This will permanently delete all File records!
 */

const { File } = require('../models');
const { sequelize } = require('../models');

async function deleteAllFiles() {
  try {
    console.log('🗑️  Starting deletion of all File records...');
    
    // Count files first
    const count = await File.count({ paranoid: false });
    console.log(`📊 Found ${count} File records (including soft-deleted)`);
    
    if (count === 0) {
      console.log('✅ No File records to delete.');
      return;
    }
    
    // Delete all files (including soft-deleted)
    const deleted = await File.destroy({
      where: {},
      force: true, // Hard delete (permanent)
      paranoid: false // Include soft-deleted records
    });
    
    console.log(`✅ Successfully deleted ${deleted} File records!`);
    console.log('🔄 Database is now clean. You can start importing files fresh.');
    
  } catch (error) {
    console.error('❌ Error deleting File records:', error);
    throw error;
  } finally {
    await sequelize.close();
  }
}

// Run the script
deleteAllFiles()
  .then(() => {
    console.log('✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });

