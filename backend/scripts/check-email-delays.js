#!/usr/bin/env node

/**
 * Email Delay Diagnostic Script
 * Analyzes email send times and delays to identify SMTP server issues
 * 
 * Usage:
 *   node backend/scripts/check-email-delays.js
 *   node backend/scripts/check-email-delays.js --hours 24
 *   node backend/scripts/check-email-delays.js --limit 100
 */

// Load environment variables first
const path = require('path');
const fs = require('fs');
const rootEnv = path.join(__dirname, '..', '..', '.env');
const backendEnv = path.join(__dirname, '..', '.env');

if (fs.existsSync(rootEnv)) {
  require('dotenv').config({ path: rootEnv });
} else if (fs.existsSync(backendEnv)) {
  require('dotenv').config({ path: backendEnv });
} else {
  require('dotenv').config();
}

const { EmailLog, sequelize } = require('../models');
const { Op } = require('sequelize');

// Parse command line arguments
const args = process.argv.slice(2);
const getArg = (flag, defaultValue) => {
  const index = args.indexOf(flag);
  return index !== -1 && args[index + 1] ? args[index + 1] : defaultValue;
};

const hours = parseInt(getArg('--hours', '24'));
const limit = parseInt(getArg('--limit', '100'));

// Calculate time window
const endTime = new Date();
const startTime = new Date(endTime.getTime() - (hours * 60 * 60 * 1000));

console.log('='.repeat(80));
console.log('EMAIL DELAY DIAGNOSTIC REPORT');
console.log('='.repeat(80));
console.log(`Time Window: Last ${hours} hours`);
console.log(`Start Time: ${startTime.toISOString()}`);
console.log(`End Time: ${endTime.toISOString()}`);
console.log('');

