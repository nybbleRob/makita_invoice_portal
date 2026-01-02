/**
 * Import Settings Routes
 * API endpoints for managing FTP/local import scheduler settings and logs
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const auth = require('../middleware/auth');
const globalAdmin = require('../middleware/globalAdmin');
const { Settings } = require('../models');
const { getLogs, clearLogs, getStats, getLastRun, resetStats, log } = require('../services/importLogger');
const { scheduledTasksQueue } = require('../config/queue');
const { scanLocalFolder } = require('../jobs/localFolderScanner');
const { UNPROCESSED_FAILED, FTP_UPLOAD_PATH, ensureDir } = require('../config/storage');

const router = express.Router();

// Frequency options in minutes
const VALID_FREQUENCIES = [15, 30, 60, 120, 240, 360, 720, 1440];

/**
 * Get import settings
 */
router.get('/', auth, globalAdmin, async (req, res) => {
  try {
    const settings = await Settings.getSettings();
    
    // Get import settings with defaults
    const importSettings = settings.importSettings || {
      enabled: true,
      frequency: 60,
      lastRun: null,
      lastRunDuration: null,
      lastRunStats: null,
      nextScheduledRun: null
    };

    // Get additional info from Redis
    const [stats, lastRun, scheduledJobs] = await Promise.all([
      getStats(),
      getLastRun(),
      scheduledTasksQueue.getRepeatableJobs().catch(() => [])
    ]);

    // Find the local-folder-scan job to get next run time
    const scanJob = scheduledJobs.find(job => job.name === 'local-folder-scan');
    const nextRun = scanJob?.next ? new Date(scanJob.next).toISOString() : null;

    res.json({
      ...importSettings,
      stats,
      lastRun,
      nextScheduledRun: nextRun,
      validFrequencies: VALID_FREQUENCIES.map(mins => ({
        value: mins,
        label: mins < 60 ? `${mins} minutes` : 
               mins === 60 ? '1 hour' : 
               mins < 1440 ? `${mins / 60} hours` : '24 hours'
      }))
    });
  } catch (error) {
    console.error('Error getting import settings:', error);
    res.status(500).json({ message: error.message });
  }
});

/**
 * Update import settings (frequency, enabled)
 */
router.put('/', auth, globalAdmin, async (req, res) => {
  try {
    const { enabled, frequency } = req.body;
    
    // Validate frequency
    if (frequency !== undefined && !VALID_FREQUENCIES.includes(frequency)) {
      return res.status(400).json({ 
        message: `Invalid frequency. Must be one of: ${VALID_FREQUENCIES.join(', ')} minutes` 
      });
    }

    const settings = await Settings.getSettingsForUpdate();
    
    // Update import settings
    const currentSettings = settings.importSettings || {};
    settings.importSettings = {
      ...currentSettings,
      ...(enabled !== undefined && { enabled }),
      ...(frequency !== undefined && { frequency })
    };
    
    await settings.save();
    await Settings.invalidateCache();

    // Reschedule the job with new frequency
    if (frequency !== undefined) {
      await rescheduleImportJob(frequency, enabled !== false);
    } else if (enabled !== undefined) {
      await rescheduleImportJob(settings.importSettings.frequency || 60, enabled);
    }

    log.info(`Import settings updated: frequency=${frequency || 'unchanged'}, enabled=${enabled !== undefined ? enabled : 'unchanged'}`);

    res.json({ 
      message: 'Import settings updated successfully',
      importSettings: settings.importSettings
    });
  } catch (error) {
    console.error('Error updating import settings:', error);
    res.status(500).json({ message: error.message });
  }
});

/**
 * Get import logs for terminal viewer
 */
router.get('/logs', auth, globalAdmin, async (req, res) => {
  try {
    const count = parseInt(req.query.count) || 100;
    const logs = await getLogs(Math.min(count, 500)); // Cap at 500
    
    res.json({
      logs,
      count: logs.length
    });
  } catch (error) {
    console.error('Error getting import logs:', error);
    res.status(500).json({ message: error.message });
  }
});

/**
 * Clear import logs
 */
