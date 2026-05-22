/**
 * Migration: split sendStatementAttachment into PDF + XLS toggles on users + companies.
 *  - Adds sendStatementPdfAttachment + sendStatementXlsAttachment (BOOLEAN, default false)
 *  - Backfills both new columns from the old sendStatementAttachment so behaviour stays identical
 *    (anyone who had attachments on now gets both formats; they can untoggle the one they don't want).
 *  - Drops the old sendStatementAttachment column.
 *
 * Idempotent: safe to re-run.
 */

require('dotenv').config();
const { Sequelize } = require('sequelize');

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432,
    dialect: 'postgres',
    logging: false
  }
);

async function columnExists(table, column) {
  const [rows] = await sequelize.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    { bind: [table, column] }
  );
  return rows.length > 0;
}

async function splitAttachmentColumn(table) {
  console.log(`\nMigrating ${table}...`);

  if (!(await columnExists(table, 'sendStatementPdfAttachment'))) {
    console.log(`  Adding sendStatementPdfAttachment to ${table}...`);
    await sequelize.query(
      `ALTER TABLE ${table} ADD COLUMN "sendStatementPdfAttachment" BOOLEAN NOT NULL DEFAULT false`
    );
  } else {
    console.log(`  sendStatementPdfAttachment already exists on ${table}, skipping add`);
  }

  if (!(await columnExists(table, 'sendStatementXlsAttachment'))) {
    console.log(`  Adding sendStatementXlsAttachment to ${table}...`);
    await sequelize.query(
      `ALTER TABLE ${table} ADD COLUMN "sendStatementXlsAttachment" BOOLEAN NOT NULL DEFAULT false`
    );
  } else {
    console.log(`  sendStatementXlsAttachment already exists on ${table}, skipping add`);
  }

  if (await columnExists(table, 'sendStatementAttachment')) {
    console.log(`  Backfilling new toggles from legacy sendStatementAttachment on ${table}...`);
    await sequelize.query(`
      UPDATE ${table}
      SET "sendStatementPdfAttachment" = "sendStatementAttachment",
          "sendStatementXlsAttachment" = "sendStatementAttachment"
      WHERE "sendStatementAttachment" = true
        AND "sendStatementPdfAttachment" = false
        AND "sendStatementXlsAttachment" = false
    `);

    console.log(`  Dropping legacy sendStatementAttachment column on ${table}...`);
    await sequelize.query(`ALTER TABLE ${table} DROP COLUMN "sendStatementAttachment"`);
  } else {
    console.log(`  Legacy sendStatementAttachment already absent on ${table}, nothing to backfill`);
  }
}

async function migrate() {
  try {
    console.log('Starting migration: statement attachment split (PDF + XLS toggles)...');
    await sequelize.authenticate();
    console.log('Database connection established');

    await splitAttachmentColumn('users');
    await splitAttachmentColumn('companies');

    console.log('\nMigration completed successfully');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

migrate();
