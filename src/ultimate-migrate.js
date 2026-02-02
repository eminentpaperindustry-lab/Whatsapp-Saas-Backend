// src/campaign-migration-v2.js
const mongoose = require('mongoose');

console.log('🚀 CAMPAIGN MIGRATION V2');
console.log('========================\n');

async function runMigration() {
  try {
    // MongoDB connection
    const mongoURI = process.env.MONGO_URI || 'mongodb://localhost:27017/whatsapp_saas';
    
    console.log('🔗 Connecting to MongoDB...');
    await mongoose.connect(mongoURI);
    console.log('✅ MongoDB Connected!\n');
    
    // Load OLD and NEW models
    const Campaign = require('./models/Campaign');
    const CampaignStep = require('./models/CampaignStep');
    
    console.log('📋 Checking current structure...');
    
    // 1. Check and update Campaign schema
    const campaigns = await Campaign.find({});
    console.log(`Found ${campaigns.length} campaigns`);
    
    let updatedCampaigns = 0;
    for (const campaign of campaigns) {
      let needsUpdate = false;
      
      // Convert sectionId to sectionIds array
      if (campaign.sectionId && !campaign.sectionIds) {
        console.log(`Converting sectionId to sectionIds for campaign: ${campaign.name}`);
        campaign.sectionIds = [campaign.sectionId];
        campaign.sectionId = undefined;
        needsUpdate = true;
      }
      
      // Add default campaignType if missing
      if (!campaign.campaignType) {
        campaign.campaignType = 'fixed';
        needsUpdate = true;
      }
      
      // Add default status if missing
      if (!campaign.status) {
        campaign.status = 'draft';
        needsUpdate = true;
      }
      
      // Add totalDays for fixed campaigns
      if (campaign.campaignType === 'fixed' && !campaign.totalDays) {
        const maxDay = await CampaignStep.findOne({ campaignId: campaign._id })
          .sort({ day: -1 })
          .select('day');
        
        campaign.totalDays = maxDay ? maxDay.day : 1;
        needsUpdate = true;
      }
      
      if (needsUpdate) {
        await campaign.save();
        updatedCampaigns++;
      }
    }
    
    console.log(`✅ Updated ${updatedCampaigns} campaigns\n`);
    
    // 2. Check and update CampaignStep schema
    const steps = await CampaignStep.find({});
    console.log(`Found ${steps.length} campaign steps`);
    
    let updatedSteps = 0;
    for (const step of steps) {
      let needsUpdate = false;
      
      // Add day field if missing (default to 1)
      if (!step.day) {
        step.day = 1;
        needsUpdate = true;
      }
      
      // Convert delayDays to stepTime
      if (step.delayDays !== undefined && step.delayDays !== null) {
        // Calculate stepTime based on delayDays
        // For example, delayDays = 1 means 24 hours later
        const baseTime = '09:00';
        step.stepTime = baseTime;
        step.delayDays = undefined;
        needsUpdate = true;
      }
      
      // Ensure stepTime exists
      if (!step.stepTime) {
        step.stepTime = '09:00';
        needsUpdate = true;
      }
      
      if (needsUpdate) {
        await step.save();
        updatedSteps++;
      }
    }
    
    console.log(`✅ Updated ${updatedSteps} campaign steps\n`);
    
    // 3. Fix duplicate sequence issues
    console.log('🔍 Fixing duplicate sequence issues...');
    
    const campaignsWithSteps = await Campaign.find({});
    let fixedSequences = 0;
    
    for (const campaign of campaignsWithSteps) {
      const campaignSteps = await CampaignStep.find({ campaignId: campaign._id })
        .sort({ day: 1, sequence: 1 });
      
      // Group by day
      const stepsByDay = {};
      campaignSteps.forEach(step => {
        if (!stepsByDay[step.day]) {
          stepsByDay[step.day] = [];
        }
        stepsByDay[step.day].push(step);
      });
      
      // Fix sequence numbers for each day
      for (const day in stepsByDay) {
        const daySteps = stepsByDay[day].sort((a, b) => a.sequence - b.sequence);
        
        for (let i = 0; i < daySteps.length; i++) {
          const expectedSequence = i + 1;
          if (daySteps[i].sequence !== expectedSequence) {
            console.log(`Fixing sequence for campaign ${campaign.name}, Day ${day}: ${daySteps[i].sequence} -> ${expectedSequence}`);
            daySteps[i].sequence = expectedSequence;
            await daySteps[i].save();
            fixedSequences++;
          }
        }
      }
    }
    
    console.log(`✅ Fixed ${fixedSequences} sequence numbers\n`);
    
    // 4. Update CampaignProgress for fixed campaigns
    console.log('🔄 Updating campaign progress...');
    
    const CampaignProgress = require('./models/CampaignProgress');
    const progressEntries = await CampaignProgress.find({});
    
    let updatedProgress = 0;
    for (const progress of progressEntries) {
      // Add currentDay if missing (default to 1)
      if (!progress.currentDay) {
        progress.currentDay = 1;
        await progress.save();
        updatedProgress++;
      }
    }
    
    console.log(`✅ Updated ${updatedProgress} progress entries\n`);
    
    // FINAL REPORT
    console.log('🎉 MIGRATION COMPLETED SUCCESSFULLY!');
    console.log('=====================================');
    console.log(`📊 Campaigns updated: ${updatedCampaigns}`);
    console.log(`📊 Steps updated: ${updatedSteps}`);
    console.log(`📊 Sequences fixed: ${fixedSequences}`);
    console.log(`📊 Progress entries updated: ${updatedProgress}`);
    console.log('\n✨ Your database is now ready for new features!');
    
  } catch (error) {
    console.error('\n❌ MIGRATION ERROR:', error.message);
    console.error(error.stack);
  } finally {
    if (mongoose.connection.readyState === 1) {
      await mongoose.disconnect();
      console.log('\n🔌 Disconnected from MongoDB');
    }
  }
}

// Run if called directly
if (require.main === module) {
  // Load environment
  require('dotenv').config();
  
  runMigration().then(() => {
    console.log('\n✅ Migration completed!');
    process.exit(0);
  }).catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
}

module.exports = runMigration;