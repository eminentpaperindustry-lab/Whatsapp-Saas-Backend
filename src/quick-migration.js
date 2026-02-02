// src/quick-migration.js
const mongoose = require('mongoose');
require('dotenv').config();

console.log('🔧 WhatsApp SaaS Quick Migration');
console.log('================================\n');

async function runQuickMigration() {
  try {
    // 1. Check environment
    console.log('1. Checking environment...');
    const mongoURI = process.env.MONGO_URI || process.env.MONGODB_URI;
    
    if (!mongoURI) {
      console.log('❌ ERROR: MONGO_URI not found in .env file');
      console.log('\n💡 SOLUTION: Create .env file with:');
      console.log('MONGO_URI=mongodb://localhost:27017/whatsapp_saas');
      console.log('\nRun this command:');
      console.log('echo MONGO_URI=mongodb://localhost:27017/whatsapp_saas > ..\\.env');
      return;
    }
    
    console.log(`✅ MONGO_URI found: ${mongoURI.substring(0, 30)}...`);
    
    // 2. Connect to MongoDB
    console.log('\n2. Connecting to MongoDB...');
    await mongoose.connect(mongoURI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000
    });
    
    console.log('✅ MongoDB Connected!');
    
    // 3. Load models (they are in src/models)
    console.log('\n3. Loading models...');
    const Campaign = require('./models/Campaign');
    const CampaignStep = require('./models/CampaignStep');
    
    console.log('✅ Models loaded successfully');
    
    // 4. Check current state
    console.log('\n4. Checking current database...');
    const totalCampaigns = await Campaign.countDocuments();
    console.log(`📊 Total Campaigns: ${totalCampaigns}`);
    
    if (totalCampaigns === 0) {
      console.log('\n✨ No campaigns to migrate. Database is ready!');
      return;
    }
    
    // Show some campaigns
    const sample = await Campaign.find().limit(2);
    console.log('\n📋 Sample campaigns:');
    sample.forEach((camp, i) => {
      console.log(`${i+1}. "${camp.name}"`);
      console.log(`   ID: ${camp._id}`);
      console.log(`   Type: ${camp.campaignType || 'NOT SET'}`);
      console.log(`   Status: ${camp.status || 'NOT SET'}`);
    });
    
    // 5. Run migration
    console.log('\n5. Running migration...');
    console.log('   Adding new fields to campaigns...');
    
    const result = await Campaign.updateMany(
      {},
      {
        $setOnInsert: {
          campaignType: 'fixed',
          status: 'draft',
          dailyTime: '09:00',
          weeklyTime: '09:00',
          monthlyTime: '09:00',
          repeatCount: 0,
          executedCount: 0,
          autoStart: false,
          contentType: 'text',
          currentStepIndex: 0
        }
      },
      { upsert: false }
    );
    
    console.log(`\n✅ MIGRATION RESULTS:`);
    console.log(`   Matched: ${result.matchedCount} campaigns`);
    console.log(`   Modified: ${result.modifiedCount} campaigns`);
    
    if (result.modifiedCount > 0) {
      console.log('\n🎉 SUCCESS!');
      console.log(`${result.modifiedCount} campaigns have been updated.`);
      console.log('New campaign features are now available!');
    } else {
      console.log('\n✅ No changes needed.');
      console.log('Campaigns already have the new fields.');
    }
    
    // 6. Verify
    console.log('\n6. Verifying migration...');
    const withType = await Campaign.countDocuments({ campaignType: { $exists: true } });
    const withStatus = await Campaign.countDocuments({ status: { $exists: true } });
    
    console.log(`   Campaigns with type field: ${withType}/${totalCampaigns}`);
    console.log(`   Campaigns with status field: ${withStatus}/${totalCampaigns}`);
    
    if (withType === totalCampaigns && withStatus === totalCampaigns) {
      console.log('\n✨ VERIFICATION PASSED! Database is ready.');
    }
    
  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    
    if (error.message.includes('ECONNREFUSED') || error.message.includes('connect')) {
      console.log('\n💡 MONGODB NOT RUNNING!');
      console.log('Please start MongoDB:');
      console.log('1. Press Windows Key + R');
      console.log('2. Type "services.msc" and press Enter');
      console.log('3. Find "MongoDB" service');
      console.log('4. Right-click and select "Start"');
      console.log('\nOr run in Command Prompt as Administrator:');
      console.log('   net start MongoDB');
    }
    
  } finally {
    if (mongoose.connection.readyState === 1) {
      await mongoose.disconnect();
      console.log('\n🔌 Disconnected from MongoDB');
    }
    
    console.log('\nPress any key to exit...');
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', process.exit.bind(process, 0));
  }
}

// Run migration
runQuickMigration();