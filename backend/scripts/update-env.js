const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const envPath = path.join(__dirname, '..', '.env');

function updateEnv() {
  console.log('📝 MongoDB Atlas Connection String Updater\n');
  console.log('Paste your MongoDB Atlas connection string below.');
  console.log('Format: mongodb+srv://username:password@cluster0.xxxxx.mongodb.net/...\n');
  
  rl.question('Connection String: ', (connectionString) => {
    if (!connectionString || !connectionString.includes('mongodb+srv://')) {
      console.log('\n❌ Invalid connection string format!');
      console.log('Expected format: mongodb+srv://username:password@cluster0.xxxxx.mongodb.net/database?retryWrites=true&w=majority');
      rl.close();
      process.exit(1);
    }

    // Ensure database name is included
    let updatedString = connectionString;
    if (!updatedString.includes('/isg-reporting') && !updatedString.match(/\/[^?]+/)) {
      // Add database name if not present
      updatedString = updatedString.replace('mongodb+srv://', 'mongodb+srv://');
      if (updatedString.includes('?')) {
        updatedString = updatedString.replace('?', '/isg-reporting?');
      } else {
        updatedString += '/isg-reporting';
      }
    }

    try {
      let envContent = fs.readFileSync(envPath, 'utf8');
      
      // Update MONGODB_URI
      if (envContent.includes('MONGODB_URI=')) {
        const lines = envContent.split('\n');
        const updatedLines = lines.map(line => {
          if (line.startsWith('MONGODB_URI=')) {
            return `MONGODB_URI=${updatedString}`;
          }
          return line;
        });
        envContent = updatedLines.join('\n');
      } else {
        envContent += `\nMONGODB_URI=${updatedString}`;
      }

      fs.writeFileSync(envPath, envContent);
      
      console.log('\n✅ .env file updated successfully!');
      console.log('\n📋 Next steps:');
      console.log('   1. Run: npm run test:db (to test connection)');
      console.log('   2. Run: npm run create:admin (to create admin user)');
      console.log('   3. Run: npm run dev (to start server)');
      
      rl.close();
      process.exit(0);
    } catch (error) {
      console.error('\n❌ Error updating .env file:', error.message);
      rl.close();
      process.exit(1);
    }
  });
}

if (!fs.existsSync(envPath)) {
  console.log('❌ .env file not found!');
  console.log('💡 Creating .env file...');
  
  const defaultEnv = `PORT=5000
MONGODB_URI=mongodb://localhost:27017/isg-reporting
JWT_SECRET=your-secret-key-change-this-in-production
NODE_ENV=development`;
  
  fs.writeFileSync(envPath, defaultEnv);
  console.log('✅ .env file created!');
}

updateEnv();

