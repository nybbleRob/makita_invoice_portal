/**
 * Local Folder Scanner Job
 * Scans the FTP upload folder for new PDF files and queues them for import.
 * 
 * Processing Flow:
 * 1. Scan FTP_UPLOAD_PATH for new files
 * 2. Calculate hash for each file
 * 3. Check if hash exists in database (duplicate detection)
 * 4. If duplicate: move to unprocessed/duplicates/
 * 5. If new: queue for processing, file stays in upload folder until processed
 * 6. Invoice import job moves file to processed/ or unprocessed/failed/ after processing
 */

const fs = require('fs');
const path = require('path');
const { File, Settings, User } = require('../models');
const { invoiceImportQueue, emailQueue } = require('../config/queue');
const { Op } = require('sequelize');
const crypto = require('crypto');
const importLogger = require('../services/importLogger');
const { isEmailEnabled } = require('../utils/emailService');

// Import storage configuration
const {
  FTP_UPLOAD_PATH,
  UNPROCESSED_DUPLICATES,
  UNPROCESSED_FAILED,
  ensureDir,
  getUnprocessedFilePath
} = require('../config/storage');

// Supported file extensions
const SUPPORTED_EXTENSIONS = ['.pdf', '.xlsx', '.xls'];

/**
 * Calculate file hash (SHA-256) for duplicate detection
 * @param {string} filePath - Path to the file
 * @returns {Promise<string>} SHA-256 hash of the file
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
 * Move file to duplicates folder
 * @param {string} filePath - Current file path
 * @param {string} fileName - File name
 * @returns {string} New file path
 */
function moveToDuplicates(filePath, fileName) {
  const destPath = getUnprocessedFilePath('duplicate', fileName);
  
  // Handle duplicate filenames by adding timestamp
  let finalPath = destPath;
  if (fs.existsSync(destPath)) {
    const ext = path.extname(fileName);
    const base = path.basename(fileName, ext);
    const dir = path.dirname(destPath);
    finalPath = path.join(dir, `${base}-${Date.now()}${ext}`);
  }
  
  fs.renameSync(filePath, finalPath);
  console.log(`📋 Moved duplicate to: ${finalPath}`);
  return finalPath;
}

/**
 * Move file to failed folder with error log
 * @param {string} filePath - Current file path
 * @param {string} fileName - File name
 * @param {string} error - Error message
 * @returns {string} New file path
 */
function moveToFailed(filePath, fileName, error) {
  const destPath = getUnprocessedFilePath('failed', fileName);
  
  // Handle duplicate filenames
  let finalPath = destPath;
  if (fs.existsSync(destPath)) {
    const ext = path.extname(fileName);
    const base = path.basename(fileName, ext);
    const dir = path.dirname(destPath);
    finalPath = path.join(dir, `${base}-${Date.now()}${ext}`);
  }
  
  fs.renameSync(filePath, finalPath);
  
  // Write error log alongside the file
  const errorLogPath = finalPath + '.error.txt';
  fs.writeFileSync(errorLogPath, `Failed at: ${new Date().toISOString()}\nError: ${error}\n`);
  
  console.log(`❌ Moved to failed: ${finalPath}`);
  return finalPath;
}

/**
 * Check if file hash exists in database (duplicate detection)
 * @param {string} fileHash - SHA-256 hash of the file
 * @returns {Promise<boolean>} True if duplicate exists
 */
async function isDuplicateHash(fileHash) {
  const existingFile = await File.findOne({
    where: {
      fileHash,
      deletedAt: null
    }
  });
  return !!existingFile;
}

