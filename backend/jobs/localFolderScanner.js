/**
 * Local Folder Scanner Job
 * Scans the local FTP inbound folder for new PDF files and queues them for import.
 * This is used for files uploaded via vsftpd to the server's local filesystem.
 * 
 * Environment variables:
 * - FTP_INBOUND_PATH: Path to scan for new files (default: /mnt/data/ftp-inbound)
 * - FTP_PROCESSED_PATH: Path to move successfully processed files (default: /mnt/data/ftp-processed)
 * - FTP_FAILED_PATH: Path to move failed files (default: /mnt/data/ftp-failed)
 */

const fs = require('fs');
const path = require('path');
const { File, Settings, User } = require('../models');
const { invoiceImportQueue, emailQueue } = require('../config/queue');
const { Op } = require('sequelize');
const crypto = require('crypto');
const importLogger = require('../services/importLogger');

// Default paths (can be overridden by environment variables)
const INBOUND_PATH = process.env.FTP_INBOUND_PATH || '/mnt/data/ftp-inbound';
const PROCESSED_PATH = process.env.FTP_PROCESSED_PATH || '/mnt/data/ftp-processed';
const FAILED_PATH = process.env.FTP_FAILED_PATH || '/mnt/data/ftp-failed';

// Supported file extensions
const SUPPORTED_EXTENSIONS = ['.pdf', '.xlsx', '.xls'];

/**
 * Calculate file hash for duplicate detection
 */
function calculateFileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    
    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/**
 * Ensure directory exists
 */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Get dated subfolder path (e.g., /mnt/data/ftp-processed/2026-01-01)
 */
function getDatedFolder(basePath) {
  const dateStr = new Date().toISOString().split('T')[0];
  const datedPath = path.join(basePath, dateStr);
  ensureDir(datedPath);
  return datedPath;
}

/**
 * Move file to processed folder
 */
function moveToProcessed(filePath, fileName) {
  const destFolder = getDatedFolder(PROCESSED_PATH);
  const destPath = path.join(destFolder, fileName);
  
  // Handle duplicate filenames by adding timestamp
  let finalPath = destPath;
  if (fs.existsSync(destPath)) {
    const ext = path.extname(fileName);
    const base = path.basename(fileName, ext);
    finalPath = path.join(destFolder, `${base}-${Date.now()}${ext}`);
  }
  
  fs.renameSync(filePath, finalPath);
  console.log(`✅ Moved to processed: ${finalPath}`);
  return finalPath;
}

/**
 * Move file to failed folder
 */
function moveToFailed(filePath, fileName, error) {
  const destFolder = getDatedFolder(FAILED_PATH);
  const destPath = path.join(destFolder, fileName);
  
  // Handle duplicate filenames
  let finalPath = destPath;
  if (fs.existsSync(destPath)) {
    const ext = path.extname(fileName);
    const base = path.basename(fileName, ext);
    finalPath = path.join(destFolder, `${base}-${Date.now()}${ext}`);
  }
  
  fs.renameSync(filePath, finalPath);
  
  // Write error log alongside the file
  const errorLogPath = finalPath + '.error.txt';
  fs.writeFileSync(errorLogPath, `Failed at: ${new Date().toISOString()}\nError: ${error}\n`);
  
  console.log(`❌ Moved to failed: ${finalPath}`);
  return finalPath;
}

/**
 * Scan the local inbound folder and queue files for import
 * @returns {Promise<Object>} Scan results
 */
