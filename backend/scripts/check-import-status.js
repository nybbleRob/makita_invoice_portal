#!/usr/bin/env node

/**
 * Import Status Diagnostic Script
 * Checks import status, imported files, and email notifications for a specific time window
 * 
 * Usage:
 *   node backend/scripts/check-import-status.js
 *   node backend/scripts/check-import-status.js --date 2025-01-11 --start 12:00 --end 12:30
 *   node backend/scripts/check-import-status.js --date 2025-01-11 --start 12:00 --end 12:30 --timezone UTC
 */

// Load environment variables first
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const { File, Invoice, CreditNote, Statement, Company, EmailLog, sequelize } = require('../models');
const { Op } = require('sequelize');
const { getActivityLogs, ActivityType } = require('../services/activityLogger');
const { redis } = require('../config/redis');
const importStore = require('../utils/importStore');

// Parse command line arguments
const args = process.argv.slice(2);
const getArg = (flag, defaultValue) => {
  const index = args.indexOf(flag);
  return index !== -1 && args[index + 1] ? args[index + 1] : defaultValue;
};

const dateStr = getArg('--date', new Date().toISOString().split('T')[0]);
const startTimeStr = getArg('--start', '12:00');
const endTimeStr = getArg('--end', '12:30');
const timezone = getArg('--timezone', 'UTC');

// Parse date and time
function parseDateTime(dateStr, timeStr, timezone) {
  const [hours, minutes] = timeStr.split(':').map(Number);
  const date = new Date(`${dateStr}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`);
  
  // Adjust for timezone if needed (simplified - assumes server timezone)
  return date;
}

const startTime = parseDateTime(dateStr, startTimeStr, timezone);
const endTime = parseDateTime(dateStr, endTimeStr, timezone);

// Extend email check window to 1 hour after import end (emails may be queued)
const emailCheckEndTime = new Date(endTime.getTime() + 60 * 60 * 1000);

console.log('='.repeat(80));
console.log('IMPORT STATUS DIAGNOSTIC REPORT');
console.log('='.repeat(80));
console.log(`Date: ${dateStr}`);
console.log(`Time Window: ${startTimeStr} - ${endTimeStr}`);
console.log(`Start Time: ${startTime.toISOString()}`);
console.log(`End Time: ${endTime.toISOString()}`);
console.log(`Email Check End: ${emailCheckEndTime.toISOString()}`);
console.log('');

