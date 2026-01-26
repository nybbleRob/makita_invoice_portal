#!/usr/bin/env node

/**
 * Check Scan Status and FTP Connection
 * 
 * This script checks:
 * 1. If any scans have run today (local folder or FTP)
 * 2. If FTP connection is working
 * 
 * Usage: node backend/scripts/check-scan-status.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { sequelize } = require('../config/database');
const { File } = require('../models');
const { Settings } = require('../models');
const { testConnection } = require('../utils/ftp');
const { Op } = require('sequelize');

async function checkScanStatus() {
  console.log('🔍 Checking Scan Status and FTP Connection...\n');
  
  try {
    // Test database connection
    await sequelize.authenticate();
    console.log('✅ Database connection: OK\n');
    
    // Get today's date range (start of day to now)
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    // Check for files uploaded today
    const filesToday = await File.count({
      where: {
        uploadedAt: {
          [Op.gte]: startOfToday
        }
      }
    });
    
    // Check for files uploaded in the last 24 hours
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const filesLast24h = await File.count({
      where: {
        uploadedAt: {
          [Op.gte]: yesterday
        }
      }
    });
    
    // Get latest file upload
    const latestFile = await File.findOne({
      order: [['uploadedAt', 'DESC']],
      attributes: ['fileName', 'uploadedAt', 'status', 'ftpFolder']
    });
    
    console.log('📊 Scan Results:');
    console.log(`   Files uploaded today: ${filesToday}`);
    console.log(`   Files uploaded in last 24h: ${filesLast24h}`);
    
    if (latestFile) {
      const latestDate = new Date(latestFile.uploadedAt);
      const hoursAgo = (now - latestDate) / (1000 * 60 * 60);
      console.log(`   Latest file: ${latestFile.fileName}`);
      console.log(`   Uploaded: ${latestDate.toISOString()} (${hoursAgo.toFixed(1)} hours ago)`);
      console.log(`   Status: ${latestFile.status}`);
      if (latestFile.ftpFolder) {
        console.log(`   FTP Folder: ${latestFile.ftpFolder}`);
      }
    } else {
      console.log('   No files found in database');
    }
    
    // Check if scans have run today
    if (filesToday > 0) {
      console.log('\n✅ Scans HAVE run today - files were uploaded');
    } else if (filesLast24h > 0) {
      console.log('\n⚠️  No scans today, but files were uploaded in last 24 hours');
    } else {
      console.log('\n❌ No scans detected - no files uploaded today or in last 24 hours');
    }
    
    console.log('\n' + '='.repeat(60) + '\n');
    
    // Test FTP connection
    console.log('🔌 Testing FTP Connection...\n');
    
    try {
      const settings = await Settings.getSettings();
      
      if (!settings.ftp || !settings.ftp.enabled) {
        console.log('ℹ️  FTP is not enabled in settings');
        console.log('   To enable: Go to Settings > FTP Configuration');
      } else {
        const ftpConfig = settings.ftp;
        const connectionType = ftpConfig.type || 'ftp';
        
        console.log(`   Type: ${connectionType.toUpperCase()}`);
        console.log(`   Host: ${ftpConfig.host}`);
        console.log(`   Port: ${ftpConfig.port || (connectionType === 'sftp' ? 22 : 21)}`);
        console.log(`   Username: ${ftpConfig.username}`);
        console.log(`   Directory: ${ftpConfig.directory || '/'}`);
        console.log(`   Single Folder Mode: ${ftpConfig.singleFolderMode ? 'Yes' : 'No'}`);
        console.log('');
        
        const result = await testConnection(ftpConfig);
        
        if (result.success) {
          console.log('✅ FTP Connection: SUCCESS');
          console.log(`   ${result.message}`);
          if (result.fileCount !== undefined) {
            console.log(`   Files found: ${result.fileCount}`);
          }
        } else {
          console.log('❌ FTP Connection: FAILED');
          console.log(`   Error: ${result.message}`);
          if (result.error) {
            console.log(`   Details: ${result.error}`);
          }
          if (result.suggestion) {
            console.log(`   Suggestion: ${result.suggestion}`);
          }
        }
      }
    } catch (error) {
      console.log('❌ FTP Connection Test Error:');
      console.log(`   ${error.message}`);
      if (error.stack) {
        console.log(`   Stack: ${error.stack.split('\n')[1]}`);
      }
    }
    
    console.log('\n' + '='.repeat(60) + '\n');
    
    // Summary
    console.log('📋 Summary:');
    if (filesToday > 0) {
      console.log('   ✅ Scans are working - files uploaded today');
    } else {
      console.log('   ⚠️  No scans detected today');
    }
    
    // Close database connection
    await sequelize.close();
    console.log('\n✅ Check complete');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.stack) {
      console.error('Stack:', error.stack);
    }
    process.exit(1);
  }
}

// Run the check
checkScanStatus()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
