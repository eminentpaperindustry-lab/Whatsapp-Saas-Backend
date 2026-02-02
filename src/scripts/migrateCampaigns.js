// src/scripts/migrateInteractive.js
const readline = require('readline');
const mongoose = require('mongoose');
require('dotenv').config();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function askQuestion(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

async function migrateCampaigns() {
  console.log('='.repeat(60));
  console.log('🚀 WHATSAPP SAAS - CAMPAIGN MIGRATION TOOL');
  console.log('='.repeat(60));
  
  // Ask for confirmation
  const confirm = await askQuestion('⚠️  This will modify your database. Continue? (yes/no): ');
  
  if (confirm.toLowerCase() !== 'yes') {
    console.log('❌ Migration cancelled by user');
    rl.close();
    return;
  }
  
  try {
    console.log('\n🔗 Connecting to MongoDB...');
    
    // Connect to MongoDB
    const mongoURI = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!mongoURI) {
      console.error('❌ MONGO_URI environment variable not found!');
      console.log('Please add MONGO_URI to your .env file');
      rl.close();
      return;
    }
    
    await mongoose.connect(mongoURI);
    console.log('✅ Connected to MongoDB');
    
    // Import models - IMPORTANT: Update path according to your structure
    let Campaign, CampaignStep;
    try {
      // Try to import from src/models
      Campaign = require('../models/Campaign');
      CampaignStep = require('../models/CampaignStep');
      console.log('✅ Models loaded successfully from src/models/');
    } catch (error) {
      console.error('❌ Failed to load models:', error.message);
      console.log('Trying alternative paths...');
      
      // Try alternative paths
      try {
        Campaign = require('../../models/Campaign');
        CampaignStep = require('../../models/CampaignStep');
        console.log('✅ Models loaded successfully from models/');
      } catch (err) {
        console.error('❌ Could not find models in any path');
        rl.close();
        return;
      }
    }
    
    // Show current state
    const totalCampaigns = await Campaign.countDocuments();
    console.log(`\n📊 Total campaigns in database: ${totalCampaigns}`);
    
    if (totalCampaigns === 0) {
      console.log('✅ No campaigns to migrate');
    } else {
      // Show sample of existing campaigns
      const sampleCampaigns = await Campaign.find().limit(3);
      console.log('\n📋 Sample of existing campaigns:');
      sampleCampaigns.forEach((campaign, index) => {
        console.log(`   ${index + 1}. ${campaign.name} (ID: ${campaign._id})`);
        console.log(`      Type: ${campaign.campaignType || 'NOT SET'}`);
        console.log(`      Status: ${campaign.status || 'NOT SET'}`);
      });
      
      // Ask what type of migration
      console.log('\n📝 Migration Options:');
      console.log('   1. Add only missing fields (Safe)');
      console.log('   2. Reset all campaign types to "fixed"');
      console.log('   3. Custom migration');
      console.log('   4. Show current field statistics');
      
      const option = await askQuestion('\nSelect option (1-4): ');
      
      switch (option) {
        case '1':
          await safeMigration(Campaign, CampaignStep);
          break;
        case '2':
          await resetMigration(Campaign, CampaignStep);
          break;
        case '3':
          await customMigration(Campaign);
          break;
        case '4':
          await showStatistics(Campaign, CampaignStep);
          break;
        default:
          console.log('❌ Invalid option');
      }
    }
    
  } catch (error) {
    console.error('❌ Migration error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
    rl.close();
  }
}

async function safeMigration(Campaign, CampaignStep) {
  console.log('\n🛡️  Running safe migration...');
  
  // Update only missing fields
  const campaignUpdate = await Campaign.updateMany(
    { campaignType: { $exists: false } },
    { $set: { campaignType: 'fixed', status: 'draft' } }
  );
  
  const stepUpdate = await CampaignStep.updateMany(
    { condition: { $exists: false } },
    { $set: { condition: 'always' } }
  );
  
  console.log(`✅ Updated ${campaignUpdate.modifiedCount} campaigns`);
  console.log(`✅ Updated ${stepUpdate.modifiedCount} campaign steps`);
}

async function resetMigration(Campaign, CampaignStep) {
  console.log('\n🔄 Running reset migration...');
  
  // Reset all campaigns to fixed type
  const campaignUpdate = await Campaign.updateMany(
    {},
    { 
      $set: { 
        campaignType: 'fixed',
        status: 'draft',
        dailyTime: '09:00',
        weeklyTime: '09:00',
        monthlyTime: '09:00'
      } 
    }
  );
  
  console.log(`✅ Reset ${campaignUpdate.modifiedCount} campaigns to fixed type`);
}

async function customMigration(Campaign) {
  console.log('\n🎛️  Running custom migration...');
  
  // Ask for specific campaign type
  const campaignType = await askQuestion('Enter default campaign type (fixed/daily/weekly/monthly/content_based): ');
  
  const validTypes = ['fixed', 'daily', 'weekly', 'monthly', 'content_based'];
  if (!validTypes.includes(campaignType)) {
    console.log('❌ Invalid campaign type');
    return;
  }
  
  const updateResult = await Campaign.updateMany(
    {},
    { $set: { campaignType: campaignType, status: 'draft' } }
  );
  
  console.log(`✅ Set ${updateResult.modifiedCount} campaigns to type: ${campaignType}`);
}

async function showStatistics(Campaign, CampaignStep) {
  console.log('\n📊 Current Database Statistics:');
  
  // Campaign statistics
  const totalCampaigns = await Campaign.countDocuments();
  const campaignsWithType = await Campaign.countDocuments({ campaignType: { $exists: true } });
  const campaignsWithStatus = await Campaign.countDocuments({ status: { $exists: true } });
  
  console.log(`\n📋 Campaigns: ${totalCampaigns} total`);
  console.log(`   With campaignType field: ${campaignsWithType}`);
  console.log(`   With status field: ${campaignsWithStatus}`);
  console.log(`   Missing fields: ${totalCampaigns - campaignsWithType}`);
  
  // Campaign type distribution
  const typeStats = await Campaign.aggregate([
    { $group: { _id: '$campaignType', count: { $sum: 1 } } }
  ]);
  
  console.log('\n🎯 Campaign Type Distribution:');
  typeStats.forEach(stat => {
    console.log(`   ${stat._id || 'NOT SET'}: ${stat.count}`);
  });
  
  // CampaignStep statistics
  const totalSteps = await CampaignStep.countDocuments();
  const stepsWithCondition = await CampaignStep.countDocuments({ condition: { $exists: true } });
  
  console.log(`\n📝 Campaign Steps: ${totalSteps} total`);
  console.log(`   With condition field: ${stepsWithCondition}`);
  console.log(`   Missing condition: ${totalSteps - stepsWithCondition}`);
}

// Run interactive migration
migrateCampaigns();