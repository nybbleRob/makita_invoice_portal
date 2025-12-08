require('dotenv').config();
const { sequelize, testConnection } = require('../config/database');

const runTest = async () => {
  console.log('🔍 Testing PostgreSQL Connection...\n');
  console.log('Connection Details:');
  console.log('   Host:', process.env.DB_HOST || 'localhost');
  console.log('   Port:', process.env.DB_PORT || 5432);
  console.log('   Database:', process.env.DB_NAME || 'invoice_portal');
  console.log('   User:', process.env.DB_USER || 'postgres');
  console.log('   Password:', process.env.DB_PASSWORD ? '***SET***' : 'NOT SET');
  console.log('');

  try {
    const connected = await testConnection();
    
    if (connected) {
      console.log('');
      console.log('📊 Database Info:');
      const [results] = await sequelize.query("SELECT version();");
      console.log('   PostgreSQL Version:', results[0]?.version || 'Unknown');
      
      // List tables
      const [tables] = await sequelize.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public'
        ORDER BY table_name;
      `);
      
      console.log('');
      console.log('📁 Tables:', tables.length > 0 ? tables.map(t => t.table_name).join(', ') : 'None (database is empty)');
      console.log('');
      console.log('🎉 Connection test passed!');
      
      await sequelize.close();
      process.exit(0);
    } else {
      console.error('❌ Connection test failed!');
      console.log('');
      console.log('💡 Possible issues:');
      console.log('   1. PostgreSQL is not running');
      console.log('      Fix: sudo service postgresql start (in WSL)');
      console.log('   2. Database does not exist');
      console.log('      Fix: CREATE DATABASE invoice_portal; (in psql)');
      console.log('   3. Wrong password in .env');
      console.log('      Fix: Check DB_PASSWORD matches PostgreSQL password');
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Connection failed!');
    console.error('');
    console.error('Error Details:');
    console.error('   Message:', error.message);
    if (error.original) {
      console.error('   Original:', error.original.message);
    }
    console.log('');
    console.log('💡 Check:');
    console.log('   1. PostgreSQL is running: sudo service postgresql status');
    console.log('   2. Database exists: psql -U postgres -l');
    console.log('   3. .env file has correct DB_PASSWORD');
    await sequelize.close();
    process.exit(1);
  }
};

runTest();

