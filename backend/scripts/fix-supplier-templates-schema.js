/**
 * Fix supplier_templates table schema
 * Adds missing columns that were expected but not present
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Sequelize } = require('sequelize');

const sequelize = new Sequelize(process.env.DATABASE_URL, {
  dialect: 'postgres',
  logging: console.log
});

async function fixSchema() {
  console.log('🔧 Fixing supplier_templates table schema...\n');
  
  const transaction = await sequelize.transaction();
  
  try {
    // Check current columns
    const [columns] = await sequelize.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'supplier_templates'
    `, { transaction });
    
    const existingColumns = columns.map(c => c.column_name);
    console.log('📋 Existing columns:', existingColumns.join(', '));
    
    // Add missing columns
    const columnsToAdd = [
      { name: 'supplierId', sql: 'ALTER TABLE supplier_templates ADD COLUMN IF NOT EXISTS "supplierId" UUID REFERENCES suppliers(id) ON DELETE CASCADE' },
      { name: 'templateType', sql: `ALTER TABLE supplier_templates ADD COLUMN IF NOT EXISTS "templateType" VARCHAR(50) DEFAULT 'invoice' CHECK ("templateType" IN ('invoice', 'credit_note', 'statement'))` },
      { name: 'fileType', sql: `ALTER TABLE supplier_templates ADD COLUMN IF NOT EXISTS "fileType" VARCHAR(20) DEFAULT 'pdf' CHECK ("fileType" IN ('pdf', 'excel'))` },
      { name: 'isDefault', sql: 'ALTER TABLE supplier_templates ADD COLUMN IF NOT EXISTS "isDefault" BOOLEAN DEFAULT false' },
      { name: 'customFields', sql: `ALTER TABLE supplier_templates ADD COLUMN IF NOT EXISTS "customFields" JSONB DEFAULT '[]'` },
      { name: 'mandatoryFields', sql: `ALTER TABLE supplier_templates ADD COLUMN IF NOT EXISTS "mandatoryFields" JSONB DEFAULT '[]'` },
      { name: 'sampleFileUrl', sql: 'ALTER TABLE supplier_templates ADD COLUMN IF NOT EXISTS "sampleFileUrl" VARCHAR(500)' },
      { name: 'deletedAt', sql: 'ALTER TABLE supplier_templates ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP' }
    ];
    
    for (const col of columnsToAdd) {
      if (!existingColumns.includes(col.name)) {
        console.log(`➕ Adding column: ${col.name}`);
        await sequelize.query(col.sql, { transaction });
      } else {
        console.log(`✓ Column already exists: ${col.name}`);
      }
    }
    
    // Create indexes if they don't exist
    console.log('\n📇 Creating indexes...');
    
    const indexes = [
      'CREATE INDEX IF NOT EXISTS supplier_templates_supplierId_idx ON supplier_templates("supplierId")',
      'CREATE INDEX IF NOT EXISTS supplier_templates_templateType_idx ON supplier_templates("templateType")',
      'CREATE INDEX IF NOT EXISTS supplier_templates_fileType_idx ON supplier_templates("fileType")',
      'CREATE INDEX IF NOT EXISTS supplier_templates_isDefault_idx ON supplier_templates("isDefault")',
      'CREATE INDEX IF NOT EXISTS supplier_templates_deletedAt_idx ON supplier_templates("deletedAt") WHERE "deletedAt" IS NULL'
    ];
    
    for (const idx of indexes) {
      try {
        await sequelize.query(idx, { transaction });
        console.log(`✓ Index created/verified`);
      } catch (e) {
        console.log(`  (index might already exist: ${e.message})`);
      }
    }
    
    await transaction.commit();
    
    console.log('\n✅ Schema fix complete!');
    
    // Verify the new schema
    const [newColumns] = await sequelize.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'supplier_templates'
      ORDER BY ordinal_position
    `);
    
    console.log('\n📋 Updated table schema:');
    newColumns.forEach(c => {
      console.log(`   ${c.column_name}: ${c.data_type} ${c.is_nullable === 'NO' ? 'NOT NULL' : ''}`);
    });
    
  } catch (error) {
    await transaction.rollback();
    console.error('❌ Error fixing schema:', error.message);
    throw error;
  } finally {
    await sequelize.close();
  }
}

fixSchema()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
