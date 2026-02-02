const cron = require('node-cron');
const Campaign = require('../models/Campaign');
const CampaignStep = require('../models/CampaignStep');
const Contact = require('../models/Contact');
const CampaignProgress = require('../models/CampaignProgress');
const MessageLog = require('../models/MessageLog');
const { sendText, sendImage, sendVideo, sendFile, sendTemplate } = require('./whatsapp');

class CampaignScheduler {
  constructor() {
    this.scheduledJobs = new Map();
  }

  async scheduleCampaign(campaignId) {
    try {
      const campaign = await Campaign.findById(campaignId);
      if (!campaign || campaign.status !== 'active') return;

      // Remove existing job if any
      this.unscheduleCampaign(campaignId);

      // For weekly and monthly campaigns, we need to schedule each step individually
      if (campaign.campaignType === 'weekly' || campaign.campaignType === 'monthly') {
        await this.scheduleIndividualSteps(campaign);
      } else if (campaign.campaignType === 'daily') {
        await this.scheduleDailyCampaign(campaign);
      }

      console.log(`Campaign ${campaignId} scheduled successfully`);
      
    } catch (error) {
      console.error('Error scheduling campaign:', error);
    }
  }

  async scheduleIndividualSteps(campaign) {
    const steps = await CampaignStep.find({ campaignId: campaign._id }).sort({ sequence: 1 });
    
    for (const step of steps) {
      let cronExpression = '';
      
      if (campaign.campaignType === 'weekly' && step.dayOfWeek !== null) {
        const [hour, minute] = step.stepTime ? step.stepTime.split(':') : campaign.weeklyTime.split(':');
        cronExpression = `${minute} ${hour} * * ${step.dayOfWeek}`;
      } else if (campaign.campaignType === 'monthly' && step.dayOfMonth !== null) {
        const [hour, minute] = step.stepTime ? step.stepTime.split(':') : campaign.monthlyTime.split(':');
        cronExpression = `${minute} ${hour} ${step.dayOfMonth} * *`;
      }

      if (cronExpression) {
        const jobId = `${campaign._id}_step_${step.sequence}`;
        
        const job = cron.schedule(cronExpression, async () => {
          await this.executeCampaignStep(campaign._id, step._id);
        });

        this.scheduledJobs.set(jobId, job);
        console.log(`Step ${step.sequence} scheduled: ${cronExpression}`);
      }
    }
  }

  async scheduleDailyCampaign(campaign) {
    const steps = await CampaignStep.find({ campaignId: campaign._id }).sort({ sequence: 1 });
    
    for (const step of steps) {
      const stepTime = step.stepTime || campaign.dailyTime || '09:00';
      const [hour, minute] = stepTime.split(':');
      const cronExpression = `${minute} ${hour} * * *`;
      
      const jobId = `${campaign._id}_step_${step.sequence}`;
      
      const job = cron.schedule(cronExpression, async () => {
        await this.executeCampaignStep(campaign._id, step._id);
      });

      this.scheduledJobs.set(jobId, job);
      console.log(`Daily step ${step.sequence} scheduled: ${cronExpression}`);
    }
  }

  async executeCampaignStep(campaignId, stepId) {
    try {
      const campaign = await Campaign.findById(campaignId);
      if (!campaign || campaign.status !== 'active') return;

      const step = await CampaignStep.findById(stepId);
      if (!step) return;

      console.log(`Executing step ${step.sequence} for campaign: ${campaign.name}`);

      // Get contacts
      const contactsQuery = { tenantId: campaign.tenantId };
      if (campaign.sectionId) {
        contactsQuery.section = campaign.sectionId;
      }
      
      const contacts = await Contact.find(contactsQuery);
      
      if (contacts.length === 0) {
        console.log('No contacts found for campaign');
        return;
      }

      // Send step to all contacts
      await this.sendStepToContacts(step, contacts, campaign);

      // Update campaign execution count
      campaign.executedCount += 1;
      campaign.lastExecutionDate = new Date();
      
      // Calculate next execution if needed
      campaign.nextExecutionDate = this.getNextExecutionTime(campaign);
      
      // Check if campaign should be stopped (for repeat campaigns)
      if (campaign.repeatCount > 0 && campaign.executedCount >= campaign.repeatCount) {
        campaign.status = 'completed';
        this.unscheduleCampaign(campaignId);
      }
      
      await campaign.save();

      console.log(`Step ${step.sequence} executed successfully. Sent to ${contacts.length} contacts.`);
      
    } catch (error) {
      console.error('Error executing campaign step:', error);
    }
  }

