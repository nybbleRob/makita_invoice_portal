const { Sequelize } = require('sequelize');
require('dotenv').config();

async function checkEnums() {
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

  try {
    const enums = await sequelize.query(`
      SELECT 
        t.typname as enum_name
      FROM pg_type t 
      WHERE t.typtype = 'e'
      ORDER BY t.typname;
    `, { type: Sequelize.QueryTypes.SELECT });

    console.log('📋 All enums in database:');
    enums.forEach(e => {
      console.log(`   - ${e.enum_name}`);
    });

    // Check files table structure
    const filesColumns = await sequelize.query(`
      SELECT 
        column_name,
        data_type,
        udt_name
      FROM information_schema.columns
      WHERE table_name = 'files' AND column_name = 'failureReason';
    `, { type: Sequelize.QueryTypes.SELECT });

    console.log('\n📋 Files.failureReason column:');
    filesColumns.forEach(c => {
      console.log(`   - ${c.column_name}: ${c.data_type} (${c.udt_name})`);
    });

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await sequelize.close();
  }
}

checkEnums();

