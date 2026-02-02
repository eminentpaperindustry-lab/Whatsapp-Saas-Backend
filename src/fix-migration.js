// src/fix-migration.js
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config();

console.log('🔧 Fixing Migration Issues');
console.log('==========================\n');

async function fixAndMigrate() {
  try {
    // 1. Check and fix .env file
    console.log('1. Checking .env file...');
    const envPath = path.join(__dirname, '..', '.env');
    
    if (!fs.existsSync(envPath)) {
      console.log('❌ .env file not found! Creating one...');
      const defaultEnv = `PORT=5000
MONGO_URI=mongodb://localhost:27017/whatsapp_saas
JWT_SECRET=a_very_long_secret_here
JWT_EXPIRY=7d
META_WA_BUSINESS_ID=1502633441171423
META_WA_TOKEN=your_token_here
META_WA_PHONE_ID=your_phone_id
META_APP_SECRET=your_app_secret
META_WEBHOOK_VERIFY_TOKEN=my_verify_token_123
DEFAULT_TENANT_ID=default
BUSINESS_PHONE_NUMBER=918920101739`;
      
      fs.writeFileSync(envPath, defaultEnv);
      console.log('✅ Created .env file with defaults');
    }
    
    // Read .env content
    let envContent = fs.readFileSync(envPath, 'utf8');
    
    // Fix commented MONGO_URI
    if (envContent.includes('# MONGO_URI=')) {
      console.log('⚠️  Found commented MONGO_URI, fixing...');
      envContent = envContent.replace('# MONGO_URI=', 'MONGO_URI=');
      fs.writeFileSync(envPath, envContent);
      console.log('✅ Fixed MONGO_URI in .env');
    }
    
    // Reload environment variables
    require('dotenv').config();
    
    // Check MONGO_URI
    const mongoURI = process.env.MONGO_URI;
    if (!mongoURI) {
      console.log('❌ MONGO_URI still not found!');
      console.log('\nCurrent .env content:');
      console.log(envContent);
      console.log('\n💡 Please uncomment MONGO_URI line in .env file');
      return;
    }
    
    console.log(`✅ MONGO_URI found: ${mongoURI.substring(0, 50)}...`);
    
    // 2. Test MongoDB connection
    console.log('\n2. Testing MongoDB connection...');
    
    try {
      await mongoose.connect(mongoURI, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        serverSelectionTimeoutMS: 10000
      });
      
      console.log('✅ MongoDB Connected Successfully!');
      
      // 3. Load models and check
      console.log('\n3. Checking database models...');
      
      const Campaign = require('./models/Campaign');
      const totalCampaigns = await Campaign.countDocuments();
      
      console.log(`📊 Total campaigns in database: ${totalCampaigns}`);
      
      if (totalCampaigns === 0) {
        console.log('\n✨ No campaigns to migrate. Database is ready!');
        return;
      }
      
      // 4. Check and fix campaigns
      console.log('\n4. Checking campaign fields...');
      
      const missingFields = await Campaign.aggregate([
        {
          $match: {
            $or: [
              { campaignType: { $exists: false } },
              { status: { $exists: false } }
            ]
          }
        },
        { $count: "count" }
      ]);
      
      const needMigration = missingFields[0]?.count || 0;
      
      if (needMigration === 0) {
        console.log('✅ All campaigns already have required fields!');
        console.log('\n🎉 Your database is ready for campaign features!');
      } else {
        console.log(`⚠️  ${needMigration} campaigns need migration`);
        
        // Ask for confirmation
        console.log('\nDo you want to run migration now? (yes/no)');
        console.log('Type "yes" to continue or press Ctrl+C to cancel');
        
        // Wait for user input
        const readline = require('readline');
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout
        });
        
        rl.question('> ', async (answer) => {
          rl.close();
          
          if (answer.toLowerCase() === 'yes') {
            console.log('\n🔄 Running migration...');
            
            const result = await Campaign.updateMany(
              {
                $or: [
                  { campaignType: { $exists: false } },
                  { status: { $exists: false } }
                ]
              },
              {
                $set: {
                  campaignType: 'fixed',
                  status: 'draft',
                  dailyTime: '09:00',
                  weeklyTime: '09:00',
                  monthlyTime: '09:00',
                  repeatCount: 0,
                  executedCount: 0
                }
              }
            );
            
            console.log(`\n✅ Migration Completed!`);
            console.log(`   Updated ${result.modifiedCount} campaigns`);
            console.log('\n✨ Campaign features are now ready!');
            
          } else {
            console.log('\n❌ Migration cancelled by user');
          }
          
          await mongoose.disconnect();
          console.log('\n🔌 Disconnected from MongoDB');
          console.log('\nPress any key to exit...');
          process.stdin.setRawMode(true);
          process.stdin.resume();
          process.stdin.on('data', process.exit.bind(process, 0));
        });
        
        return; // Don't disconnect yet
      }
      
    } catch (dbError) {
      console.error('❌ MongoDB Connection Error:', dbError.message);
      
      if (mongoURI.includes('localhost') || mongoURI.includes('127.0.0.1')) {
        console.log('\n💡 LOCAL MONGODB NOT RUNNING');
        console.log('Please start MongoDB:');
        console.log('1. Open Command Prompt as Administrator');
        console.log('2. Run: net start MongoDB');
        console.log('\nOr use MongoDB Atlas instead:');
        console.log('Change MONGO_URI to your Atlas connection string');
      } else if (mongoURI.includes('mongodb+srv://')) {
        console.log('\n💡 MONGODB ATLAS CONNECTION ISSUE');
        console.log('1. Check your internet connection');
        console.log('2. Verify Atlas cluster is running');
        console.log('3. Check firewall settings');
      }
    }
    
  } catch (error) {
    console.error('\n❌ Fatal Error:', error.message);
  }
}

// Run the fix
fixAndMigrate();