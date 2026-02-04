const mongoose = require('mongoose');
const moment = require('moment-timezone');
const Campaign = require('../models/Campaign');
const CampaignStep = require('../models/CampaignStep');
const CampaignProgress = require('../models/CampaignProgress');
const Contact = require('../models/Contact');
const MessageLog = require('../models/MessageLog');

class CampaignProcessor {
  constructor() {
    this.isInitialized = false;
    console.log('🤖 Campaign Processor Initialized - NO DUPLICATE MODE');
  }

  async init() {
    if (this.isInitialized) return;
    
    console.log('🔄 Initializing Campaign Processor...');
    
    try {
      // ONLY LOG stuck campaigns, DO NOT FIX
      await this.logStuckCampaigns();
      
      // Check for missed messages (LOG ONLY, NO RESEND)
      await this.checkMissedMessages();
      
      this.isInitialized = true;
      console.log('✅ Campaign Processor initialized - NO AUTO RESEND');
      
    } catch (error) {
      console.error('❌ Campaign Processor init error:', error);
    }
  }

  // ONLY LOG stuck campaigns, DO NOT FIX/SEND
  async logStuckCampaigns() {
    try {
      console.log('📊 Logging campaign status (NO AUTO FIX)...');
      
      const activeCampaigns = await Campaign.find({ status: 'active' });
      
      console.log(`📊 Found ${activeCampaigns.length} active campaigns`);
      
      for (const campaign of activeCampaigns) {
        const steps = await CampaignStep.countDocuments({ campaignId: campaign._id });
        const messages = await MessageLog.countDocuments({ 
          campaignId: campaign._id,
          status: 'sent'
        });
        
        console.log(`📋 ${campaign.name}: ${steps} steps, ${messages} messages sent`);
        
        // Only update last execution date if not set
        if (!campaign.lastExecutionDate) {
          campaign.lastExecutionDate = new Date();
          await campaign.save();
        }
      }
      
    } catch (error) {
      console.error('❌ Error logging campaigns:', error);
    }
  }

  // Check for missed messages but DO NOT RESEND
  async checkMissedMessages() {
    try {
      console.log('🔍 Checking for missed messages (LOG ONLY)...');
      const now = moment().tz('Asia/Kolkata');
      
      // Get all active campaigns
      const activeCampaigns = await Campaign.find({ status: 'active' });
      
      let totalMissed = 0;
      
      for (const campaign of activeCampaigns) {
        const missed = await this.logCampaignMissedMessages(campaign, now);
        totalMissed += missed;
      }
      
      if (totalMissed > 0) {
        console.log(`⚠️ Total missed messages: ${totalMissed} (NOT RESENDING)`);
      }
      
    } catch (error) {
      console.error('❌ Error checking missed messages:', error);
    }
  }

  async logCampaignMissedMessages(campaign, currentTime) {
    try {
      // Get all steps for this campaign
      const steps = await CampaignStep.find({ campaignId: campaign._id });
      
      let missedCount = 0;
      
      for (const step of steps) {
        const missed = await this.logStepMissedMessage(campaign, step, currentTime);
        if (missed) missedCount++;
      }
      
      return missedCount;
      
    } catch (error) {
      console.error(`❌ Error logging missed messages for ${campaign.name}:`, error);
      return 0;
    }
  }

  async logStepMissedMessage(campaign, step, currentTime) {
    try {
      // Parse step time
      const [stepHour, stepMinute] = step.stepTime.split(':').map(Number);
      
      let targetTime = null;
      
      if (campaign.campaignType === 'daily') {
        // Daily - check today
        targetTime = moment().tz('Asia/Kolkata')
          .hours(stepHour)
          .minutes(stepMinute)
          .seconds(0)
          .milliseconds(0);
          
      } else if (campaign.campaignType === 'weekly' && step.dayOfWeek !== null) {
        // Weekly - check if today is the right day
        const today = currentTime.day();
        if (step.dayOfWeek === today) {
          targetTime = moment().tz('Asia/Kolkata')
            .hours(stepHour)
            .minutes(stepMinute)
            .seconds(0)
            .milliseconds(0);
        }
        
      } else if (campaign.campaignType === 'monthly' && step.dayOfMonth !== null) {
        // Monthly - check if today is the right date
        const todayDate = currentTime.date();
        if (step.dayOfMonth === todayDate) {
          targetTime = moment().tz('Asia/Kolkata')
            .hours(stepHour)
            .minutes(stepMinute)
            .seconds(0)
            .milliseconds(0);
        }
      } else if (campaign.campaignType === 'fixed') {
        // Fixed campaigns handled differently in scheduler
        return false;
      }
      
      // If targetTime is calculated and has passed
      if (targetTime) {
        const timeDiff = currentTime.diff(targetTime, 'minutes');
        
        // If step time passed more than 10 minutes ago
        if (timeDiff > 10) {
          // Check if message was sent
          const messagesSent = await MessageLog.countDocuments({
            campaignId: campaign._id,
            stepSequence: step.sequence,
            createdAt: {
              $gte: targetTime.toDate(),
              $lte: currentTime.toDate()
            },
            status: 'sent'
          });
          
          if (messagesSent === 0) {
            console.log(`⚠️ MISSED (NOT RESENDING): ${campaign.name} - Step ${step.sequence} at ${step.stepTime}`);
            console.log(`   Scheduled: ${targetTime.format('DD/MM/YYYY HH:mm')}`);
            console.log(`   Current: ${currentTime.format('DD/MM/YYYY HH:mm')}`);
            console.log(`   Diff: ${timeDiff} minutes ago`);
            return true;
          }
        }
      }
      
      return false;
      
    } catch (error) {
      console.error(`❌ Error logging step ${step.sequence}:`, error);
      return false;
    }
  }

  // Check if message was already sent (24-hour window)
  async hasMessageBeenSent(campaignId, stepId, contactId, scheduledTime) {
    try {
      if (!scheduledTime) {
        scheduledTime = new Date();
      }
      
      // 24-hour window check
      const timeWindowStart = new Date(scheduledTime.getTime() - 12 * 60 * 60 * 1000);
      const timeWindowEnd = new Date(scheduledTime.getTime() + 12 * 60 * 60 * 1000);
      
      const existingMessage = await MessageLog.findOne({
        campaignId: campaignId,
        contactId: contactId,
        stepSequence: stepId,
        status: 'sent',
        createdAt: {
          $gte: timeWindowStart,
          $lte: timeWindowEnd
        }
      });
      
      return !!existingMessage;
      
    } catch (error) {
      console.error('❌ Error checking sent messages:', error);
      return false;
    }
  }

  // Clean up old data (optional)
  async cleanupOldData() {
    try {
      console.log('🧹 Cleaning up old data...');
      
      const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      
      // Delete old sent logs (optional)
      const result = await MessageLog.deleteMany({
        createdAt: { $lt: ninetyDaysAgo },
        status: 'sent'
      });
      
      console.log(`🗑️ Deleted ${result.deletedCount} old sent logs`);
      
    } catch (error) {
      console.error('❌ Error cleaning up old data:', error);
    }
  }

  getStatus() {
    return {
      initialized: this.isInitialized,
      timestamp: new Date().toISOString(),
      mode: 'NO_AUTO_RESEND'
    };
  }
}

module.exports = new CampaignProcessor();