router.delete('/logs', auth, globalAdmin, async (req, res) => {
  try {
    await clearLogs();
    res.json({ message: 'Import logs cleared successfully' });
  } catch (error) {
    console.error('Error clearing import logs:', error);
    res.status(500).json({ message: error.message });
  }
});

/**
 * Trigger manual import scan
 */
router.post('/trigger', auth, globalAdmin, async (req, res) => {
  try {
    log.info('Manual import scan triggered by user');

    // Run the scan immediately
    const results = await scanLocalFolder();

    // Update settings with last run info
    const settings = await Settings.getSettingsForUpdate();
    const currentSettings = settings.importSettings || {};
    settings.importSettings = {
      ...currentSettings,
      lastRun: new Date().toISOString(),
      lastRunStats: results
    };
    await settings.save();
    await Settings.invalidateCache();

    res.json({
      success: true,
      message: 'Import scan completed',
      results
    });
  } catch (error) {
    console.error('Error triggering import scan:', error);
    log.error(`Manual import scan failed: ${error.message}`);
    res.status(500).json({ 
      success: false,
      message: error.message 
    });
  }
});

/**
 * Get import statistics
 */
router.get('/stats', auth, globalAdmin, async (req, res) => {
  try {
    const stats = await getStats();
    res.json(stats);
  } catch (error) {
    console.error('Error getting import stats:', error);
    res.status(500).json({ message: error.message });
  }
});

/**
 * Get count of failed files available for retry
 */
router.get('/failed-count', auth, globalAdmin, async (req, res) => {
  try {
    let totalFiles = 0;
    const folders = [];

    // Check if failed folder exists
    if (!fs.existsSync(UNPROCESSED_FAILED)) {
      return res.json({ count: 0, folders: [] });
    }

    // Read all date folders
    const dateFolders = fs.readdirSync(UNPROCESSED_FAILED);
    
    for (const folder of dateFolders) {
      const folderPath = path.join(UNPROCESSED_FAILED, folder);
      const stat = fs.statSync(folderPath);
      
      if (stat.isDirectory()) {
        const files = fs.readdirSync(folderPath);
        const pdfFiles = files.filter(f => f.toLowerCase().endsWith('.pdf'));
        
        if (pdfFiles.length > 0) {
          folders.push({
            name: folder,
            count: pdfFiles.length
          });
          totalFiles += pdfFiles.length;
        }
      }
    }

    res.json({
      count: totalFiles,
      folders: folders.sort((a, b) => b.name.localeCompare(a.name)) // Most recent first
    });
  } catch (error) {
    console.error('Error getting failed file count:', error);
    res.status(500).json({ message: error.message });
  }
});

/**
 * Retry failed imports - moves files from failed folder back to uploads
 */
