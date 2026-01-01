/**
 * Import Settings Routes
 * API endpoints for managing FTP/local import scheduler settings and logs
 */

const express = require('express');
const auth = require('../middleware/auth');
const globalAdmin = require('../middleware/globalAdmin');
const { Settings } = require('../models');
const { getLogs, clearLogs, getStats, getLastRun, log } = require('../services/importLogger');
const { scheduledTasksQueue } = require('../config/queue');
const { scanLocalFolder } = require('../jobs/localFolderScanner');

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

    console.log(`✅ Local folder scan scheduled: ${frequencyLabel} (${cronPattern})`);
    log.success(`Import scheduler updated: ${frequencyLabel}`);
  } catch (error) {
    console.error('Error rescheduling import job:', error);
    log.error(`Failed to reschedule import job: ${error.message}`);
  }
}

module.exports = router;

