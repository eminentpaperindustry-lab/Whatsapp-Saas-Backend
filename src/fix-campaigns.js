const mongoose = require('mongoose');
require('dotenv').config();

async function fixCampaigns() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');
    
    const Campaign = require('./models/Campaign');
    const CampaignProgress = require('./models/CampaignProgress');
    
    // Fix stuck campaigns
    const campaigns = await Campaign.find({ status: 'active' });
    console.log(`🔧 Checking ${campaigns.length} active campaigns`);
    
    for (const campaign of campaigns) {
      // Update last execution date if too old
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      
      if (!campaign.lastExecutionDate || campaign.lastExecutionDate < thirtyDaysAgo) {
        campaign.lastExecutionDate = new Date();
        await campaign.save();
        console.log(`✅ Fixed ${campaign.name}`);
      }
    }
    
    // Check progress records
    const stuckProgress = await CampaignProgress.find({
      status: 'active',
      updatedAt: { $lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
    });
    
    console.log(`📊 Found ${stuckProgress.length} stuck progress records`);
    
    for (const progress of stuckProgress) {
      progress.status = 'completed';
      progress.completedAt = new Date();
      await progress.save();
      console.log(`✅ Fixed progress for contact`);
    }
    
    console.log('🎉 Campaign fix completed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Fix error:', error);
    process.exit(1);
  }
}

fixCampaigns();