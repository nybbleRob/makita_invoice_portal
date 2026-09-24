const { File, Settings, Statement } = require('../models');
const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');

/**
 * File names of every rendition a live statement still owns. Statement files
 * are governed by statement retention, which purges the statement and its
 * files together. If this job also deleted them whenever fileRetentionDays
 * was shorter than the statement period (30 against 90 on live in September
 * 2026), statements would stay listed with their PDF/XLSX gone from disk.
 * Matched by exact file name, so a stray same-named copy elsewhere is kept
 * rather than deleted.
 */
async function getLiveStatementFileNames() {
  const rows = await Statement.findAll({ attributes: ['fileUrl', 'pdfFileUrl', 'xlsFileUrl'], raw: true });
  const names = new Set();
  for (const row of rows) {
    for (const stored of [row.fileUrl, row.pdfFileUrl, row.xlsFileUrl]) {
      if (stored) names.add(path.basename(stored));
    }
  }
  return names;
}

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
    let keptForStatements = 0;
    const liveStatementFiles = await getLiveStatementFileNames();

    for (const file of filesToDelete) {
      if (file.filePath && liveStatementFiles.has(path.basename(file.filePath))) {
        keptForStatements++;
        continue;
      }
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
    
    console.log(`✅ File cleanup completed: ${deletedCount} deleted, ${errorCount} errors, ${keptForStatements} kept for live statements`);

    return {
      deleted: deletedCount,
      errors: errorCount,
      keptForStatements,
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

