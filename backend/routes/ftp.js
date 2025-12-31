const express = require('express');
const { Settings } = require('../models');
const { testConnection, downloadFile, listFiles } = require('../utils/ftp');
const { fileImportQueue } = require('../config/queue');
const globalAdmin = require('../middleware/globalAdmin');
const router = express.Router();

/**
 * Test FTP/SFTP connection
 */
router.post('/test-connection', globalAdmin, async (req, res) => {
  try {
    const settings = await Settings.getSettings();
    
    if (!settings.ftp || !settings.ftp.enabled) {
      return res.status(400).json({ 
        success: false,
        message: 'FTP is not enabled. Please enable and configure FTP settings first.' 
      });
    }
    
    const result = await testConnection(settings.ftp);
    
    if (result.success) {
      res.json({
        success: true,
        message: result.message,
        fileCount: result.fileCount
      });
    } else {
      // Include suggestion if available
      const response = {
        success: false,
        message: result.message,
        error: result.error
      };
      
      if (result.suggestion) {
        response.suggestion = result.suggestion;
      }
      
      res.status(400).json(response);
    }
  } catch (error) {
    console.error('FTP test connection error:', error);
    
    // Try to provide user-friendly error message even for unexpected errors
    const errorMessage = error.message || 'Unknown error';
    
    // Check if it's a TLS/SSL error even in catch block
    if (errorMessage.includes('SSL routines') || 
        errorMessage.includes('TLS') || 
        errorMessage.includes('wrong version number') ||
        errorMessage.includes('tls_validate_record_header')) {
      return res.status(400).json({
        success: false,
        message: 'FTP server does not support TLS/SSL encryption. Please disable "Use FTPS (FTP over TLS)" in your FTP settings and try again.',
        error: errorMessage,
        suggestion: 'Try connecting without TLS/SSL enabled.'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Error testing FTP connection: ' + errorMessage
    });
  }
});

/**
 * Test import - downloads a test file from FTP
 */
router.post('/test-import', globalAdmin, async (req, res) => {
  try {
    const settings = await Settings.getSettings();
    
    if (!settings.ftp || !settings.ftp.enabled) {
      return res.status(400).json({ 
        success: false,
        message: 'FTP is not enabled. Please enable and configure FTP settings first.' 
      });
    }
    
    const testFileName = settings.ftp.testFileName || req.body.testFileName;
    
    if (!testFileName) {
      return res.status(400).json({
        success: false,
        message: 'Test file name is required. Please specify a file name in FTP settings or request body.'
      });
    }
    
    // Test connection first
    const connectionTest = await testConnection(settings.ftp);
    if (!connectionTest.success) {
      return res.status(400).json({
        success: false,
        message: 'FTP connection failed: ' + connectionTest.message
      });
    }
    
    // List files to find the test file
    const files = await listFiles(settings.ftp);
    const testFile = files.find(f => f.name === testFileName || f.name.toLowerCase() === testFileName.toLowerCase());
    
    if (!testFile) {
      return res.status(404).json({
        success: false,
        message: `Test file "${testFileName}" not found on FTP server. Available PDF files: ${files.map(f => f.name).join(', ') || 'none'}`
      });
    }
    
    // Add job to queue (BullMQ format: name, data, options)
    const job = await fileImportQueue.add('file-import', {
      fileName: testFile.name,
      remotePath: testFile.name,
      ftpConfig: settings.ftp
    }, {
      jobId: `test-import-${Date.now()}`,
      priority: 1 // Higher priority for test imports
    });
    
    res.json({
      success: true,
      message: `Test import job queued successfully. File: ${testFile.name}`,
      jobId: job.id,
      fileName: testFile.name,
      fileSize: testFile.size
    });
  } catch (error) {
    console.error('FTP test import error:', error);
    res.status(500).json({
      success: false,
      message: 'Error queuing test import: ' + error.message
    });
  }
});

/**
 * Get queue status
 */
router.get('/queue/status', globalAdmin, async (req, res) => {
  try {
    // BullMQ uses getJobs with state names
    const [waiting, active, completed, failed] = await Promise.all([
      fileImportQueue.getJobs(['waiting', 'wait'], 0, 100),
      fileImportQueue.getJobs(['active'], 0, 100),
      fileImportQueue.getJobs(['completed'], 0, 9), // Last 10 completed
      fileImportQueue.getJobs(['failed'], 0, 9) // Last 10 failed
    ]);
    
    res.json({
      waiting: (waiting || []).length,
      active: (active || []).length,
      completed: (completed || []).length,
      failed: (failed || []).length,
      recentCompleted: (completed || []).filter(job => job).map(job => ({
        id: job.id,
        fileName: job.data?.fileName || 'Unknown',
        completedAt: job.finishedOn ? new Date(job.finishedOn) : null
      })),
      recentFailed: (failed || []).filter(job => job).map(job => ({
        id: job.id,
        fileName: job.data?.fileName || 'Unknown',
        failedAt: job.finishedOn ? new Date(job.finishedOn) : null,
        error: job.failedReason
      }))
    });
  } catch (error) {
    console.error('Queue status error:', error);
    res.status(500).json({
      success: false,
      message: 'Error getting queue status: ' + error.message
    });
  }
});

/**
 * Manually trigger FTP folder scan
 */
router.post('/scan', globalAdmin, async (req, res) => {
  try {
    const { scanFTPFolders } = require('../jobs/ftpScanner');
    const result = await scanFTPFolders();
    
    res.json({
      success: true,
      message: `FTP scan completed: ${result.scanned} files scanned, ${result.queued} new files queued`,
      ...result
    });
  } catch (error) {
    console.error('FTP scan error:', error);
    res.status(500).json({
      success: false,
      message: 'Error scanning FTP folders: ' + error.message
    });
  }
});

module.exports = router;