  async sendStepToContacts(step, contacts, campaign) {
    const promises = contacts.map(async (contact) => {
      try {
        await this.processCampaignStep(step, contact, campaign);
      } catch (error) {
        console.error(`Error sending to ${contact.phone}:`, error);
      }
    });
    
    await Promise.all(promises);
  }

  async processCampaignStep(step, contact, campaign) {
    try {
      const to = contact.phone.replace(/\+/g, '');
      console.log(`Sending step ${step.sequence} to ${to}`);

      let resp = null;

      if (step.type === 'text') {
        resp = await sendText({ to, body: step.body });
      } else if (step.type === 'media') {
        // Check media type
        const mediaUrl = step.mediaUrl;
        
        if (mediaUrl.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
          resp = await sendImage({ 
            to, 
            imageUrl: mediaUrl, 
            caption: step.caption || ''  // Use caption if available
          });
        } else if (mediaUrl.match(/\.(mp4|avi|mov|wmv)$/i)) {
          resp = await sendVideo({ 
            to, 
            videoUrl: mediaUrl, 
            caption: step.caption || '' 
          });
        } else if (mediaUrl.match(/\.(pdf|doc|docx|txt|xlsx)$/i)) {
          resp = await sendFile({ 
            to, 
            fileUrl: mediaUrl, 
            caption: step.caption || '' 
          });
        } else {
          // Default to document
          resp = await sendFile({ 
            to, 
            fileUrl: mediaUrl, 
            caption: step.caption || '' 
          });
        }
      } else if (step.type === 'template') {
        if (!step.templateName) {
          throw new Error('No templateName in step for template type');
        }
        
        // Prepare components if there are placeholders
        let components = [];
        if (step.placeholders && step.placeholders.length > 0) {
          components = step.placeholders.map((ph, index) => ({
            type: 'BODY',
            parameters: [{ type: 'text', text: ph }]
          }));
        }
        
        resp = await sendTemplate({
          to,
          templateName: step.templateName,
          language: step.language || 'en_US',
          components: components
        });
      } else {
        throw new Error('Unknown step type: ' + step.type);
      }

      // Log successful message
      await MessageLog.create({
        tenantId: campaign.tenantId,
        campaignId: campaign._id,
        contactId: contact._id,
        provider: 'meta',
        provider_message_id: resp?.messages?.[0]?.id || resp?.id || null,
        to: contact.phone,
        direction: 'outbound',
        type: step.type,
        status: 'sent',
        payload: resp,
        caption: step.caption || null  // Save caption in log
      });

      // For fixed campaigns, update progress
      if (campaign.campaignType === 'fixed') {
        await this.updateCampaignProgress(campaign, contact, step);
      }

    } catch (err) {
      console.error('Send error for', contact.phone, err);
      
      // Log failed message
      await MessageLog.create({
        tenantId: campaign.tenantId,
        campaignId: campaign._id,
        contactId: contact._id,
        provider: 'meta',
        to: contact.phone,
        direction: 'outbound',
        type: step.type,
        status: 'failed',
        payload: err.response?.data || err.message,
        caption: step.caption || null  // Save caption in log
      });
    }
  }

