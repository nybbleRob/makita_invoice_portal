/**
 * Test script to check if activity logs are being stored in Redis
 */

require('dotenv').config();
const { redis } = require('../config/redis');
const { logActivity, ActivityType, getActivityLogs } = require('../services/activityLogger');

async function test() {
  try {
    console.log('🔄 Testing activity logging...\n');
    
    // Wait for Redis to be ready
    if (redis) {
      await redis.ping();
      console.log('✅ Redis is connected\n');
    } else {
      console.log('❌ Redis is not configured\n');
      return;
    }
    
    // Test 1: Check existing logs
    console.log('📊 Checking existing logs...');
    const indexKeys = await redis.zrange('activity:index', 0, -1);
    console.log(`   Found ${indexKeys.length} log entries in index\n`);
    
    if (indexKeys.length > 0) {
      console.log('   Sample log IDs:', indexKeys.slice(0, 5));
      const sampleId = indexKeys[0];
      const logData = await redis.hgetall(`activity:logs:${sampleId}`);
      console.log('   Sample log data:', logData);
      console.log('');
    }
    
    // Test 2: Create a test log entry
    console.log('📝 Creating test log entry...');
    const testLog = await logActivity({
      type: ActivityType.INVOICE_DOWNLOADED,
      userId: 'test-user-id',
      userEmail: 'test@example.com',
      userRole: 'administrator',
      action: 'Test download activity',
      details: { test: true, timestamp: new Date().toISOString() },
      companyId: 'test-company-id',
      companyName: 'Test Company',
      ipAddress: '127.0.0.1',
      userAgent: 'Test Script'
    });
    
    if (testLog) {
      console.log('   ✅ Test log created:', testLog.id);
      console.log('');
    } else {
      console.log('   ❌ Failed to create test log');
      console.log('');
    }
    
    // Test 3: Retrieve logs
    console.log('📖 Retrieving logs...');
    const result = await getActivityLogs({ page: 1, limit: 10 });
    console.log(`   Retrieved ${result.logs.length} logs`);
    console.log(`   Total: ${result.pagination.total}`);
    console.log('');
    
    if (result.logs.length > 0) {
      console.log('   Sample log entry:');
      console.log(JSON.stringify(result.logs[0], null, 2));
    }
    
    // Test 4: Check all activity keys
    console.log('\n🔍 Checking all activity keys in Redis...');
    const allKeys = await redis.keys('activity:*');
    console.log(`   Found ${allKeys.length} keys with prefix 'activity:'`);
    if (allKeys.length > 0) {
      console.log('   Keys:', allKeys.slice(0, 10));
    }
    
    console.log('\n✅ Test complete!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

test();

