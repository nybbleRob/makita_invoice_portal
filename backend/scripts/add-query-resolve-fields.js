/**
 * Migration Script: Add resolve fields to document_queries table
 * Adds resolvedAt, resolvedBy, and resolutionReason columns
 */

const { sequelize } = require('../models');

async function addQueryResolveFields() {
  try {
    console.log('🔄 Adding resolve fields to document_queries table...');
    
    // Check if resolvedAt column already exists
    const [resolvedAtCheck] = await sequelize.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'document_queries' 
      AND column_name = 'resolvedAt'
    `);
    
    if (resolvedAtCheck.length === 0) {
      // Add resolvedAt column
      await sequelize.query(`
        ALTER TABLE document_queries 
        ADD COLUMN "resolvedAt" TIMESTAMP
      `);
      
      await sequelize.query(`
        COMMENT ON COLUMN document_queries."resolvedAt" IS 'Timestamp when the query was resolved'
      `);
      
      console.log('✅ Successfully added resolvedAt column!');
    } else {
      console.log('✅ resolvedAt column already exists, skipping...');
    }
    
    // Check if resolvedBy column already exists
    const [resolvedByCheck] = await sequelize.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'document_queries' 
      AND column_name = 'resolvedBy'
    `);
    
    if (resolvedByCheck.length === 0) {
      // Add resolvedBy column
      await sequelize.query(`
        ALTER TABLE document_queries 
        ADD COLUMN "resolvedBy" UUID
      `);
      
      await sequelize.query(`
        COMMENT ON COLUMN document_queries."resolvedBy" IS 'User ID who resolved the query (admin/global_admin only)'
      `);
      
      // Add foreign key constraint
      await sequelize.query(`
        ALTER TABLE document_queries
        ADD CONSTRAINT "document_queries_resolvedBy_fkey"
        FOREIGN KEY ("resolvedBy") REFERENCES "users"("id") ON DELETE SET NULL
      `);
      
      console.log('✅ Successfully added resolvedBy column!');
    } else {
      console.log('✅ resolvedBy column already exists, skipping...');
    }
    
    // Check if resolutionReason column already exists
    const [resolutionReasonCheck] = await sequelize.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'document_queries' 
      AND column_name = 'resolutionReason'
    `);
    
    if (resolutionReasonCheck.length === 0) {
      // Add resolutionReason column
      await sequelize.query(`
        ALTER TABLE document_queries 
        ADD COLUMN "resolutionReason" TEXT
      `);
      
      await sequelize.query(`
        COMMENT ON COLUMN document_queries."resolutionReason" IS 'Reason provided when resolving the query'
      `);
      
      console.log('✅ Successfully added resolutionReason column!');
    } else {
      console.log('✅ resolutionReason column already exists, skipping...');
    }
    
  } catch (error) {
    console.error('❌ Error adding columns:', error);
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  sequelize.authenticate()
    .then(() => {
      console.log('📦 Database connection established');
      return addQueryResolveFields();
    })
    .then(() => {
      console.log('✅ Migration complete');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Migration failed:', error);
      process.exit(1);
    });
}

module.exports = { addQueryResolveFields };

