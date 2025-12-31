/**
 * Migration Script: Create pending_registrations table
 */

const { sequelize } = require('../models');

async function addPendingRegistrationsTable() {
  try {
    console.log('🔄 Creating pending_registrations table...');
    
    // Check if table already exists
    const [results] = await sequelize.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_name = 'pending_registrations'
    `);
    
    if (results.length > 0) {
      console.log('✅ Table already exists, skipping...');
      return;
    }
    
    // Create table
    await sequelize.query(`
      CREATE TABLE "pending_registrations" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "firstName" VARCHAR(255) NOT NULL,
        "companyName" VARCHAR(255) NOT NULL,
        "accountNumber" VARCHAR(255),
        "email" VARCHAR(255) NOT NULL,
        "customFields" JSONB DEFAULT '{}',
        "status" VARCHAR(20) DEFAULT 'pending' CHECK ("status" IN ('pending', 'approved', 'rejected')),
        "reviewedById" UUID,
        "reviewedAt" TIMESTAMP,
        "rejectionReason" TEXT,
        "createdUserId" UUID,
        "metadata" JSONB DEFAULT '{}',
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    
    // Add indexes
    await sequelize.query(`
      CREATE INDEX "pending_registrations_email_idx" ON "pending_registrations" ("email");
      CREATE INDEX "pending_registrations_status_idx" ON "pending_registrations" ("status");
      CREATE INDEX "pending_registrations_createdAt_idx" ON "pending_registrations" ("createdAt" DESC);
    `);
    
    // Add foreign key constraints
    await sequelize.query(`
      ALTER TABLE "pending_registrations"
      ADD CONSTRAINT "pending_registrations_reviewedById_fkey"
      FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL;
      
      ALTER TABLE "pending_registrations"
      ADD CONSTRAINT "pending_registrations_createdUserId_fkey"
      FOREIGN KEY ("createdUserId") REFERENCES "users"("id") ON DELETE SET NULL;
    `);
    
    console.log('✅ Successfully created pending_registrations table!');
  } catch (error) {
    console.error('❌ Error creating table:', error);
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  sequelize.authenticate()
    .then(() => {
      console.log('📦 Database connection established');
      return addPendingRegistrationsTable();
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

module.exports = { addPendingRegistrationsTable };