  async updateCampaignProgress(campaign, contact, step) {
    try {
      let progress = await CampaignProgress.findOne({
        campaignId: campaign._id,
        contactId: contact._id
      });

      if (!progress) {
        progress = await CampaignProgress.create({
          campaignId: campaign._id,
          contactId: contact._id,
          tenantId: campaign.tenantId,
          currentStepIndex: 0,
          status: 'active'
        });
      }
// services/campaignScheduler.js में निम्नलिखित function add करें (class के अंदर):

  // Add this function to CampaignScheduler class
  async processCampaignStep(step, contact, campaign, progress = null) {
    try {
      const to = contact.phone.replace(/\+/g, '');
      console.log(`\n📲 PROCESSING STEP ${step.sequence} for ${to}`);
      console.log(`📝 Type: ${step.type}, Day: ${step.day}`);

      let resp = null;
      let messageType = step.type;

      if (step.type === 'text') {
        console.log(`💬 Text: ${step.body?.substring(0, 50)}...`);
        resp = await sendText({ to, body: step.body });
      } else if (step.type === 'media') {
        const mediaUrl = step.mediaUrl;
        
        if (mediaUrl.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
          messageType = 'image';
          console.log(`🖼️ Image: ${mediaUrl}`);
          resp = await sendImage({ 
            to, 
            imageUrl: mediaUrl, 
            caption: step.caption || '' 
          });
        } else if (mediaUrl.match(/\.(mp4|avi|mov|wmv)$/i)) {
          messageType = 'video';
          console.log(`🎬 Video: ${mediaUrl}`);
          resp = await sendVideo({ 
            to, 
            videoUrl: mediaUrl, 
            caption: step.caption || '' 
          });
        } else {
          messageType = 'document';
          console.log(`📄 Document: ${mediaUrl}`);
          resp = await sendFile({ 
            to, 
            fileUrl: mediaUrl, 
            caption: step.caption || '' 
          });
        }
      } else if (step.type === 'template') {
        console.log(`📋 Template: ${step.templateName} (${step.language})`);
        resp = await sendTemplate({
          to,
          templateName: step.templateName,
          language: step.language || 'en_US'
        });
      } else {
        throw new Error(`Unknown type: ${step.type}`);
      }

      // Log success
      await MessageLog.create({
        tenantId: campaign.tenantId,
        campaignId: campaign._id,
        contactId: contact._id,
        provider: 'meta',
        provider_message_id: resp?.messages?.[0]?.id || resp?.id || null,
        to: contact.phone,
        direction: 'outbound',
        type: messageType,
        status: 'sent',
        payload: resp,
        caption: step.caption || null,
        stepTime: step.stepTime,
        stepSequence: step.sequence,
        stepDay: step.day
      });

      console.log(`✅ Sent to ${to}`);

      // Update progress for fixed campaigns
      if (campaign.campaignType === 'fixed' && progress) {
        await this.updateCampaignProgress(campaign, contact, step, progress);
      }

    } catch (err) {
      console.error(`❌ Error for ${contact.phone}:`, err.message);
      
      // Log failure
      await MessageLog.create({
        tenantId: campaign.tenantId,
        campaignId: campaign._id,
        contactId: contact._id,
        provider: 'meta',
        to: contact.phone,
        direction: 'outbound',
        type: step.type,
        status: 'failed',
        error: err.message,
        stepTime: step.stepTime,
        stepSequence: step.sequence,
        stepDay: step.day
      });
    }
  }

  async updateCampaignProgress(campaign, contact, step, progress = null) {
    try {
      if (!progress) {
        progress = await CampaignProgress.findOne({
          campaignId: campaign._id,
          contactId: contact._id
        });
      }

      if (!progress) {
        console.log(`⚠️ No progress found`);
        return;
      }

      // Check conditions
      if (step.condition === 'if_replied' && !progress.hasReplied) {
        console.log(`⏭️ Skipping - contact hasn't replied`);
        return;
      }

      if (step.condition === 'if_not_replied' && progress.hasReplied) {
        console.log(`⏭️ Skipping - contact has replied`);
        return;
      }

      // Add to current day steps
      progress.currentDaySteps.push({
        stepId: step._id,
        sequence: step.sequence,
        stepTime: step.stepTime,
        sentAt: new Date(),
        status: 'sent'
      });

      // Add to completed steps
      progress.completedSteps.push({
        day: step.day,
        stepId: step._id,
        sequence: step.sequence,
        stepTime: step.stepTime,
        sentAt: new Date(),
        status: 'sent'
      });

      progress.lastInteraction = new Date();

      // Check if day completed
      const totalDaySteps = await CampaignStep.countDocuments({ 
        campaignId: campaign._id,
        day: progress.currentDay 
      });

      console.log(`📊 Day ${progress.currentDay}: ${progress.currentDaySteps.length}/${totalDaySteps} done`);

      if (progress.currentDaySteps.length >= totalDaySteps) {
        console.log(`🎉 Day ${progress.currentDay} completed`);
        
        // Move to next day
        progress.currentDay += 1;
        progress.currentDaySteps = [];
        
        // Check if campaign completed
        if (progress.currentDay > campaign.totalDays) {
          progress.status = 'completed';
          progress.completedAt = new Date();
          console.log(`🏁 Campaign completed for ${contact.phone}`);
        } else {
          // Schedule next day steps
          console.log(`📅 Moving to Day ${progress.currentDay}`);
          
          const nextDaySteps = await CampaignStep.find({ 
            campaignId: campaign._id,
            day: progress.currentDay 
          }).sort({ sequence: 1 });

          console.log(`📋 Next day steps: ${nextDaySteps.length}`);
          
          for (const nextStep of nextDaySteps) {
            await this.scheduleStepForContact(nextStep, contact, campaign, progress);
          }
        }
      }

      await progress.save();
      console.log(`✅ Progress updated`);
      
    } catch (error) {
      console.error('❌ Progress update error:', error);
    }
  }

      // Check step condition
      if (step.condition === 'if_replied' && !progress.hasReplied) {
        console.log(`Skipping step ${step.sequence} for ${contact.phone} - contact hasn't replied`);
        return;
      }

      if (step.condition === 'if_not_replied' && progress.hasReplied) {
        console.log(`Skipping step ${step.sequence} for ${contact.phone} - contact has replied`);
        return;
      }

      // Add step to completed steps
      progress.completedSteps.push({
        stepId: step._id,
        sequence: step.sequence,
        sentAt: new Date(),
        status: 'sent'
      });

      progress.currentStepIndex = step.sequence;
      progress.lastInteraction = new Date();

      // Check if all steps are completed
      const totalSteps = await CampaignStep.countDocuments({ campaignId: campaign._id });
      if (progress.currentStepIndex >= totalSteps) {
        progress.status = 'completed';
        progress.completedAt = new Date();
      }

      await progress.save();
    } catch (error) {
      console.error('Error updating campaign progress:', error);
    }
  }