router.post('/retry-failed', auth, globalAdmin, async (req, res) => {
  try {
    const { triggerScan = true } = req.body;
    
    log.info('Retry failed imports triggered by user');

    // Check if failed folder exists
    if (!fs.existsSync(UNPROCESSED_FAILED)) {
      return res.json({
        success: true,
        message: 'No failed files to retry',
        moved: 0,
        errors: 0
      });
    }

    // Ensure upload folder exists
    ensureDir(FTP_UPLOAD_PATH);

    let movedCount = 0;
    let errorCount = 0;
    let deletedErrorLogs = 0;
    const errors = [];

    // Read all date folders
    const dateFolders = fs.readdirSync(UNPROCESSED_FAILED);
    
    for (const folder of dateFolders) {
      const folderPath = path.join(UNPROCESSED_FAILED, folder);
      const stat = fs.statSync(folderPath);
      
      if (stat.isDirectory()) {
        const files = fs.readdirSync(folderPath);
        
        for (const file of files) {
          const filePath = path.join(folderPath, file);
          
          // Skip if it's an error log file
          if (file.endsWith('.error.txt')) {
            try {
              fs.unlinkSync(filePath);
              deletedErrorLogs++;
            } catch (err) {
              // Ignore error log deletion failures
            }
            continue;
          }
          
          // Only process supported file types
          const ext = path.extname(file).toLowerCase();
          if (!['.pdf', '.xlsx', '.xls'].includes(ext)) {
            continue;
          }
          
          try {
            const destPath = path.join(FTP_UPLOAD_PATH, file);
            
            // Handle duplicate filenames by adding timestamp
            let finalPath = destPath;
            if (fs.existsSync(destPath)) {
              const base = path.basename(file, ext);
              finalPath = path.join(FTP_UPLOAD_PATH, `${base}-retry-${Date.now()}${ext}`);
            }
            
            // Move file back to uploads
            fs.renameSync(filePath, finalPath);
            movedCount++;
            
          } catch (moveError) {
            errorCount++;
            errors.push({
              file,
              error: moveError.message
            });
          }
        }
        
        // Try to remove empty folder
        try {
          const remainingFiles = fs.readdirSync(folderPath);
          if (remainingFiles.length === 0) {
            fs.rmdirSync(folderPath);
          }
        } catch (err) {
          // Ignore folder deletion failures
        }
      }
    }

    log.info(`Retry complete: ${movedCount} files moved, ${deletedErrorLogs} error logs deleted, ${errorCount} errors`);

    // Optionally trigger an import scan
    let scanResults = null;
    if (triggerScan && movedCount > 0) {
      log.info('Triggering import scan after retry');
      scanResults = await scanLocalFolder();
    }

    res.json({
      success: true,
      message: `Moved ${movedCount} files back to uploads for retry`,
      moved: movedCount,
      deletedErrorLogs,
      errors: errorCount,
      errorDetails: errors.length > 0 ? errors.slice(0, 10) : undefined, // Limit error details
      scanResults: scanResults ? {
        scanned: scanResults.scanned,
        queued: scanResults.queued,
        duplicates: scanResults.duplicates,
        errors: scanResults.errors.length
      } : undefined
    });
  } catch (error) {
    console.error('Error retrying failed imports:', error);
    log.error(`Retry failed imports error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * Helper function to reschedule the import job with new frequency
 */
async function rescheduleImportJob(frequencyMinutes, enabled) {
  try {
    // Remove existing local-folder-scan jobs
    const existingJobs = await scheduledTasksQueue.getRepeatableJobs();
    for (const job of existingJobs) {
      if (job.name === 'local-folder-scan') {
        await scheduledTasksQueue.removeRepeatableByKey(job.key);
        console.log('🗑️  Removed existing local-folder-scan job');
      }
    }

    // If disabled, don't add new job
    if (!enabled) {
      console.log('ℹ️  Local folder scan is disabled');
      log.info('Import scheduler disabled');
      return;
    }

    // Calculate cron pattern based on frequency
    let cronPattern;
    if (frequencyMinutes < 60) {
      // Every X minutes
      cronPattern = `*/${frequencyMinutes} * * * *`;
    } else if (frequencyMinutes === 60) {
      // Every hour at minute 0
      cronPattern = '0 * * * *';
    } else if (frequencyMinutes < 1440) {
      // Every X hours
      const hours = frequencyMinutes / 60;
      cronPattern = `0 */${hours} * * *`;
    } else {
      // Daily at midnight
      cronPattern = '0 0 * * *';
    }

    // Add new scheduled job
    await scheduledTasksQueue.add(
      'local-folder-scan',
      { task: 'local-folder-scan' },
      {
        repeat: {
          pattern: cronPattern,
          tz: process.env.TZ || 'UTC'
        },
        removeOnComplete: {
          age: 24 * 3600,
          count: 50
        },
        removeOnFail: {
          age: 7 * 24 * 3600
        }
      }
    );

    const frequencyLabel = frequencyMinutes < 60 ? `every ${frequencyMinutes} minutes` :
                          frequencyMinutes === 60 ? 'hourly' :
                          frequencyMinutes < 1440 ? `every ${frequencyMinutes / 60} hours` : 'daily';

    console.log(`Local folder scan scheduled: ${frequencyLabel} (${cronPattern})`);
    log.success(`Import scheduler updated: ${frequencyLabel}`);
  } catch (error) {
    console.error('Error rescheduling import job:', error);
    log.error(`Failed to reschedule import job: ${error.message}`);
  }
}

/**
 * Reset import statistics
 */
router.post('/reset-statistics', auth, globalAdmin, async (req, res) => {
  try {
    await resetStats();
    
    res.json({
      success: true,
      message: 'Import statistics have been reset'
    });
  } catch (error) {
    console.error('Error resetting import statistics:', error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;

