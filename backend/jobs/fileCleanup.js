const { File, Settings } = require('../models');
const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');

/**
 * Scheduled job to delete old files based on retention period
 * Should be run daily via cron or scheduler
 */

async function cleanupOldFiles() {
  try {
    console.log('🧹 Starting file cleanup job...');
    
    const settings = await Settings.getSettings();
    const retentionDays = settings.fileRetentionDays;
    
    // If retention is disabled (null), skip cleanup
    if (!retentionDays || retentionDays <= 0) {
      console.log('ℹ️  File retention is disabled, skipping cleanup');
      return { deleted: 0, skipped: 0 };
    }
    
    // Calculate cutoff date
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
    
    console.log(`📅 Deleting files older than ${retentionDays} days (before ${cutoffDate.toISOString()})`);
    
    // Find files to delete
    const filesToDelete = await File.findAll({
      where: {
        uploadedAt: {
          [Op.lt]: cutoffDate
        },
        deletedAt: null // Not already deleted
      }
    });
    
    let deletedCount = 0;
    let errorCount = 0;
    
    for (const file of filesToDelete) {
      try {
        // Delete physical file if it exists
        if (file.filePath && fs.existsSync(file.filePath)) {
          fs.unlinkSync(file.filePath);
          console.log(`🗑️  Deleted file: ${file.fileName}`);
        }
        
        // Mark as deleted in database (soft delete)
        await file.update({
          deletedAt: new Date()
        });
        
        deletedCount++;
      } catch (error) {
        console.error(`❌ Error deleting file ${file.fileName}:`, error.message);
        errorCount++;
      }
    }
    
    console.log(`✅ File cleanup completed: ${deletedCount} deleted, ${errorCount} errors`);
    
    return {
      deleted: deletedCount,
      errors: errorCount,
      total: filesToDelete.length
    };
  } catch (error) {
    console.error('❌ File cleanup job error:', error.message);
    throw error;
  }
}

module.exports = {
  cleanupOldFiles
};