/**
 * Scan the FTP upload folder and queue files for import
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
    await importLogger.log.info(`Scanning FTP upload folder: ${FTP_UPLOAD_PATH}`);
    
    // Check if upload directory exists
    if (!fs.existsSync(FTP_UPLOAD_PATH)) {
      console.log(`⚠️  FTP upload folder does not exist: ${FTP_UPLOAD_PATH}`);
      console.log('   Creating folder...');
      ensureDir(FTP_UPLOAD_PATH);
      await importLogger.log.warn(`Created missing FTP upload folder: ${FTP_UPLOAD_PATH}`);
      return results;
    }
    
    // Ensure unprocessed directories exist
    ensureDir(UNPROCESSED_DUPLICATES);
    ensureDir(UNPROCESSED_FAILED);
    
    // Read files from upload directory
    console.log(`🔍 DEBUG: Reading directory: ${FTP_UPLOAD_PATH}`);
    console.log(`🔍 DEBUG: Directory exists: ${fs.existsSync(FTP_UPLOAD_PATH)}`);
    
    const files = fs.readdirSync(FTP_UPLOAD_PATH);
    console.log(`🔍 DEBUG: Total files/dirs in folder: ${files.length}`);
    if (files.length > 0) {
      console.log(`🔍 DEBUG: First 5 files: ${files.slice(0, 5).join(', ')}`);
    }
    
    // Filter for supported file types
    const supportedFiles = files.filter(file => {
      const ext = path.extname(file).toLowerCase();
      const isSupported = SUPPORTED_EXTENSIONS.includes(ext);
      if (!isSupported && files.length <= 10) {
        console.log(`🔍 DEBUG: File "${file}" has extension "${ext}" - not supported`);
      }
      return isSupported;
    });
    
    console.log(`📁 Found ${supportedFiles.length} supported file(s) in FTP upload folder`);
    results.scanned = supportedFiles.length;
    
    if (supportedFiles.length === 0) {
      console.log('ℹ️  No files to process');
      await importLogger.log.info('No files to process');
      await importLogger.endRun(runContext, results);
      return results;
    }
    
    // Get system user for import attribution
    const systemUser = await User.findOne({
      where: { role: 'global_admin' },
      order: [['createdAt', 'ASC']]
    });
    
    // Generate batch import ID for all files in this scan
    const batchImportId = `ftp-batch-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Get existing queued jobs to check for already-queued files
    const existingJobs = await invoiceImportQueue.getJobs(['waiting', 'wait', 'active', 'delayed']);
    const queuedFileNames = new Set(existingJobs.map(job => job.data?.fileName).filter(Boolean));
    const queuedHashes = new Set(existingJobs.map(job => job.data?.fileHash).filter(Boolean));
    
    // FIRST PASS: Determine which files will be queued (without actually queuing)
    // This fixes the race condition where jobs complete before batch is registered
    const filesToQueue = [];
    
    for (const fileName of supportedFiles) {
      const filePath = path.join(FTP_UPLOAD_PATH, fileName);
      
      try {
        const stats = fs.statSync(filePath);
        
        // Skip if file is too new (still being uploaded) - wait 30 seconds
        const fileAge = Date.now() - stats.mtimeMs;
        if (fileAge < 30000) {
          console.log(`[Scan] File too new, waiting: ${fileName} (${Math.round(fileAge/1000)}s old)`);
          results.skipped++;
          continue;
        }
        
        // Skip if already in queue by filename
        if (queuedFileNames.has(fileName)) {
          console.log(`[Scan] File already queued (by name): ${fileName}`);
          results.skipped++;
          continue;
        }
        
        // Calculate hash for duplicate detection
        const fileHash = await calculateFileHash(filePath);
        
        // Skip if hash already in queue
        if (queuedHashes.has(fileHash)) {
          console.log(`[Scan] File already queued (by hash): ${fileName}`);
          results.skipped++;
          continue;
        }
        
        // Check for duplicate in database (hash-based)
        const isDuplicate = await isDuplicateHash(fileHash);
        
        if (isDuplicate) {
          console.log(`[Scan] Duplicate detected (hash match): ${fileName}`);
          await importLogger.log.info(`Duplicate file detected: ${fileName}`);
          
          // Move to duplicates folder immediately
          moveToDuplicates(filePath, fileName);
          
          results.duplicates++;
          continue;
        }
        
        // Check for recently processed file with same name (within last hour)
        const recentFile = await File.findOne({
          where: {
            fileName,
            uploadedAt: {
              [Op.gte]: new Date(Date.now() - 60 * 60 * 1000)
            }
          }
        });
        
        if (recentFile) {
          console.log(`[Scan] File recently processed: ${fileName}`);
          results.skipped++;
          continue;
        }
        
        // This file will be queued - add to list
        filesToQueue.push({
          filePath,
          fileName,
          fileHash,
          fileSize: stats.size
        });
        
      } catch (fileError) {
        console.error(`[Scan] Error processing file ${fileName}:`, fileError.message);
        await importLogger.log.error(`Error: ${fileName} - ${fileError.message}`);
        
        results.errors.push({
          fileName,
          error: fileError.message
        });
        
        // Move failed file to unprocessed/failed
        try {
          moveToFailed(filePath, fileName, fileError.message);
        } catch (moveError) {
          console.error(`   Could not move failed file: ${moveError.message}`);
        }
      }
    }
    
    // REGISTER BATCH BEFORE QUEUING JOBS (critical for notification tracking)
    // This ensures the batch exists in Redis before any job can complete
    if (filesToQueue.length > 0) {
      try {
        const { registerBatch } = require('../services/batchNotificationService');
        await registerBatch(batchImportId, filesToQueue.length, {
          userId: systemUser?.id || null,
          userEmail: systemUser?.email || 'system',
          source: 'ftp-scan'
        });
        console.log(`[Batch ${batchImportId}] Registered batch with ${filesToQueue.length} jobs for notification tracking`);
      } catch (batchError) {
        console.warn('Failed to register batch:', batchError.message);
      }
    }
    
    // SECOND PASS: Actually queue the files
    for (const file of filesToQueue) {
      try {
        await invoiceImportQueue.add('invoice-import', {
          filePath: file.filePath,
          fileName: file.fileName,
          originalName: file.fileName,
          importId: batchImportId, // Use batch ID for notification tracking
          userId: systemUser?.id || null,
          source: 'ftp-upload',
          fileHash: file.fileHash,
          documentType: 'auto', // Auto-detect from template matching
          priority: 0 // Normal priority (manual uploads get priority 1)
        }, {
          jobId: `ftp-import-${Date.now()}-${file.fileHash.substring(0, 8)}`,
          priority: 0, // Normal priority
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000
          },
          removeOnComplete: true,
          removeOnFail: false
        });
        
        console.log(`[Scan] Queued file: ${file.fileName} (batch: ${batchImportId})`);
        await importLogger.log.info(`Queued: ${file.fileName}`);
        
        results.queued++;
        results.files.push({
          fileName: file.fileName,
          fileSize: file.fileSize,
          fileHash: file.fileHash,
          importId: batchImportId
        });
        
      } catch (queueError) {
        console.error(`[Scan] Error queuing file ${file.fileName}:`, queueError.message);
        results.errors.push({
          fileName: file.fileName,
          error: queueError.message
        });
      }
    }
    
    // Log completion
    await importLogger.log.info(`Scan complete: ${results.scanned} scanned, ${results.queued} queued, ${results.duplicates} duplicates, ${results.errors.length} errors`);
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
          duplicates: results.duplicates,
          skipped: results.skipped,
          errors: results.errors.length
        }
      };
      await settings.save();
      await Settings.invalidateCache();
    } catch (settingsError) {
      console.error('Failed to update settings with run info:', settingsError.message);
    }
    
    return results;
    
  } catch (error) {
    await importLogger.log.error(`Folder scan failed: ${error.message}`);
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
  console.log(`📋 Processing FTP folder scan job: ${job.id}`);
  
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
  const { wrapEmailContent } = require('../utils/emailTheme');
  const settings = await Settings.getSettings();
  
  // Check if email is enabled (Mailtrap = test mode, always enabled)
  if (!isEmailEnabled(settings)) {
    console.log('[Scan] Email not enabled, skipping scan summary email');
    return;
  }
  
  // Get global admin emails
  const admins = await User.findAll({
    where: { 
      role: 'global_admin',
      isActive: true
    },
    attributes: ['email', 'name']
  });
  
  if (admins.length === 0) {
    console.log('[Scan] No active global admins to notify');
    return;
  }
  
  const portalName = settings.portalName || settings.siteTitle || 'Makita Invoice Portal';
  const primaryColor = settings.primaryColor || '#066fd1';
  const hasErrors = results.errors.length > 0;
  
  // Build email content (will be wrapped with branding)
  const subject = hasErrors 
    ? `FTP Import Scan Complete (${results.errors.length} errors) - ${portalName}`
    : `FTP Import Scan Complete - ${portalName}`;
  
  let emailContent = `
    <h2 style="color: ${hasErrors ? '#dc3545' : primaryColor}; margin-bottom: 20px;">FTP Import Scan Results</h2>
    <p>The scheduled FTP folder scan has completed.</p>
    
    <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
      <tr style="background: #f8f9fa;">
        <td style="padding: 12px; border: 1px solid #e0e0e0; font-weight: 600;">Files Scanned</td>
        <td style="padding: 12px; border: 1px solid #e0e0e0;">${results.scanned}</td>
      </tr>
      <tr>
        <td style="padding: 12px; border: 1px solid #e0e0e0; font-weight: 600;">Queued for Import</td>
        <td style="padding: 12px; border: 1px solid #e0e0e0; color: #198754; font-weight: 600;">${results.queued}</td>
      </tr>
      <tr style="background: #f8f9fa;">
        <td style="padding: 12px; border: 1px solid #e0e0e0; font-weight: 600;">Duplicates (Moved)</td>
        <td style="padding: 12px; border: 1px solid #e0e0e0;">${results.duplicates}</td>
      </tr>
      <tr>
        <td style="padding: 12px; border: 1px solid #e0e0e0; font-weight: 600;">Skipped</td>
        <td style="padding: 12px; border: 1px solid #e0e0e0;">${results.skipped}</td>
      </tr>
      <tr style="background: #f8f9fa;">
        <td style="padding: 12px; border: 1px solid #e0e0e0; font-weight: 600;">Errors</td>
        <td style="padding: 12px; border: 1px solid #e0e0e0; color: ${hasErrors ? '#dc3545' : 'inherit'}; font-weight: ${hasErrors ? '600' : 'normal'};">${results.errors.length}</td>
      </tr>
    </table>
  `;
  
  // Add queued files list (limit to first 20)
  if (results.files.length > 0) {
    const displayFiles = results.files.slice(0, 20);
    emailContent += `
      <h3 style="color: ${primaryColor}; margin-top: 24px;">Files Queued for Import:</h3>
      <ul style="padding-left: 20px; margin: 12px 0;">
        ${displayFiles.map(f => `<li style="margin-bottom: 4px;">${f.fileName} (${(f.fileSize / 1024).toFixed(1)} KB)</li>`).join('')}
        ${results.files.length > 20 ? `<li style="font-style: italic; color: #667085;">...and ${results.files.length - 20} more</li>` : ''}
      </ul>
    `;
  }
  
  // Add errors if any
  if (results.errors.length > 0) {
    emailContent += `
      <div style="background: #f8d7da; border: 1px solid #d63939; border-radius: 4px; padding: 12px; margin-top: 20px;">
        <h3 style="color: #721c24; margin: 0 0 12px 0;">Errors:</h3>
        <ul style="padding-left: 20px; color: #721c24; margin: 0;">
          ${results.errors.map(e => `<li><strong>${e.fileName || 'General'}</strong>: ${e.error}</li>`).join('')}
        </ul>
      </div>
    `;
  }
  
  emailContent += `
    <p style="color: #667085; font-size: 12px; margin-top: 24px;">
      Scan completed: ${new Date().toLocaleString()}
    </p>
  `;
  
  // Wrap with portal branding
  const html = wrapEmailContent(emailContent, settings);
  
  // Queue email for each admin
  for (const admin of admins) {
    await emailQueue.add('email', {
      to: admin.email,
      subject,
      html,
      text: `FTP Import Scan Results\n\nScanned: ${results.scanned}\nQueued: ${results.queued}\nDuplicates: ${results.duplicates}\nSkipped: ${results.skipped}\nErrors: ${results.errors.length}`,
      metadata: {
        type: 'ftp-scan-summary',
        userId: null,
        userEmail: 'system'
      }
    });
    
    console.log(`[Scan] Queued scan summary email to: ${admin.email}`);
  }
}

// Export functions and paths
module.exports = {
  scanLocalFolder,
  processLocalFolderScan,
  moveToDuplicates,
  moveToFailed,
  calculateFileHash,
  isDuplicateHash,
  // Re-export paths for convenience
  FTP_UPLOAD_PATH,
  UNPROCESSED_DUPLICATES,
  UNPROCESSED_FAILED
};