  unscheduleCampaign(campaignId) {
    // Remove all jobs for this campaign
    const jobKeys = Array.from(this.scheduledJobs.keys());
    jobKeys.forEach(key => {
      if (key.startsWith(campaignId)) {
        const job = this.scheduledJobs.get(key);
        if (job) {
          job.stop();
          this.scheduledJobs.delete(key);
        }
      }
    });
  }

  getNextExecutionTime(campaign) {
    const now = new Date();
    
    switch (campaign.campaignType) {
      case 'daily':
        const [dailyHour, dailyMinute] = campaign.dailyTime.split(':');
        const dailyDate = new Date();
        dailyDate.setHours(dailyHour, dailyMinute, 0, 0);
        if (dailyDate <= now) {
          dailyDate.setDate(dailyDate.getDate() + 1);
        }
        return dailyDate;
        
      case 'weekly':
        const [weeklyHour, weeklyMinute] = campaign.weeklyTime.split(':');
        const nextDay = this.getNextWeekday(campaign.weeklyDays, now);
        const weeklyDate = new Date(nextDay);
        weeklyDate.setHours(weeklyHour, weeklyMinute, 0, 0);
        return weeklyDate;
        
      case 'monthly':
        const [monthlyHour, monthlyMinute] = campaign.monthlyTime.split(':');
        const nextDate = this.getNextMonthlyDate(campaign.monthlyDates, now);
        const monthlyDate = new Date(nextDate);
        monthlyDate.setHours(monthlyHour, monthlyMinute, 0, 0);
        return monthlyDate;
        
      default:
        return null;
    }
  }

  getNextWeekday(days, fromDate) {
    const sortedDays = [...days].sort((a, b) => a - b);
    const currentDay = fromDate.getDay();
    
    for (const day of sortedDays) {
      if (day > currentDay) {
        const nextDate = new Date(fromDate);
        nextDate.setDate(fromDate.getDate() + (day - currentDay));
        return nextDate;
      }
    }
    
    // If no day found in current week, take first day of next week
    const firstDay = sortedDays[0];
    const nextDate = new Date(fromDate);
    nextDate.setDate(fromDate.getDate() + (7 - currentDay + firstDay));
    return nextDate;
  }

  getNextMonthlyDate(dates, fromDate) {
    const currentDate = fromDate.getDate();
    const currentMonth = fromDate.getMonth();
    const currentYear = fromDate.getFullYear();
    
    // Sort dates
    const sortedDates = [...dates].sort((a, b) => a - b);
    
    // Find next date in current month
    for (const date of sortedDates) {
      if (date > currentDate) {
        const nextDate = new Date(currentYear, currentMonth, date);
        return nextDate;
      }
    }
    
    // If no date found in current month, take first date of next month
    const firstDate = sortedDates[0];
    const nextDate = new Date(currentYear, currentMonth + 1, firstDate);
    return nextDate;
  }

  // Initialize scheduler with existing active campaigns
  async init() {
    try {
      const activeCampaigns = await Campaign.find({ 
        status: 'active',
        campaignType: { $in: ['daily', 'weekly', 'monthly'] }
      });
      
      console.log(`Scheduling ${activeCampaigns.length} active campaigns...`);
      
      for (const campaign of activeCampaigns) {
        await this.scheduleCampaign(campaign._id);
      }
      
      console.log('Campaign scheduler initialized');
    } catch (error) {
      console.error('Error initializing campaign scheduler:', error);
    }
  }
}

module.exports = new CampaignScheduler();