async function scanLocalFolder() {
  const results = {
    scanned: 0,
    queued: 0,
    skipped: 0,
    duplicates: 0,
    errors: [],
    files: []
  };
  
  // Start logging the run
  const runContext = await importLogger.startRun();
  
  try {
    await importLogger.log.info(`Scanning inbound folder: ${INBOUND_PATH}`);
    
    // Check if inbound directory exists
    if (!fs.existsSync(INBOUND_PATH)) {
      console.log(`⚠️  Inbound folder does not exist: ${INBOUND_PATH}`);
      console.log('   Creating folder...');
      ensureDir(INBOUND_PATH);
      return results;
    }
    
    // Ensure processed and failed directories exist
    ensureDir(PROCESSED_PATH);
    ensureDir(FAILED_PATH);
    
    // Read files from inbound directory
    const files = fs.readdirSync(INBOUND_PATH);
    
    // Filter for supported file types
    const supportedFiles = files.filter(file => {
      const ext = path.extname(file).toLowerCase();
      return SUPPORTED_EXTENSIONS.includes(ext);
    });
    
    console.log(`📁 Found ${supportedFiles.length} supported file(s) in inbound folder`);
    results.scanned = supportedFiles.length;
    
    if (supportedFiles.length === 0) {
      console.log('ℹ️  No files to process');
      return results;
    }
    
    // Get system user for import attribution
    const systemUser = await User.findOne({
      where: { role: 'global_admin' },
      order: [['createdAt', 'ASC']]
    });
    
    // Get existing queued jobs to check for duplicates
    const existingJobs = await invoiceImportQueue.getJobs(['waiting', 'wait', 'active', 'delayed']);
    const queuedFileNames = new Set(existingJobs.map(job => job.data?.fileName).filter(Boolean));
    
    // Process each file
    for (const fileName of supportedFiles) {
      const filePath = path.join(INBOUND_PATH, fileName);
      
      try {
        const stats = fs.statSync(filePath);
        
        // Skip if file is too new (still being uploaded) - wait 30 seconds
        const fileAge = Date.now() - stats.mtimeMs;
        if (fileAge < 30000) {
          console.log(`⏭️  File too new, waiting: ${fileName} (${Math.round(fileAge/1000)}s old)`);
          results.skipped++;
          continue;
        }
        
        // Skip if already in queue
        if (queuedFileNames.has(fileName)) {
          console.log(`⏭️  File already queued: ${fileName}`);
          results.skipped++;
          continue;
        }
        
        // Calculate hash for duplicate detection
        const fileHash = await calculateFileHash(filePath);
        
        // Check for duplicate in database (excluding deleted files)
        const existingFile = await File.findOne({
          where: {
            fileHash,
            deletedAt: null
          }
        });
        
        if (existingFile) {
          console.log(`⏭️  Duplicate file (hash match): ${fileName}`);
          
          // Move to processed/duplicates folder
          const duplicatesFolder = path.join(PROCESSED_PATH, 'duplicates');
          ensureDir(duplicatesFolder);
          const datedDuplicatesFolder = path.join(duplicatesFolder, new Date().toISOString().split('T')[0]);
          ensureDir(datedDuplicatesFolder);
          
          const destPath = path.join(datedDuplicatesFolder, fileName);
          fs.renameSync(filePath, destPath);
          
          results.duplicates++;
          continue;
        }
        
        // Check for recently processed (within last hour)
        const recentFile = await File.findOne({
          where: {
            fileName,
            uploadedAt: {
              [Op.gte]: new Date(Date.now() - 60 * 60 * 1000)
            }
          }
        });
        
        if (recentFile) {
          console.log(`⏭️  File recently processed: ${fileName}`);
          results.skipped++;
          continue;
        }
        
        // Generate unique import ID
        const importId = `local-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        // Queue file for import
        await invoiceImportQueue.add('invoice-import', {
          filePath: filePath,
          fileName: fileName,
          originalName: fileName,
          importId: importId,
          userId: systemUser?.id || null,
          source: 'local-ftp',
          fileHash: fileHash,
          documentType: 'auto' // Auto-detect from template matching
        }, {
          jobId: `local-import-${Date.now()}-${fileName}`,
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000
          },
          removeOnComplete: true,
          removeOnFail: false
        });
        
        console.log(`✅ Queued file: ${fileName} (import: ${importId})`);
        results.queued++;
        results.files.push({
          fileName,
          fileSize: stats.size,
          importId
        });
        
      } catch (fileError) {
        console.error(`❌ Error processing file ${fileName}:`, fileError.message);
        results.errors.push({
          fileName,
          error: fileError.message
        });
        
        // Move failed file
        try {
          moveToFailed(filePath, fileName, fileError.message);
        } catch (moveError) {
          console.error(`   Could not move failed file: ${moveError.message}`);
        }
      }
    }
    
    // Log completion using importLogger
    await importLogger.endRun(runContext, results);
    
    // Update settings with last run info
    try {
      const settings = await Settings.getSettingsForUpdate();
      const currentSettings = settings.importSettings || {};
      settings.importSettings = {
        ...currentSettings,
        lastRun: new Date().toISOString(),
        lastRunDuration: Date.now() - runContext.startTime,
        lastRunStats: {
          scanned: results.scanned,
          queued: results.queued,
          processed: results.queued, // Will be updated by invoice import job
          failed: results.errors.length,
          duplicates: results.duplicates
        }
      };
      await settings.save();
      await Settings.invalidateCache();
    } catch (settingsError) {
      console.error('Failed to update settings with run info:', settingsError.message);
    }
    
    return results;
    
  } catch (error) {
    await importLogger.log.error(`Local folder scan failed: ${error.message}`);
    results.errors.push({
      fileName: null,
      error: error.message
    });
    
    // Still end the run to record the failure
    await importLogger.endRun(runContext, results);
    throw error;
  }
}

/**
 * Process the local folder scan job (called by queue worker)
 * @param {Object} job - BullMQ job object
 */
async function processLocalFolderScan(job) {
  console.log(`📋 Processing local folder scan job: ${job.id}`);
  
  const results = await scanLocalFolder();
  
  // Send summary email if there were any files processed or errors
  if (results.queued > 0 || results.errors.length > 0) {
    try {
      await sendScanSummaryEmail(results);
    } catch (emailError) {
      console.error('⚠️  Failed to send scan summary email:', emailError.message);
    }
  }
  
  return results;
}

/**
 * Send scan summary email to global admins
 */
async function sendScanSummaryEmail(results) {
  const { Settings, User } = require('../models');
  const settings = await Settings.getSettings();
  
  // Get global admin emails
  const admins = await User.findAll({
    where: { 
      role: 'global_admin',
      isActive: true
    },
    attributes: ['email', 'name']
  });
  
  if (admins.length === 0) {
    console.log('ℹ️  No active global admins to notify');
    return;
  }
  
  const portalName = settings.portalName || 'Makita Invoice Portal';
  const hasErrors = results.errors.length > 0;
  
  // Build email content
  const subject = hasErrors 
    ? `⚠️ FTP Import Scan Complete (${results.errors.length} errors) - ${portalName}`
    : `✅ FTP Import Scan Complete - ${portalName}`;
  
  let html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: ${hasErrors ? '#dc3545' : '#198754'};">FTP Import Scan Results</h2>
      <p>The scheduled FTP folder scan has completed.</p>
      
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
        <tr style="background: #f8f9fa;">
          <td style="padding: 10px; border: 1px solid #dee2e6;"><strong>Files Scanned</strong></td>
          <td style="padding: 10px; border: 1px solid #dee2e6;">${results.scanned}</td>
        </tr>
        <tr>
          <td style="padding: 10px; border: 1px solid #dee2e6;"><strong>Queued for Import</strong></td>
          <td style="padding: 10px; border: 1px solid #dee2e6; color: #198754;">${results.queued}</td>
        </tr>
        <tr style="background: #f8f9fa;">
          <td style="padding: 10px; border: 1px solid #dee2e6;"><strong>Skipped</strong></td>
          <td style="padding: 10px; border: 1px solid #dee2e6;">${results.skipped}</td>
        </tr>
        <tr>
          <td style="padding: 10px; border: 1px solid #dee2e6;"><strong>Duplicates</strong></td>
          <td style="padding: 10px; border: 1px solid #dee2e6;">${results.duplicates}</td>
        </tr>
        <tr style="background: #f8f9fa;">
          <td style="padding: 10px; border: 1px solid #dee2e6;"><strong>Errors</strong></td>
          <td style="padding: 10px; border: 1px solid #dee2e6; color: ${hasErrors ? '#dc3545' : 'inherit'};">${results.errors.length}</td>
        </tr>
      </table>
  `;
  
  // Add queued files list
  if (results.files.length > 0) {
    html += `
      <h3>Files Queued for Import:</h3>
      <ul style="padding-left: 20px;">
        ${results.files.map(f => `<li>${f.fileName} (${(f.fileSize / 1024).toFixed(1)} KB)</li>`).join('')}
      </ul>
    `;
  }
  
  // Add errors if any
  if (results.errors.length > 0) {
    html += `
      <h3 style="color: #dc3545;">Errors:</h3>
      <ul style="padding-left: 20px; color: #dc3545;">
        ${results.errors.map(e => `<li><strong>${e.fileName || 'General'}</strong>: ${e.error}</li>`).join('')}
      </ul>
    `;
  }
  
  html += `
      <hr style="margin: 20px 0; border: none; border-top: 1px solid #dee2e6;">
      <p style="color: #6c757d; font-size: 12px;">
        This is an automated message from ${portalName}.<br>
        Scan time: ${new Date().toISOString()}
      </p>
    </div>
  `;
  
  // Queue email for each admin
  for (const admin of admins) {
    await emailQueue.add('email', {
      to: admin.email,
      subject,
      html,
      text: `FTP Import Scan Results\n\nScanned: ${results.scanned}\nQueued: ${results.queued}\nSkipped: ${results.skipped}\nDuplicates: ${results.duplicates}\nErrors: ${results.errors.length}`,
      metadata: {
        type: 'ftp-scan-summary',
        userId: null,
        userEmail: 'system'
      }
    });
    
    console.log(`📧 Queued scan summary email to: ${admin.email}`);
  }
}

// Export configuration paths for use in other modules
module.exports = {
  scanLocalFolder,
  processLocalFolderScan,
  moveToProcessed,
  moveToFailed,
  INBOUND_PATH,
  PROCESSED_PATH,
  FAILED_PATH
};

