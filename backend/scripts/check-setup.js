const fs = require('fs');
const path = require('path');

console.log('🔍 Checking Backend Setup...\n');

// Check if .env exists
const envPath = path.join(__dirname, '..', '.env');
const envExists = fs.existsSync(envPath);

if (envExists) {
  console.log('✅ .env file exists');
  const envContent = fs.readFileSync(envPath, 'utf8');
  
  // Check for required variables
  const requiredVars = ['MONGODB_URI', 'JWT_SECRET', 'PORT'];
  const missingVars = [];
  
  requiredVars.forEach(varName => {
    if (envContent.includes(`${varName}=`)) {
      const value = envContent.split(`${varName}=`)[1]?.split('\n')[0]?.trim();
      if (value && value !== '' && !value.includes('your-secret-key')) {
        console.log(`✅ ${varName} is set`);
      } else {
        console.log(`⚠️  ${varName} needs to be configured`);
        missingVars.push(varName);
      }
    } else {
      console.log(`❌ ${varName} is missing`);
      missingVars.push(varName);
    }
  });
  
  if (missingVars.length === 0) {
    console.log('\n✅ All environment variables are configured!');
  } else {
    console.log(`\n⚠️  Please configure: ${missingVars.join(', ')}`);
  }
} else {
  console.log('❌ .env file not found');
  console.log('💡 Create backend/.env file with your configuration');
}

// Check node_modules
const nodeModulesPath = path.join(__dirname, '..', 'node_modules');
if (fs.existsSync(nodeModulesPath)) {
  console.log('✅ Dependencies installed');
} else {
  console.log('❌ Dependencies not installed');
  console.log('💡 Run: npm install');
}

// Check models
const modelsPath = path.join(__dirname, '..', 'models');
if (fs.existsSync(modelsPath)) {
  const models = fs.readdirSync(modelsPath).filter(f => f.endsWith('.js'));
  console.log(`✅ Models found: ${models.length}`);
}

// Check routes
const routesPath = path.join(__dirname, '..', 'routes');
if (fs.existsSync(routesPath)) {
  const routes = fs.readdirSync(routesPath).filter(f => f.endsWith('.js'));
  console.log(`✅ Routes found: ${routes.length}`);
}

console.log('\n📋 Next Steps:');
console.log('   1. Update backend/.env with your MongoDB Atlas connection string');
console.log('   2. Run: npm run test:db (to test connection)');
console.log('   3. Run: npm run create:admin (to create admin user)');
console.log('   4. Run: npm run dev (to start server)');