async function checkImportStatus() {
  try {
    console.log('📊 Querying database...\n');

    // 1. Query files uploaded in time window
    console.log('1. FILES UPLOADED IN TIME WINDOW');
    console.log('-'.repeat(80));
    const files = await File.findAll({
      where: {
        uploadedAt: {
          [Op.between]: [startTime, endTime]
        },
        deletedAt: null
      },
      order: [['uploadedAt', 'ASC']]
    });

    console.log(`Total files uploaded: ${files.length}`);
    
    // Group by status
    const statusCounts = {};
    const customerIdCounts = {};
    files.forEach(file => {
      statusCounts[file.status] = (statusCounts[file.status] || 0) + 1;
      if (file.customerId) {
        customerIdCounts[file.customerId] = (customerIdCounts[file.customerId] || 0) + 1;
      }
    });

    console.log('\nFiles by status:');
    Object.entries(statusCounts).forEach(([status, count]) => {
      console.log(`  ${status}: ${count}`);
    });

    // Get company info from documents created from these files
    // Documents store fileId in metadata JSONB field
    const fileIds = files.map(f => f.id);
    const fileIdConditions = fileIds.map(fileId => ({
      'metadata.fileId': fileId
    }));
    
    const [invoicesFromFiles, creditNotesFromFiles, statementsFromFiles] = await Promise.all([
      fileIds.length > 0 ? Invoice.findAll({
        where: {
          [Op.or]: fileIdConditions,
          deletedAt: null
        },
        include: [{
          model: Company,
          as: 'company',
          attributes: ['id', 'name', 'referenceNo'],
          required: false
        }]
      }) : [],
      fileIds.length > 0 ? CreditNote.findAll({
        where: {
          [Op.or]: fileIdConditions
        },
        include: [{
          model: Company,
          as: 'company',
          attributes: ['id', 'name', 'referenceNo'],
          required: false
        }]
      }) : [],
      fileIds.length > 0 ? Statement.findAll({
        where: {
          [Op.or]: fileIdConditions
        },
        include: [{
          model: Company,
          as: 'company',
          attributes: ['id', 'name', 'referenceNo'],
          required: false
        }]
      }) : []
    ]);

    const allDocuments = [...invoicesFromFiles, ...creditNotesFromFiles, ...statementsFromFiles];
    const companyCounts = {};
    allDocuments.forEach(doc => {
      if (doc.companyId && doc.company) {
        const companyId = doc.companyId;
        companyCounts[companyId] = companyCounts[companyId] || { count: 0, name: doc.company.name, referenceNo: doc.company.referenceNo };
        companyCounts[companyId].count++;
      }
    });

    console.log(`\nFiles assigned to companies (via documents): ${Object.keys(companyCounts).length} companies`);
    if (Object.keys(companyCounts).length > 0) {
      console.log('Top companies by document count:');
      const sortedCompanies = Object.entries(companyCounts)
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 10);
      for (const [companyId, data] of sortedCompanies) {
        console.log(`  ${data.name} (${data.referenceNo}): ${data.count} documents`);
      }
    }

    // 2. Query activity logs for imports
    console.log('\n\n2. IMPORT ACTIVITY LOGS');
    console.log('-'.repeat(80));
    const activityLogs = await getActivityLogs({
      type: [ActivityType.FILE_IMPORT, ActivityType.FILE_IMPORT_FAILED],
      startDate: startTime.toISOString(),
      endDate: endTime.toISOString(),
      limit: 1000
    });

    console.log(`Total import activity log entries: ${activityLogs.logs?.length || 0}`);
    
    if (activityLogs.logs && activityLogs.logs.length > 0) {
      const successful = activityLogs.logs.filter(log => log.type === ActivityType.FILE_IMPORT).length;
      const failed = activityLogs.logs.filter(log => log.type === ActivityType.FILE_IMPORT_FAILED).length;
      
      console.log(`  Successful imports: ${successful}`);
      console.log(`  Failed imports: ${failed}`);

      // Extract unique import IDs
      const importIds = new Set();
      activityLogs.logs.forEach(log => {
        if (log.details?.importId) {
          importIds.add(log.details.importId);
        }
      });

      console.log(`\nUnique import sessions: ${importIds.size}`);
      
      // Check Redis for import sessions
      if (importIds.size > 0 && redis && redis.status === 'ready') {
        console.log('\nChecking import sessions in Redis...');
        for (const importId of Array.from(importIds).slice(0, 5)) { // Check first 5
          try {
            const importSession = await importStore.getImport(importId);
            if (importSession) {
              console.log(`\n  Import ID: ${importId}`);
              console.log(`    Status: ${importSession.status}`);
              console.log(`    Total files: ${importSession.totalFiles}`);
              console.log(`    Processed: ${importSession.processedFiles || 0}`);
              console.log(`    Created: ${importSession.createdAt}`);
              console.log(`    Completed: ${importSession.completedAt || 'Not completed'}`);
              
              if (importSession.results) {
                const successfulResults = importSession.results.filter(r => r.success).length;
                const failedResults = importSession.results.filter(r => !r.success).length;
                const matchedResults = importSession.results.filter(r => r.companyId).length;
                console.log(`    Results: ${successfulResults} successful, ${failedResults} failed, ${matchedResults} matched`);
              }
            } else {
              console.log(`  Import ID: ${importId} - Session not found in Redis (may have expired)`);
            }
          } catch (err) {
            console.log(`  Import ID: ${importId} - Error checking: ${err.message}`);
          }
        }
      }
    }

    // 3. Query documents created in time window
    console.log('\n\n3. DOCUMENTS CREATED');
    console.log('-'.repeat(80));
    
    const [invoices, creditNotes, statements] = await Promise.all([
      Invoice.count({
        where: {
          createdAt: {
            [Op.between]: [startTime, endTime]
          }
        }
      }),
      CreditNote.count({
        where: {
          createdAt: {
            [Op.between]: [startTime, endTime]
          }
        }
      }),
      Statement.count({
        where: {
          createdAt: {
            [Op.between]: [startTime, endTime]
          }
        }
      })
    ]);

    console.log(`Invoices created: ${invoices}`);
    console.log(`Credit Notes created: ${creditNotes}`);
    console.log(`Statements created: ${statements}`);
    console.log(`Total documents: ${invoices + creditNotes + statements}`);

    // 4. Query email logs
    console.log('\n\n4. EMAIL NOTIFICATIONS');
    console.log('-'.repeat(80));
    
    const emailLogs = await EmailLog.findAll({
      where: {
        sentAt: {
          [Op.between]: [startTime, emailCheckEndTime]
        }
      },
      order: [['sentAt', 'ASC']],
      limit: 1000
    });

    console.log(`Total emails sent: ${emailLogs.length}`);
    
    if (emailLogs.length > 0) {
      const successful = emailLogs.filter(e => e.status === 'sent').length;
      const failed = emailLogs.filter(e => e.status === 'failed').length;
      const queued = emailLogs.filter(e => e.status === 'queued').length;
      
      console.log(`  Successful: ${successful}`);
      console.log(`  Failed: ${failed}`);
      console.log(`  Queued: ${queued}`);

      // Group by recipient count (batch emails)
      const batchEmails = emailLogs.filter(e => e.recipientCount > 1);
      const singleEmails = emailLogs.filter(e => e.recipientCount === 1);
      
      console.log(`\n  Batch emails (multiple recipients): ${batchEmails.length}`);
      console.log(`  Single recipient emails: ${singleEmails.length}`);
      
      if (batchEmails.length > 0) {
        const totalRecipients = batchEmails.reduce((sum, e) => sum + (e.recipientCount || 1), 0);
        console.log(`  Total recipients in batch emails: ${totalRecipients}`);
      }

      // Show first few emails
      console.log('\n  First 10 emails:');
      emailLogs.slice(0, 10).forEach(email => {
        const sentAt = email.sentAt ? new Date(email.sentAt).toISOString() : 'Not sent';
        console.log(`    ${sentAt} - ${email.recipientEmail || email.recipient} - ${email.status} (${email.recipientCount || 1} recipient(s))`);
      });
    } else {
      console.log('  No emails found in time window');
    }

    // 5. Summary
    console.log('\n\n5. SUMMARY');
    console.log('-'.repeat(80));
    console.log(`Files uploaded: ${files.length}`);
    console.log(`  - Parsed/Assigned: ${statusCounts['parsed'] || 0}`);
    console.log(`  - Unallocated: ${statusCounts['unallocated'] || 0}`);
    console.log(`  - Failed: ${statusCounts['failed'] || 0}`);
    console.log(`  - Pending: ${statusCounts['pending'] || 0}`);
    console.log(`Documents created: ${invoices + creditNotes + statements}`);
    console.log(`Emails sent: ${emailLogs.filter(e => e.status === 'sent').length}`);

    // Check for discrepancies
    console.log('\n6. DISCREPANCIES CHECK');
    console.log('-'.repeat(80));
    
    if (files.length === 0) {
      console.log('⚠️  WARNING: No files found in time window. Check:');
      console.log('    - Time zone settings');
      console.log('    - Upload method (FTP, local folder, manual)');
      console.log('    - File retention/deletion');
    }

    if (files.length > 0 && (invoices + creditNotes + statements) === 0) {
      console.log('⚠️  WARNING: Files uploaded but no documents created. Files may be:');
      console.log('    - Still processing');
      console.log('    - Unallocated (no matching company)');
      console.log('    - Failed parsing');
    }

    if (files.length > 0 && emailLogs.length === 0) {
      console.log('⚠️  WARNING: Files uploaded but no emails sent. Check:');
      console.log('    - Email notifications may be disabled');
      console.log('    - Emails may be queued (check queue status)');
      console.log('    - Email sending may have failed');
    }

    const expectedFiles = 132;
    if (files.length !== expectedFiles) {
      console.log(`\n⚠️  NOTE: Expected ${expectedFiles} files, found ${files.length}`);
      console.log('    This may be normal if:');
      console.log('    - Files were uploaded in multiple batches');
      console.log('    - Some files were duplicates and skipped');
      console.log('    - Time window needs adjustment');
    }

    console.log('\n' + '='.repeat(80));
    console.log('Report completed');
    console.log('='.repeat(80));

  } catch (error) {
    console.error('\n❌ Error generating report:', error);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await sequelize.close();
    if (redis) {
      await redis.quit();
    }
  }
}

// Run the check
checkImportStatus();
