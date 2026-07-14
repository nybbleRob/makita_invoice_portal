/**
 * Migration script to add SMTP Message-ID tracking directly on each document.
 *
 * Rationale: `email_logs` is truncatable by a global admin (see the "Clear
 * Email Logs" button). When that happens we currently lose the audit trail
 * that proves "invoice X was emailed on date Y with Message-ID Z". Storing
 * `lastNotificationMessageId` and `lastNotifiedAt` directly on the document
 * row means the evidence survives an email_logs wipe and can be handed to
 * a recipient's IT team ("please search your mail gateway for this
 * Message-ID") without any log reconstruction.
 *
 * Adds to invoices, credit_notes, and statements:
 *   - lastNotificationMessageId  VARCHAR(500)
 *   - lastNotifiedAt             TIMESTAMPTZ
 *
 * Safe to run repeatedly (uses IF NOT EXISTS). Does not backfill historical
 * rows — the field is set going forward when the email job persists a
 * successful send.
 */

const { sequelize } = require('../config/database');

const TARGET_TABLES = ['invoices', 'credit_notes', 'statements'];

async function addNotificationMessageIdColumns() {
  const transaction = await sequelize.transaction();

  try {
    console.log('🔄 Adding lastNotificationMessageId / lastNotifiedAt to document tables...');

    for (const table of TARGET_TABLES) {
      console.log(`   • ${table}...`);
      await sequelize.query(`
        ALTER TABLE ${table}
        ADD COLUMN IF NOT EXISTS "lastNotificationMessageId" VARCHAR(500),
        ADD COLUMN IF NOT EXISTS "lastNotifiedAt" TIMESTAMPTZ;
      `, { transaction });

      // Non-unique index on messageId — support "which document(s) were
      // included in this Message-ID?" lookups when a customer forwards
      // their gateway trace. Non-unique because a summary email covers
      // multiple documents that all share the same Message-ID.
      await sequelize.query(`
        CREATE INDEX IF NOT EXISTS "${table}_last_notification_message_id_idx"
        ON ${table} ("lastNotificationMessageId")
        WHERE "lastNotificationMessageId" IS NOT NULL;
      `, { transaction });
    }

    await transaction.commit();
    console.log('✅ Notification Message-ID columns added to invoices / credit_notes / statements.');
    console.log('ℹ️  Values are populated going forward by the email job when a notification hits status=SENT.');
  } catch (error) {
    await transaction.rollback();
    console.error('❌ Error adding notification Message-ID columns:', error);
    throw error;
  }
}

if (require.main === module) {
  addNotificationMessageIdColumns()
    .then(() => {
      console.log('✅ Migration completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Migration failed:', error);
      process.exit(1);
    });
}

module.exports = { addNotificationMessageIdColumns };
