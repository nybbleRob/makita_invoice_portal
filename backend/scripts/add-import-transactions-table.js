/**
 * Migration script to create import_transactions table
 * Tracks import operations for UNDO functionality
 */

const { sequelize } = require('../config/database');

async function addImportTransactionsTable() {
  const transaction = await sequelize.transaction();
  
  try {
    console.log('🔄 Creating import_transactions table...');
    
    // Create ENUM type for import transaction type
    console.log('📝 Creating ENUM type for import transaction type...');
    await sequelize.query(`
      DO $$ BEGIN
        CREATE TYPE import_transaction_type_enum AS ENUM ('company_import');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `, { transaction });
    
    // Create ENUM type for import transaction status
    console.log('📝 Creating ENUM type for import transaction status...');
    await sequelize.query(`
      DO $$ BEGIN
        CREATE TYPE import_transaction_status_enum AS ENUM ('completed', 'undone');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `, { transaction });
    
    // Create import_transactions table
    console.log('📝 Creating import_transactions table...');
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS import_transactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "userId" UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type import_transaction_type_enum NOT NULL DEFAULT 'company_import',
        "createdCompanies" JSONB DEFAULT '[]'::jsonb,
        "updatedCompanies" JSONB DEFAULT '[]'::jsonb,
        "importData" JSONB DEFAULT '{}'::jsonb,
        status import_transaction_status_enum NOT NULL DEFAULT 'completed',
        "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `, { transaction });
    
    // Create indexes
    console.log('📝 Creating indexes...');
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS "import_transactions_userId_idx" ON import_transactions ("userId");
    `, { transaction });
    
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS "import_transactions_type_idx" ON import_transactions (type);
    `, { transaction });
    
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS "import_transactions_status_idx" ON import_transactions (status);
    `, { transaction });
    
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS "import_transactions_createdAt_idx" ON import_transactions ("createdAt");
    `, { transaction });
    
    await transaction.commit();
    console.log('✅ import_transactions table created successfully!');
    
  } catch (error) {
    await transaction.rollback();
    console.error('❌ Error creating import_transactions table:', error);
    throw error;
  }
}

// Run migration if called directly
if (require.main === module) {
  addImportTransactionsTable()
    .then(() => {
      console.log('✅ Migration completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Migration failed:', error);
      process.exit(1);
    });
}

module.exports = { addImportTransactionsTable };

