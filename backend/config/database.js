const { Sequelize } = require('sequelize');
require('dotenv').config();

// PostgreSQL connection
const sequelize = new Sequelize(
  process.env.DB_NAME || 'invoice_portal',
  process.env.DB_USER || 'postgres',
  process.env.DB_PASSWORD || 'postgres',
  {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    dialect: 'postgres',
    logging: process.env.NODE_ENV === 'development' ? console.log : false,
    pool: {
      max: parseInt(process.env.DB_POOL_MAX) || 20, // Configurable, default 20 for production
      min: parseInt(process.env.DB_POOL_MIN) || 2, // Keep minimum connections alive
      acquire: parseInt(process.env.DB_POOL_ACQUIRE) || 60000, // Increased timeout to 60 seconds
      idle: parseInt(process.env.DB_POOL_IDLE) || 10000,
      evict: 1000 // Check for idle connections every second
    },
    // Better error handling for connection issues
    dialectOptions: {
      connectTimeout: 10000, // 10 second connection timeout
      requestTimeout: 30000, // 30 second request timeout
      ...(process.env.DB_SSL === 'true' && {
        ssl: {
          require: true,
          rejectUnauthorized: false
        }
      })
    },
  }
);

// Test connection with retry logic
const testConnection = async (retries = 3) => {
  for (let i = 0; i < retries; i++) {
    try {
      await sequelize.authenticate();
      console.log('✅ PostgreSQL Connected Successfully');
      return true;
    } catch (error) {
      console.error(`❌ PostgreSQL Connection Error (attempt ${i + 1}/${retries}):`, error.message);
      if (i < retries - 1) {
        console.log(`   Retrying in 2 seconds...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      } else {
        console.error('   Host:', process.env.DB_HOST || 'localhost');
        console.error('   Port:', process.env.DB_PORT || 5432);
        console.error('   Database:', process.env.DB_NAME || 'invoice_portal');
        console.error('   User:', process.env.DB_USER || 'postgres');
        console.error('   Password:', process.env.DB_PASSWORD ? '***SET***' : 'NOT SET');
        console.error('   Error Message:', error.message);
        if (error.original) {
          console.error('   Original Error:', error.original.message);
          console.error('   Error Code:', error.original.code);
        }
        // Common error codes and solutions
        if (error.original && error.original.code) {
          const code = error.original.code;
          if (code === 'ECONNREFUSED') {
            console.error('\n   💡 Solution: PostgreSQL service is not running.');
            console.error('      Windows: Open Services (services.msc) and start PostgreSQL service');
            console.error('      Or run: Get-Service | Where-Object {$_.DisplayName -like "*PostgreSQL*"} | Start-Service');
          } else if (code === '28P01') {
            console.error('\n   💡 Solution: Invalid password. Check your .env file DB_PASSWORD');
          } else if (code === '3D000') {
            console.error('\n   💡 Solution: Database does not exist. Create it with: CREATE DATABASE invoice_portal;');
          }
        }
      }
    }
  }
  return false;
};

// Sync database (creates tables if they don't exist)
// Use with caution in production - prefer migrations
const syncDatabase = async (force = false) => {
  try {
    // Import models to ensure they're registered
    require('../models');
    
    // Sync without alter first (creates tables if they don't exist)
    await sequelize.sync({ force: false, alter: false });
    console.log('✅ Database synchronized');
    return true;
  } catch (error) {
    console.error('❌ Database sync error:', error.message);
    if (error.original) {
      console.error('   Original error:', error.original.message);
    }
    return false;
  }
};

module.exports = {
  sequelize,
  Sequelize,
  testConnection,
  syncDatabase
};

