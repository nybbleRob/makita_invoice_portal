require('dotenv').config();
const { sequelize } = require('../config/database');
const { User } = require('../models');

const createAdminUser = async () => {
  try {
    console.log('🔗 Connecting to PostgreSQL...');
    await sequelize.authenticate();
    console.log('✅ Connected!\n');

    // Check if admin already exists
    const existingAdmin = await User.findOne({ 
      where: { email: 'admin@isg-reporting.com' } 
    });
    
    if (existingAdmin) {
      console.log('⚠️  Admin user already exists!');
      console.log('   Email: admin@isg-reporting.com');
      console.log('   To create a new admin, use a different email.\n');
      await sequelize.close();
      process.exit(0);
    }

    // Create admin user
    const admin = await User.create({
      name: 'Global Admin',
      email: 'admin@isg-reporting.com',
      password: 'admin123', // Change this after first login!
      role: 'global_admin'
    });

    console.log('✅ Admin user created successfully!\n');
    console.log('📧 Login Credentials:');
    console.log('   Email: admin@isg-reporting.com');
    console.log('   Password: admin123');
    console.log('');
    console.log('⚠️  IMPORTANT: Change the password after first login!\n');

    await sequelize.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating admin user:', error.message);
    if (error.original) {
      console.error('   Original error:', error.original.message);
    }
    await sequelize.close();
    process.exit(1);
  }
};

createAdminUser();

