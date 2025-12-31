/**
 * Migration: Add 'ready' status to invoices and credit_notes tables
 * 
 * This script adds 'ready' as a new status option to the status ENUM
 * in both the invoices and credit_notes tables.
 * 
 * Run with: node scripts/add-ready-status-to-invoices.js
 */

const { sequelize } = require('../config/database');

async function addReadyStatus() {
  try {
    console.log('🔄 Adding "ready" status to invoices and credit_notes tables...');
    
    // Add 'ready' to invoices.status ENUM
    await sequelize.query(`
      DO $$ 
      BEGIN
        -- Check if 'ready' already exists in the enum
        IF NOT EXISTS (
          SELECT 1 FROM pg_enum 
          WHERE enumlabel = 'ready' 
          AND enumtypid = (
            SELECT oid FROM pg_type WHERE typname = 'enum_invoices_status'
          )
        ) THEN
          ALTER TYPE enum_invoices_status ADD VALUE 'ready';
          RAISE NOTICE 'Added "ready" to enum_invoices_status';
        ELSE
          RAISE NOTICE '"ready" already exists in enum_invoices_status';
        END IF;
      END $$;
    `);
    
    console.log('✅ Added "ready" to invoices.status enum');
    
    // Add 'ready' to credit_notes.status ENUM
    await sequelize.query(`
      DO $$ 
      BEGIN
        -- Check if 'ready' already exists in the enum
        IF NOT EXISTS (
          SELECT 1 FROM pg_enum 
          WHERE enumlabel = 'ready' 
          AND enumtypid = (
            SELECT oid FROM pg_type WHERE typname = 'enum_credit_notes_status'
          )
        ) THEN
          ALTER TYPE enum_credit_notes_status ADD VALUE 'ready';
          RAISE NOTICE 'Added "ready" to enum_credit_notes_status';
        ELSE
          RAISE NOTICE '"ready" already exists in enum_credit_notes_status';
        END IF;
      END $$;
    `);
    
    console.log('✅ Added "ready" to credit_notes.status enum');
    console.log('✅ Migration completed successfully!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

// Run migration
addReadyStatus();

