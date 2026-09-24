/**
 * Migration: add users.sendRegistrationNotification
 *
 * New account registration emails used to go to every active Global Admin and
 * Administrator, decided by role. They now go only to users with this toggle
 * on. When the column is first added it is switched on for exactly the users
 * who were receiving the emails before, so applying the migration changes
 * nobody's inbox. From then on it is managed per user in Users.
 *
 * Idempotent: a re-run never touches the toggle again once the column exists.
 */

const { sequelize } = require('../config/database');

async function addSendRegistrationNotificationField() {
  const transaction = await sequelize.transaction();

  try {
    const [existing] = await sequelize.query(`
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'sendRegistrationNotification';
    `, { transaction });

    if (existing.length > 0) {
      await transaction.commit();
      console.log('ℹ️  users.sendRegistrationNotification already exists, nothing to do.');
      return;
    }

    console.log('🔄 Adding sendRegistrationNotification to users...');
    await sequelize.query(`
      ALTER TABLE users
      ADD COLUMN "sendRegistrationNotification" BOOLEAN NOT NULL DEFAULT false;
    `, { transaction });

    const [, result] = await sequelize.query(`
      UPDATE users SET "sendRegistrationNotification" = true
      WHERE role IN ('global_admin', 'administrator') AND "isActive" = true;
    `, { transaction });

    await transaction.commit();
    console.log(`✅ sendRegistrationNotification added and switched on for ${result.rowCount} current recipient(s).`);
  } catch (error) {
    await transaction.rollback();
    console.error('❌ Migration failed:', error.message);
    throw error;
  }
}

if (require.main === module) {
  addSendRegistrationNotificationField()
    .then(() => { console.log('✅ Migration completed'); process.exit(0); })
    .catch(() => process.exit(1));
}

module.exports = addSendRegistrationNotificationField;