async function checkEmailDelays() {
  try {
    // Get all emails in time window
    const emails = await EmailLog.findAll({
      where: {
        createdAt: {
          [Op.gte]: startTime
        }
      },
      order: [['createdAt', 'DESC']],
      limit: limit
    });

    console.log(`Total emails found: ${emails.length}`);
    console.log('');

    if (emails.length === 0) {
      console.log('No emails found in the specified time window.');
      return;
    }

    // Group by status
    const statusCounts = {};
    emails.forEach(email => {
      statusCounts[email.status] = (statusCounts[email.status] || 0) + 1;
    });

    console.log('1. EMAIL STATUS BREAKDOWN');
    console.log('-'.repeat(80));
    Object.entries(statusCounts).forEach(([status, count]) => {
      console.log(`  ${status}: ${count}`);
    });
    console.log('');

    // Group by provider
    const providerCounts = {};
    const providerDelays = {};
    emails.forEach(email => {
      const provider = email.provider || 'unknown';
      providerCounts[provider] = (providerCounts[provider] || 0) + 1;
      
      if (email.status === 'SENT' && email.createdAt && email.sentAt) {
        const delay = new Date(email.sentAt) - new Date(email.createdAt);
        if (!providerDelays[provider]) {
          providerDelays[provider] = [];
        }
        providerDelays[provider].push(delay);
      }
    });

    console.log('2. EMAILS BY PROVIDER');
    console.log('-'.repeat(80));
    Object.entries(providerCounts).forEach(([provider, count]) => {
      console.log(`  ${provider}: ${count} emails`);
    });
    console.log('');

    // Calculate delays for sent emails
    const sentEmails = emails.filter(e => e.status === 'SENT' && e.sentAt);
    const delays = sentEmails.map(email => {
      const queuedAt = new Date(email.createdAt);
      const sentAt = new Date(email.sentAt);
      return {
        email,
        delayMs: sentAt - queuedAt,
        queuedAt,
        sentAt
      };
    });

    if (delays.length > 0) {
      delays.sort((a, b) => b.delayMs - a.delayMs); // Sort by delay descending

      const totalDelay = delays.reduce((sum, d) => sum + d.delayMs, 0);
      const avgDelay = totalDelay / delays.length;
      const minDelay = Math.min(...delays.map(d => d.delayMs));
      const maxDelay = Math.max(...delays.map(d => d.delayMs));

      // Calculate percentiles
      const sortedDelays = delays.map(d => d.delayMs).sort((a, b) => a - b);
      const p50 = sortedDelays[Math.floor(sortedDelays.length * 0.5)];
      const p95 = sortedDelays[Math.floor(sortedDelays.length * 0.95)];
      const p99 = sortedDelays[Math.floor(sortedDelays.length * 0.99)];

      console.log('3. EMAIL SEND DELAYS (SENT EMAILS ONLY)');
      console.log('-'.repeat(80));
      console.log(`  Total sent emails analyzed: ${delays.length}`);
      console.log(`  Average delay: ${formatDelay(avgDelay)}`);
      console.log(`  Minimum delay: ${formatDelay(minDelay)}`);
      console.log(`  Maximum delay: ${formatDelay(maxDelay)}`);
      console.log(`  50th percentile (median): ${formatDelay(p50)}`);
      console.log(`  95th percentile: ${formatDelay(p95)}`);
      console.log(`  99th percentile: ${formatDelay(p99)}`);
      console.log('');

      // Delays by provider
      console.log('4. DELAYS BY PROVIDER');
      console.log('-'.repeat(80));
      Object.entries(providerDelays).forEach(([provider, providerDelayList]) => {
        if (providerDelayList.length > 0) {
          const providerAvg = providerDelayList.reduce((a, b) => a + b, 0) / providerDelayList.length;
          const providerMin = Math.min(...providerDelayList);
          const providerMax = Math.max(...providerDelayList);
          console.log(`  ${provider}:`);
          console.log(`    Count: ${providerDelayList.length}`);
          console.log(`    Average: ${formatDelay(providerAvg)}`);
          console.log(`    Min: ${formatDelay(providerMin)}`);
          console.log(`    Max: ${formatDelay(providerMax)}`);
        }
      });
      console.log('');

      // Show slowest emails
      console.log('5. SLOWEST EMAILS (Top 20)');
      console.log('-'.repeat(80));
      delays.slice(0, 20).forEach((delay, idx) => {
        const email = delay.email;
        console.log(`  ${idx + 1}. Delay: ${formatDelay(delay.delayMs)}`);
        console.log(`     Queued: ${delay.queuedAt.toISOString()}`);
        console.log(`     Sent: ${delay.sentAt.toISOString()}`);
        console.log(`     To: ${email.to || 'N/A'}`);
        console.log(`     Provider: ${email.provider || 'N/A'}`);
        console.log(`     Subject: ${email.subject ? email.subject.substring(0, 60) : 'N/A'}${email.subject && email.subject.length > 60 ? '...' : ''}`);
        console.log(`     Message ID: ${email.messageId || 'N/A'}`);
        console.log('');
      });

      // Show fastest emails
      const fastestDelays = [...delays].sort((a, b) => a.delayMs - b.delayMs);
      console.log('6. FASTEST EMAILS (Top 10)');
      console.log('-'.repeat(80));
      fastestDelays.slice(0, 10).forEach((delay, idx) => {
        const email = delay.email;
        console.log(`  ${idx + 1}. Delay: ${formatDelay(delay.delayMs)}`);
        console.log(`     Queued: ${delay.queuedAt.toISOString()}`);
        console.log(`     Sent: ${delay.sentAt.toISOString()}`);
        console.log(`     To: ${email.to || 'N/A'}`);
        console.log(`     Provider: ${email.provider || 'N/A'}`);
        console.log('');
      });

      // Analyze delays by time period
      console.log('7. DELAYS BY TIME PERIOD');
      console.log('-'.repeat(80));
      const timeBuckets = {
        '0-1s': 0,
        '1-5s': 0,
        '5-10s': 0,
        '10-30s': 0,
        '30s-1m': 0,
        '1-5m': 0,
        '5-10m': 0,
        '10m+': 0
      };

      delays.forEach(d => {
        const delaySeconds = d.delayMs / 1000;
        if (delaySeconds < 1) timeBuckets['0-1s']++;
        else if (delaySeconds < 5) timeBuckets['1-5s']++;
        else if (delaySeconds < 10) timeBuckets['5-10s']++;
        else if (delaySeconds < 30) timeBuckets['10-30s']++;
        else if (delaySeconds < 60) timeBuckets['30s-1m']++;
        else if (delaySeconds < 300) timeBuckets['1-5m']++;
        else if (delaySeconds < 600) timeBuckets['5-10m']++;
        else timeBuckets['10m+']++;
      });

      Object.entries(timeBuckets).forEach(([bucket, count]) => {
        if (count > 0) {
          const percentage = ((count / delays.length) * 100).toFixed(1);
          console.log(`  ${bucket}: ${count} emails (${percentage}%)`);
        }
      });
      console.log('');

      // Check for stuck emails (queued but not sent)
      const stuckEmails = emails.filter(e => 
        (e.status === 'QUEUED' || e.status === 'SENDING' || e.status === 'DEFERRED') &&
        e.createdAt &&
        (new Date() - new Date(e.createdAt)) > 60000 // More than 1 minute old
      );

      if (stuckEmails.length > 0) {
        console.log('8. POTENTIALLY STUCK EMAILS (Queued/Sending/Deferred > 1 minute)');
        console.log('-'.repeat(80));
        console.log(`  Found ${stuckEmails.length} emails that may be stuck:`);
        stuckEmails.slice(0, 10).forEach((email, idx) => {
          const age = new Date() - new Date(email.createdAt);
          console.log(`  ${idx + 1}. Status: ${email.status}, Age: ${formatDelay(age)}`);
          console.log(`     To: ${email.to || 'N/A'}`);
          console.log(`     Provider: ${email.provider || 'N/A'}`);
          console.log(`     Created: ${new Date(email.createdAt).toISOString()}`);
          if (email.lastError) {
            console.log(`     Error: ${email.lastError.substring(0, 100)}`);
          }
          console.log('');
        });
        if (stuckEmails.length > 10) {
          console.log(`  ... and ${stuckEmails.length - 10} more stuck emails`);
        }
      }
    } else {
      console.log('3. NO SENT EMAILS FOUND');
      console.log('-'.repeat(80));
      console.log('  No emails with SENT status found in the time window.');
      console.log('  This could indicate:');
      console.log('    - Emails are still queued/processing');
      console.log('    - All emails failed');
      console.log('    - Time window is too narrow');
    }

    console.log('');
    console.log('='.repeat(80));
    console.log('Report completed');
    console.log('='.repeat(80));

  } catch (error) {
    console.error('\n❌ Error:', error);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

function formatDelay(ms) {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  } else if (ms < 60000) {
    return `${(ms / 1000).toFixed(2)}s`;
  } else {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  }
}

// Run the check
checkEmailDelays();
