const { listFiles } = require('../utils/ftp');
const { File, Settings } = require('../models');
const { fileImportQueue } = require('../config/queue');
const { Op } = require('sequelize');

/**
 * Scheduled job to scan FTP folders and queue files for import
 * This should be run periodically (e.g., every 5-15 minutes)
 */

async function scanFTPFolders() {
  try {
    console.log('🔍 Starting FTP folder scan...');
    
    const settings = await Settings.getSettings();
    
    if (!settings.ftp || !settings.ftp.enabled) {
      console.log('ℹ️  FTP import is not enabled');
      return { scanned: 0, queued: 0 };
    }
    
    const ftpConfig = settings.ftp;
    let totalScanned = 0;
    let totalQueued = 0;
    
    // Single folder mode - scan base directory only
    if (ftpConfig.singleFolderMode) {
      console.log(`📁 Scanning single folder: ${ftpConfig.directory}`);
      
      const files = await listFiles(ftpConfig);
      totalScanned += files.length;
      
      for (const file of files) {
        const queued = await queueFileIfNew(file, ftpConfig, ftpConfig.directory, ftpConfig.singleFolderFileType || 'invoice');
        if (queued) totalQueued++;
      }
    } else {
      // Multi-folder mode - scan each configured folder
      const folders = ftpConfig.folders || [];
      const folderStructure = ftpConfig.folderStructure || {
        unprocessed: '/Unprocessed',
        processed: '/Processed',
        failed: '/Failed'
      };
      
      for (const folder of folders) {
        if (!folder.enabled) {
          console.log(`⏭️  Skipping disabled folder: ${folder.path}`);
          continue;
        }
        
        // Use folder path as-is (should be relative to base directory)
        const folderPath = folder.path;
        const fileType = folder.fileType || 'auto'; // 'auto' means detect from filename
        
        console.log(`📁 Scanning folder: ${folderPath} (type: ${fileType === 'auto' ? 'auto-detect' : fileType})`);
        
        try {
          // Create folder-specific FTP config
          const folderConfig = {
            ...ftpConfig,
            directory: ftpConfig.directory === '/' 
              ? folderPath 
              : `${ftpConfig.directory}${folderPath}`
          };
          
          const files = await listFiles(folderConfig);
          totalScanned += files.length;
          
          for (const file of files) {
            // Always use 'auto' for file type - will be detected from PDF content
            const queued = await queueFileIfNew(file, folderConfig, folderPath, 'auto');
            if (queued) totalQueued++;
          }
        } catch (error) {
          console.error(`❌ Error scanning folder ${folderPath}:`, error.message);
        }
      }
    }
    
    console.log(`✅ FTP scan completed: ${totalScanned} files scanned, ${totalQueued} new files queued`);
    
    return {
      scanned: totalScanned,
      queued: totalQueued
    };
  } catch (error) {
    console.error('❌ FTP scan error:', error.message);
    throw error;
  }
}

/**
 * Queue a file for import if it hasn't been processed before
 */
async function queueFileIfNew(file, ftpConfig, folderPath, fileType) {
  try {
    // Check if file already exists in queue (by filename and folder)
    // BullMQ uses getJobs with state names including 'wait'
    const existingJobs = await fileImportQueue.getJobs(['waiting', 'wait', 'active', 'delayed']);
    const alreadyQueued = existingJobs.some(job => 
      job.data.fileName === file.name && 
      job.data.ftpFolder === folderPath
    );
    
    if (alreadyQueued) {
      console.log(`⏭️  File already queued: ${file.name}`);
      return false;
    }
    
    // Check if file was recently processed (within last hour)
    // This prevents re-queuing files that are currently being processed
    const recentFile = await File.findOne({
      where: {
        fileName: file.name,
        ftpFolder: folderPath,
        uploadedAt: {
          [Op.gte]: new Date(Date.now() - 60 * 60 * 1000) // Last hour
        }
      }
    });
    
    if (recentFile) {
      console.log(`⏭️  File recently processed: ${file.name}`);
      return false;
    }
    
    // Queue the file (BullMQ format: name, data, options)
    await fileImportQueue.add('file-import', {
      fileName: file.name,
      remotePath: file.name,
      ftpConfig,
      fileType,
      ftpFolder: folderPath
    }, {
      jobId: `ftp-import-${Date.now()}-${file.name}`,
      removeOnComplete: true,
      removeOnFail: false
    });
    
    console.log(`✅ Queued file: ${file.name} (${fileType})`);
    return true;
  } catch (error) {
    console.error(`❌ Error queueing file ${file.name}:`, error.message);
    return false;
  }
}

module.exports = {
  scanFTPFolders
};

