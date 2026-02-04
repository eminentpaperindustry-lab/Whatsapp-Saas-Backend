const cron = require('node-cron');
const Template = require('../models/Template');
const axios = require('axios');

class TemplateSyncService {
  constructor() {
    this.isRunning = false;
  }

  async syncTemplateStatus(template) {
    try {
      if (!template.fbTemplateId) return null;
      
      const url = `https://graph.facebook.com/v19.0/${template.fbTemplateId}`;
      
      const response = await axios.get(url, {
        headers: {
          'Authorization': `Bearer ${process.env.META_WA_TOKEN}`
        },
        params: {
          fields: 'id,name,status,quality_score'
        }
      });
      
      if (response.data.status !== template.status) {
        const oldStatus = template.status;
        template.status = response.data.status;
        template.quality_score = response.data.quality_score;
        template.lastSyncedAt = new Date();
        
        if (response.data.status === 'APPROVED') {
          template.approvedAt = new Date();
        }
        
        await template.save();
        
        console.log(`🔄 Auto-synced ${template.name}: ${oldStatus} → ${response.data.status}`);
        return { oldStatus, newStatus: response.data.status };
      }
      
      return null;
    } catch (error) {
      console.error(`Sync error for ${template.name}:`, error.message);
      return null;
    }
  }

  async syncAllTemplatesStatus() {
    if (this.isRunning) return;
    
    this.isRunning = true;
    console.log('🔄 Background template status sync started...');
    
    try {
      const templates = await Template.find({
        fbTemplateId: { $ne: null },
        status: { $in: ['PENDING', 'IN_REVIEW'] },
        $or: [
          { lastSyncedAt: { $lt: new Date(Date.now() - 30 * 60 * 1000) } }, // 30 minutes
          { lastSyncedAt: { $exists: false } }
        ]
      }).limit(100);
      
      let updatedCount = 0;
      
      for (const template of templates) {
        try {
          const result = await this.syncTemplateStatus(template);
          if (result) updatedCount++;
          
          // Delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
          console.error(`Error syncing ${template.name}:`, error.message);
        }
      }
      
      console.log(`✅ Background sync complete. Updated ${updatedCount} templates.`);
    } catch (error) {
      console.error('Background sync error:', error);
    } finally {
      this.isRunning = false;
    }
  }

  start() {
    // Run every 15 minutes
    cron.schedule('*/15 * * * *', () => {
      this.syncAllTemplatesStatus();
    });
    
    console.log('✅ Template sync service started (runs every 15 minutes)');
    
    // Initial sync after 10 seconds
    setTimeout(() => {
      this.syncAllTemplatesStatus();
    }, 10000);
  }
}

module.exports = new TemplateSyncService();