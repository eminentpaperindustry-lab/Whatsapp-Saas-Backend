const mongoose = require('mongoose');
require('dotenv').config();

async function debugScheduler() {
  try {
    // Connect to database
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');
    
    const Campaign = require('./models/Campaign');
    const CampaignStep = require('./models/CampaignStep');
    const MessageLog = require('./models/MessageLog');
    
    // Check active campaigns
    const activeCampaigns = await Campaign.find({ status: 'active' });
    console.log(`📊 Active campaigns: ${activeCampaigns.length}`);
    
    for (const campaign of activeCampaigns) {
      const steps = await CampaignStep.countDocuments({ campaignId: campaign._id });
      const messages = await MessageLog.countDocuments({ campaignId: campaign._id });
      
      console.log(`\n📋 ${campaign.name}`);
      console.log(`   Type: ${campaign.campaignType}`);
      console.log(`   Steps: ${steps}`);
      console.log(`   Messages sent: ${messages}`);
      console.log(`   Last execution: ${campaign.lastExecutionDate || 'Never'}`);
    }
    
    // Check for scheduled times today
    const now = new Date();
    console.log(`\n🕐 Current time: ${now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Debug error:', error);
    process.exit(1);
  }
}

debugScheduler();