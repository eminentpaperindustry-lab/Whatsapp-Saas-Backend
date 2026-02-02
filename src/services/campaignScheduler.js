const cron = require('node-cron');
const moment = require('moment-timezone');
const Campaign = require('../models/Campaign');
const CampaignStep = require('../models/CampaignStep');
const Contact = require('../models/Contact');
const CampaignProgress = require('../models/CampaignProgress');
const MessageLog = require('../models/MessageLog');
const { sendText, sendImage, sendVideo, sendFile, sendTemplate } = require('./whatsapp');

class CampaignScheduler {
  constructor() {
    this.scheduledJobs = new Map();
    this.timeoutJobs = new Map();
    this.activeCampaigns = new Map();
    
    console.log('🚀 Campaign Scheduler Initialized');
    console.log('🕐 Server Time:', moment().tz('Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss'));
    console.log('🇮🇳 Timezone: Asia/Kolkata (IST)');
  }

  // ============================================
  // MAIN: START CAMPAIGN
  // ============================================

  async startCampaign(campaignId) {
    try {
      console.log(`\n🎯 STARTING CAMPAIGN: ${campaignId}`);
      
      const campaign = await Campaign.findById(campaignId).populate('sectionIds');
      if (!campaign) {
        console.log(`❌ Campaign not found`);
        return;
      }

      console.log(`📋 Campaign: ${campaign.name}, Type: ${campaign.campaignType}`);

      if (campaign.status !== 'active') {
        console.log(`⚠️ Campaign not active: ${campaign.status}`);
        return;
      }

      // Stop existing jobs
      this.stopCampaign(campaignId);

      // Setup based on campaign type
      switch (campaign.campaignType) {
        case 'daily':
          await this.setupDailyCampaign(campaign);
          break;
        case 'weekly':
          await this.setupWeeklyCampaign(campaign);
          break;
        case 'monthly':
          await this.setupMonthlyCampaign(campaign);
          break;
        case 'fixed':
          await this.setupFixedCampaign(campaign);
          break;
        case 'content_based':
          console.log('🎯 Content-based campaign - manual only');
          break;
      }

      this.activeCampaigns.set(campaignId.toString(), {
        id: campaignId,
        name: campaign.name,
        type: campaign.campaignType,
        startedAt: new Date()
      });

      console.log(`✅ Campaign "${campaign.name}" started successfully`);
      
    } catch (error) {
      console.error('❌ Error starting campaign:', error);
    }
  }

  // ============================================
  // DAILY CAMPAIGN: SIMPLE & RELIABLE
  // ============================================

  async setupDailyCampaign(campaign) {
    try {
      console.log(`\n📅 SETUP DAILY CAMPAIGN: ${campaign.name}`);
      
      const steps = await CampaignStep.find({ campaignId: campaign._id })
        .sort({ sequence: 1 });

      console.log(`📊 Steps: ${steps.length}`);

      if (steps.length === 0) {
        console.log('⚠️ No steps defined');
        return;
      }

      // Schedule each step
      for (const step of steps) {
        const stepTime = step.stepTime || '09:00';
        const [hour, minute] = stepTime.split(':').map(Number);
        
        // IMPORTANT: Use Indian timezone directly
        // Cron pattern: minute hour * * *
        const cronPattern = `${minute} ${hour} * * *`;
        const jobId = `daily_${campaign._id}_${step._id}`;
        
        console.log(`⏰ Step ${step.sequence}: Daily at ${stepTime} IST`);

        const job = cron.schedule(cronPattern, async () => {
          console.log(`\n🚀 DAILY EXECUTION: ${campaign.name} - Step ${step.sequence}`);
          console.log(`🕐 Time: ${moment().tz('Asia/Kolkata').format('HH:mm:ss')}`);
          await this.executeStepForAllContacts(step, campaign);
        }, {
          scheduled: true,
          timezone: "Asia/Kolkata"
        });

        this.scheduledJobs.set(jobId, job);
        console.log(`✅ Scheduled with cron: ${cronPattern}`);
      }
      
      console.log(`✅ Daily campaign setup complete: ${steps.length} steps`);
      
    } catch (error) {
      console.error('❌ Error setting up daily campaign:', error);
    }
  }

  // ============================================
  // WEEKLY CAMPAIGN: FIXED & RELIABLE
  // ============================================

  async setupWeeklyCampaign(campaign) {
    try {
      console.log(`\n📅 SETUP WEEKLY CAMPAIGN: ${campaign.name}`);
      
      const steps = await CampaignStep.find({ campaignId: campaign._id })
        .sort({ sequence: 1 });

      if (steps.length === 0) {
        console.log('⚠️ No steps defined');
        return;
      }

      // Group steps by dayOfWeek
      const stepsByDay = {};
      steps.forEach(step => {
        if (step.dayOfWeek !== null && step.dayOfWeek !== undefined) {
          if (!stepsByDay[step.dayOfWeek]) stepsByDay[step.dayOfWeek] = [];
          stepsByDay[step.dayOfWeek].push(step);
        }
      });

      console.log(`📆 Steps grouped by days: ${Object.keys(stepsByDay).length}`);

      // Schedule for each day
      for (const [dayOfWeek, daySteps] of Object.entries(stepsByDay)) {
        const dayName = this.getDayName(parseInt(dayOfWeek));
        
        // Group steps by time
        const stepsByTime = {};
        daySteps.forEach(step => {
          if (!stepsByTime[step.stepTime]) stepsByTime[step.stepTime] = [];
          stepsByTime[step.stepTime].push(step);
        });

        // Schedule each time slot
        for (const [stepTime, timeSteps] of Object.entries(stepsByTime)) {
          const [hour, minute] = stepTime.split(':').map(Number);
          
          // IMPORTANT: Weekly cron pattern
          // minute hour * * dayOfWeek (0-6, 0=Sunday)
          const cronPattern = `${minute} ${hour} * * ${dayOfWeek}`;
          const jobId = `weekly_${campaign._id}_${dayOfWeek}_${stepTime.replace(':', '')}`;
          
          console.log(`⏰ ${dayName} at ${stepTime}: ${timeSteps.length} steps`);

          const job = cron.schedule(cronPattern, async () => {
            console.log(`\n🚀 WEEKLY EXECUTION: ${campaign.name} - ${dayName} at ${stepTime}`);
            console.log(`📅 Day: ${dayName}, Time: ${moment().tz('Asia/Kolkata').format('HH:mm:ss')}`);
            
            // Execute all steps for this time
            for (const step of timeSteps.sort((a, b) => a.sequence - b.sequence)) {
              await this.executeStepForAllContacts(step, campaign);
              await this.sleep(1000); // Small delay between steps
            }
          }, {
            scheduled: true,
            timezone: "Asia/Kolkata"
          });

          this.scheduledJobs.set(jobId, job);
          console.log(`✅ ${dayName} at ${stepTime} scheduled (cron: ${cronPattern})`);
        }
      }
      
      console.log(`✅ Weekly campaign setup complete`);
      
    } catch (error) {
      console.error('❌ Error setting up weekly campaign:', error);
    }
  }

  // ============================================
  // MONTHLY CAMPAIGN: FIXED & RELIABLE
  // ============================================

  async setupMonthlyCampaign(campaign) {
    try {
      console.log(`\n📅 SETUP MONTHLY CAMPAIGN: ${campaign.name}`);
      
      const steps = await CampaignStep.find({ campaignId: campaign._id })
        .sort({ sequence: 1 });

      if (steps.length === 0) {
        console.log('⚠️ No steps defined');
        return;
      }

      // Group steps by dayOfMonth
      const stepsByDate = {};
      steps.forEach(step => {
        if (step.dayOfMonth !== null && step.dayOfMonth !== undefined) {
          if (!stepsByDate[step.dayOfMonth]) stepsByDate[step.dayOfMonth] = [];
          stepsByDate[step.dayOfMonth].push(step);
        }
      });

      console.log(`📅 Steps grouped by dates: ${Object.keys(stepsByDate).length}`);

      // Schedule for each date
      for (const [dayOfMonth, dateSteps] of Object.entries(stepsByDate)) {
        // Group steps by time
        const stepsByTime = {};
        dateSteps.forEach(step => {
          if (!stepsByTime[step.stepTime]) stepsByTime[step.stepTime] = [];
          stepsByTime[step.stepTime].push(step);
        });

        // Schedule each time slot
        for (const [stepTime, timeSteps] of Object.entries(stepsByTime)) {
          const [hour, minute] = stepTime.split(':').map(Number);
          
          // IMPORTANT: Monthly cron pattern
          // minute hour dayOfMonth * *
          const cronPattern = `${minute} ${hour} ${dayOfMonth} * *`;
          const jobId = `monthly_${campaign._id}_${dayOfMonth}_${stepTime.replace(':', '')}`;
          
          console.log(`⏰ Date ${dayOfMonth} at ${stepTime}: ${timeSteps.length} steps`);

          const job = cron.schedule(cronPattern, async () => {
            console.log(`\n🚀 MONTHLY EXECUTION: ${campaign.name} - Date ${dayOfMonth} at ${stepTime}`);
            console.log(`📅 Date: ${dayOfMonth}, Time: ${moment().tz('Asia/Kolkata').format('HH:mm:ss')}`);
            
            // Execute all steps for this time
            for (const step of timeSteps.sort((a, b) => a.sequence - b.sequence)) {
              await this.executeStepForAllContacts(step, campaign);
              await this.sleep(1000);
            }
          }, {
            scheduled: true,
            timezone: "Asia/Kolkata"
          });

          this.scheduledJobs.set(jobId, job);
          console.log(`✅ Date ${dayOfMonth} at ${stepTime} scheduled (cron: ${cronPattern})`);
        }
      }
      
      console.log(`✅ Monthly campaign setup complete`);
      
    } catch (error) {
      console.error('❌ Error setting up monthly campaign:', error);
    }
  }

  // ============================================
  // FIXED CAMPAIGN: SIMPLIFIED VERSION
  // ============================================

  async setupFixedCampaign(campaign) {
    try {
      console.log(`\n📅 SETUP FIXED CAMPAIGN: ${campaign.name}`);
      
      const steps = await CampaignStep.find({ campaignId: campaign._id })
        .sort({ day: 1, sequence: 1 });
      
      console.log(`📊 Total steps: ${steps.length}`);
      
      if (steps.length === 0) {
        console.log('⚠️ No steps defined');
        return;
      }

      // Get contacts
      let contacts = [];
      if (campaign.sectionIds && campaign.sectionIds.length > 0) {
        for (const sectionId of campaign.sectionIds) {
          const sectionContacts = await Contact.find({ 
            tenantId: campaign.tenantId,
            section: sectionId 
          });
          contacts = contacts.concat(sectionContacts);
        }
      }

      const uniqueContacts = Array.from(new Set(contacts.map(c => c._id.toString())))
        .map(id => contacts.find(c => c._id.toString() === id));

      console.log(`👥 Contacts: ${uniqueContacts.length}`);

      if (uniqueContacts.length === 0) {
        console.log('❌ No contacts found');
        return;
      }

      // Schedule for each contact
      for (const contact of uniqueContacts) {
        await this.setupFixedCampaignForContact(campaign, contact, steps);
      }
      
    } catch (error) {
      console.error('❌ Error setting up fixed campaign:', error);
    }
  }

  async setupFixedCampaignForContact(campaign, contact, steps) {
    try {
      console.log(`\n👤 SETUP FOR: ${contact.phone}`);
      
      // Get or create progress
      let progress = await CampaignProgress.findOne({
        campaignId: campaign._id,
        contactId: contact._id
      });

      if (!progress) {
        console.log(`📝 Creating new progress`);
        progress = new CampaignProgress({
          campaignId: campaign._id,
          contactId: contact._id,
          tenantId: campaign.tenantId,
          currentDay: 1,
          status: 'active',
          startedAt: new Date(),
          currentDaySteps: [],
          completedSteps: []
        });
        await progress.save();
      }

      if (progress.status === 'completed') {
        console.log(`✅ Already completed`);
        return;
      }

      // Get steps for current day
      const currentDay = progress.currentDay;
      const daySteps = steps.filter(s => s.day === currentDay)
        .sort((a, b) => a.sequence - b.sequence);

      console.log(`📅 Day ${currentDay} steps: ${daySteps.length}`);

      // Schedule each step
      for (const step of daySteps) {
        await this.scheduleFixedStep(step, contact, campaign, progress);
      }
      
    } catch (error) {
      console.error(`❌ Error setting up for ${contact.phone}:`, error);
    }
  }

  async scheduleFixedStep(step, contact, campaign, progress) {
    try {
      const [hour, minute] = step.stepTime.split(':').map(Number);
      
      // Calculate when to send (today + (step.day - currentDay))
      const daysToAdd = step.day - progress.currentDay;
      const targetDate = moment().tz('Asia/Kolkata').add(daysToAdd, 'days');
      targetDate.hours(hour);
      targetDate.minutes(minute);
      targetDate.seconds(0);
      
      const now = moment().tz('Asia/Kolkata');
      const delayMs = targetDate.valueOf() - now.valueOf();
      
      if (delayMs <= 0) {
        console.log(`⚠️ Time passed, executing now`);
        await this.executeStepForContact(step, contact, campaign, progress);
        return;
      }
      
      console.log(`⏰ Step ${step.sequence}: Day ${step.day} at ${step.stepTime}`);
      console.log(`📅 Will execute in ${Math.round(delayMs/1000/60)} minutes`);
      
      const jobId = `${campaign._id}_${contact._id}_${step._id}`;
      
      const timeoutId = setTimeout(async () => {
        console.log(`\n🚀 EXECUTING FIXED STEP ${step.sequence} for ${contact.phone}`);
        console.log(`📅 Day ${step.day}, Time: ${step.stepTime}`);
        
        try {
          await this.executeStepForContact(step, contact, campaign, progress);
          this.timeoutJobs.delete(jobId);
        } catch (error) {
          console.error(`❌ Execution error:`, error);
        }
      }, delayMs);
      
      this.timeoutJobs.set(jobId, timeoutId);
      
      // Update progress
      progress.currentDaySteps.push({
        stepId: step._id,
        sequence: step.sequence,
        stepTime: step.stepTime,
        scheduledAt: new Date(),
        status: 'scheduled'
      });
      
      await progress.save();
      
    } catch (error) {
      console.error('❌ Error scheduling fixed step:', error);
    }
  }

  // ============================================
  // EXECUTION ENGINE (COMMON FOR ALL)
  // ============================================

  async executeStepForAllContacts(step, campaign) {
    try {
      console.log(`\n🎯 EXECUTING STEP ${step.sequence} for all contacts`);
      
      // Get contacts
      let contacts = [];
      if (campaign.sectionIds && campaign.sectionIds.length > 0) {
        for (const sectionId of campaign.sectionIds) {
          const sectionContacts = await Contact.find({ 
            tenantId: campaign.tenantId,
            section: sectionId 
          });
          contacts = contacts.concat(sectionContacts);
        }
      }

      const uniqueContacts = Array.from(new Set(contacts.map(c => c._id.toString())))
        .map(id => contacts.find(c => c._id.toString() === id));

      console.log(`📞 Total contacts: ${uniqueContacts.length}`);

      if (uniqueContacts.length === 0) {
        console.log('⚠️ No contacts found');
        return;
      }

      // Process in batches
      const batchSize = 5;
      let successCount = 0;
      let failureCount = 0;

      for (let i = 0; i < uniqueContacts.length; i += batchSize) {
        const batch = uniqueContacts.slice(i, i + batchSize);
        
        console.log(`📦 Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(uniqueContacts.length/batchSize)}`);
        
        const batchPromises = batch.map(contact => 
          this.sendToSingleContact(step, contact, campaign).catch(error => {
            console.error(`❌ Error for ${contact.phone}:`, error.message);
            return { success: false, error: error.message };
          })
        );
        
        const results = await Promise.allSettled(batchPromises);
        
        results.forEach(result => {
          if (result.status === 'fulfilled' && result.value && result.value.success) {
            successCount++;
          } else {
            failureCount++;
          }
        });
        
        // Delay between batches
        if (i + batchSize < uniqueContacts.length) {
          await this.sleep(2000);
        }
      }

      console.log(`✅ Execution complete: ${successCount} ✅, ${failureCount} ❌`);
      
      // Update campaign stats
      await Campaign.findByIdAndUpdate(campaign._id, {
        $inc: { executedCount: 1 },
        $set: { lastExecutionDate: new Date() }
      });
      
    } catch (error) {
      console.error('❌ Error executing step:', error);
    }
  }

  async executeStepForContact(step, contact, campaign, progress) {
    try {
      const result = await this.sendToSingleContact(step, contact, campaign);
      
      if (result.success && campaign.campaignType === 'fixed') {
        await this.updateFixedProgress(step, contact, campaign, progress);
      }
      
      return result;
      
    } catch (error) {
      console.error(`❌ Error executing for ${contact.phone}:`, error);
      return { success: false, error: error.message };
    }
  }

  async sendToSingleContact(step, contact, campaign) {
    try {
      const to = contact.phone.replace(/\+/g, '');
      
      let response = null;
      let messageType = step.type;

      if (step.type === 'text') {
        response = await sendText({ to, body: step.body });
      } else if (step.type === 'media') {
        const mediaUrl = step.mediaUrl;
        if (mediaUrl.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
          messageType = 'image';
          response = await sendImage({ 
            to, 
            imageUrl: mediaUrl, 
            caption: step.caption || '' 
          });
        } else if (mediaUrl.match(/\.(mp4|avi|mov|wmv)$/i)) {
          messageType = 'video';
          response = await sendVideo({ 
            to, 
            videoUrl: mediaUrl, 
            caption: step.caption || '' 
          });
        } else {
          messageType = 'document';
          response = await sendFile({ 
            to, 
            fileUrl: mediaUrl, 
            caption: step.caption || '' 
          });
        }
      } else if (step.type === 'template') {
        response = await sendTemplate({
          to,
          templateName: step.templateName,
          language: step.language || 'en_US'
        });
      }

      // Log success
      await MessageLog.create({
        tenantId: campaign.tenantId,
        campaignId: campaign._id,
        contactId: contact._id,
        provider: 'meta',
        to: contact.phone,
        direction: 'outbound',
        type: messageType,
        status: 'sent',
        stepTime: step.stepTime,
        stepSequence: step.sequence,
        stepDay: step.day,
        timestamp: new Date()
      });

      console.log(`✅ Sent to ${contact.phone}`);
      return { success: true, contact: contact.phone };
      
    } catch (error) {
      console.error(`❌ Send failed for ${contact.phone}:`, error.message);
      
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
        error: error.message,
        timestamp: new Date()
      });
      
      throw error;
    }
  }

  async updateFixedProgress(step, contact, campaign, progress) {
    try {
      // Mark as sent
      const stepIndex = progress.currentDaySteps.findIndex(
        s => s.stepId?.toString() === step._id.toString()
      );
      
      if (stepIndex !== -1) {
        progress.currentDaySteps[stepIndex].status = 'sent';
        progress.currentDaySteps[stepIndex].sentAt = new Date();
      }

      progress.completedSteps.push({
        day: step.day,
        stepId: step._id,
        sequence: step.sequence,
        stepTime: step.stepTime,
        sentAt: new Date(),
        status: 'sent'
      });

      progress.lastInteraction = new Date();
      
      // Check if all steps for current day are done
      const sentSteps = progress.currentDaySteps.filter(s => s.status === 'sent').length;
      const totalStepsForDay = await CampaignStep.countDocuments({
        campaignId: campaign._id,
        day: progress.currentDay
      });
      
      if (sentSteps >= totalStepsForDay) {
        console.log(`🎉 Day ${progress.currentDay} completed for ${contact.phone}`);
        
        // Move to next day
        progress.currentDay += 1;
        progress.currentDaySteps = [];
        
        if (progress.currentDay > campaign.totalDays) {
          progress.status = 'completed';
          progress.completedAt = new Date();
          console.log(`🏁 Campaign completed for ${contact.phone}`);
        }
      }

      await progress.save();
      
    } catch (error) {
      console.error('❌ Error updating progress:', error);
    }
  }

  // ============================================
  // HELPER FUNCTIONS
  // ============================================

  getDayName(dayNumber) {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days[dayNumber] || `Day ${dayNumber}`;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ============================================
  // CONTROL FUNCTIONS
  // ============================================

  stopCampaign(campaignId) {
    console.log(`\n🛑 STOPPING CAMPAIGN: ${campaignId}`);
    
    let stoppedCount = 0;
    
    // Stop cron jobs
    this.scheduledJobs.forEach((job, key) => {
      if (key.startsWith(campaignId.toString())) {
        job.stop();
        this.scheduledJobs.delete(key);
        stoppedCount++;
      }
    });
    
    // Clear timeouts
    this.timeoutJobs.forEach((timeout, key) => {
      if (key.startsWith(campaignId.toString())) {
        clearTimeout(timeout);
        this.timeoutJobs.delete(key);
        stoppedCount++;
      }
    });
    
    // Remove from active
    this.activeCampaigns.delete(campaignId.toString());
    
    console.log(`✅ Stopped ${stoppedCount} jobs`);
  }

  pauseCampaign(campaignId) {
    console.log(`\n⏸️ PAUSING CAMPAIGN: ${campaignId}`);
    
    this.scheduledJobs.forEach((job, key) => {
      if (key.startsWith(campaignId.toString())) {
        job.stop();
      }
    });
    
    console.log(`✅ Campaign paused`);
  }

  unscheduleStep(stepId) {
    console.log(`\n🗑️ UNSCHEDULING STEP: ${stepId}`);
    
    let removed = 0;
    
    this.scheduledJobs.forEach((job, key) => {
      if (key.includes(stepId)) {
        job.stop();
        this.scheduledJobs.delete(key);
        removed++;
      }
    });
    
    this.timeoutJobs.forEach((timeout, key) => {
      if (key.includes(stepId)) {
        clearTimeout(timeout);
        this.timeoutJobs.delete(key);
        removed++;
      }
    });
    
    console.log(`✅ Removed ${removed} jobs`);
  }

  // ============================================
  // FOR ROUTES
  // ============================================

  async scheduleStepForCampaign(step, campaign) {
    try {
      console.log(`\n📅 SCHEDULING NEW STEP: ${step.sequence}`);
      
      if (campaign.status !== 'active') {
        console.log('⚠️ Campaign not active');
        return;
      }
      
      switch (campaign.campaignType) {
        case 'daily':
          await this.scheduleDailyStep(step, campaign);
          break;
        case 'weekly':
          await this.scheduleWeeklyStep(step, campaign);
          break;
        case 'monthly':
          await this.scheduleMonthlyStep(step, campaign);
          break;
        case 'fixed':
          await this.scheduleFixedStepForAll(step, campaign);
          break;
      }
      
    } catch (error) {
      console.error('❌ Error scheduling step:', error);
    }
  }

  async scheduleDailyStep(step, campaign) {
    const stepTime = step.stepTime || '09:00';
    const [hour, minute] = stepTime.split(':').map(Number);
    
    const cronPattern = `${minute} ${hour} * * *`;
    const jobId = `daily_${campaign._id}_${step._id}`;
    
    console.log(`⏰ New daily step at ${stepTime}`);
    
    const job = cron.schedule(cronPattern, async () => {
      await this.executeStepForAllContacts(step, campaign);
    }, {
      scheduled: true,
      timezone: "Asia/Kolkata"
    });
    
    this.scheduledJobs.set(jobId, job);
  }

  async scheduleWeeklyStep(step, campaign) {
    if (step.dayOfWeek === null || step.dayOfWeek === undefined) {
      console.log('❌ Weekly step requires dayOfWeek');
      return;
    }
    
    const stepTime = step.stepTime || '09:00';
    const [hour, minute] = stepTime.split(':').map(Number);
    const dayName = this.getDayName(step.dayOfWeek);
    
    const cronPattern = `${minute} ${hour} * * ${step.dayOfWeek}`;
    const jobId = `weekly_${campaign._id}_${step.dayOfWeek}_${stepTime.replace(':', '')}`;
    
    console.log(`⏰ New weekly step: ${dayName} at ${stepTime}`);
    
    const job = cron.schedule(cronPattern, async () => {
      await this.executeStepForAllContacts(step, campaign);
    }, {
      scheduled: true,
      timezone: "Asia/Kolkata"
    });
    
    this.scheduledJobs.set(jobId, job);
  }

  async scheduleMonthlyStep(step, campaign) {
    if (step.dayOfMonth === null || step.dayOfMonth === undefined) {
      console.log('❌ Monthly step requires dayOfMonth');
      return;
    }
    
    const stepTime = step.stepTime || '09:00';
    const [hour, minute] = stepTime.split(':').map(Number);
    
    const cronPattern = `${minute} ${hour} ${step.dayOfMonth} * *`;
    const jobId = `monthly_${campaign._id}_${step.dayOfMonth}_${stepTime.replace(':', '')}`;
    
    console.log(`⏰ New monthly step: Date ${step.dayOfMonth} at ${stepTime}`);
    
    const job = cron.schedule(cronPattern, async () => {
      await this.executeStepForAllContacts(step, campaign);
    }, {
      scheduled: true,
      timezone: "Asia/Kolkata"
    });
    
    this.scheduledJobs.set(jobId, job);
  }

  async scheduleFixedStepForAll(step, campaign) {
    // Get all contacts and schedule for each
    let contacts = [];
    if (campaign.sectionIds && campaign.sectionIds.length > 0) {
      for (const sectionId of campaign.sectionIds) {
        const sectionContacts = await Contact.find({ 
          tenantId: campaign.tenantId,
          section: sectionId 
        });
        contacts = contacts.concat(sectionContacts);
      }
    }

    for (const contact of contacts) {
      let progress = await CampaignProgress.findOne({
        campaignId: campaign._id,
        contactId: contact._id
      });
      
      if (!progress) {
        progress = new CampaignProgress({
          campaignId: campaign._id,
          contactId: contact._id,
          tenantId: campaign.tenantId,
          currentDay: step.day,
          status: 'active',
          startedAt: new Date(),
          currentDaySteps: [],
          completedSteps: []
        });
        await progress.save();
      }
      
      await this.scheduleFixedStep(step, contact, campaign, progress);
    }
  }

  // ============================================
  // DEBUG & MONITORING
  // ============================================

  listScheduledJobs() {
    console.log('\n📋 SCHEDULER STATUS');
    console.log('='.repeat(50));
    
    console.log(`\n🏃 Active Campaigns: ${this.activeCampaigns.size}`);
    this.activeCampaigns.forEach((campaign, id) => {
      console.log(`  • ${campaign.name} (${campaign.type})`);
    });
    
    console.log(`\n⏰ Cron Jobs: ${this.scheduledJobs.size}`);
    this.scheduledJobs.forEach((job, key) => {
      console.log(`  • ${key}`);
    });
    
    console.log(`\n⏳ Timeout Jobs: ${this.timeoutJobs.size}`);
    
    console.log(`\n🕐 Current Time: ${moment().tz('Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss')}`);
    console.log('='.repeat(50));
  }

  async testStep(campaignId, stepId) {
    try {
      const campaign = await Campaign.findById(campaignId);
      if (!campaign) return { success: false, message: 'Campaign not found' };
      
      const step = await CampaignStep.findById(stepId);
      if (!step) return { success: false, message: 'Step not found' };
      
      // Get first contact
      let contact = null;
      if (campaign.sectionIds && campaign.sectionIds.length > 0) {
        const contacts = await Contact.find({ 
          tenantId: campaign.tenantId,
          section: campaign.sectionIds[0] 
        }).limit(1);
        
        if (contacts.length > 0) {
          contact = contacts[0];
        }
      }
      
      if (!contact) return { success: false, message: 'No contacts' };
      
      console.log(`🧪 Testing step ${step.sequence} with ${contact.phone}`);
      
      const result = await this.sendToSingleContact(step, contact, campaign);
      
      return { 
        success: result.success, 
        message: result.success ? 'Test successful' : 'Test failed',
        contact: contact.phone
      };
      
    } catch (error) {
      console.error('❌ Test error:', error);
      return { success: false, message: error.message };
    }
  }

  // ============================================
  // INITIALIZATION
  // ============================================

  async init() {
    try {
      console.log('\n' + '='.repeat(50));
      console.log('🚀 INITIALIZING CAMPAIGN SCHEDULER');
      console.log('='.repeat(50));
      
      const activeCampaigns = await Campaign.find({ status: 'active' });
      
      console.log(`📊 Found ${activeCampaigns.length} active campaigns`);
      
      for (const campaign of activeCampaigns) {
        console.log(`\n🔄 Setting up: ${campaign.name}`);
        await this.startCampaign(campaign._id);
      }
      
      this.startMonitoring();
      
      console.log('\n' + '='.repeat(50));
      console.log('✅ SCHEDULER INITIALIZED');
      console.log('='.repeat(50));
      
    } catch (error) {
      console.error('❌ Initialization error:', error);
    }
  }

  startMonitoring() {
    setInterval(() => {
      console.log('\n📊 SCHEDULER MONITOR');
      console.log(`⏰ Cron Jobs: ${this.scheduledJobs.size}`);
      console.log(`⏳ Timeout Jobs: ${this.timeoutJobs.size}`);
      console.log(`🏃 Active Campaigns: ${this.activeCampaigns.size}`);
      console.log(`🕐 Time: ${moment().tz('Asia/Kolkata').format('HH:mm:ss')}`);
    }, 300000); // 5 minutes
  }
}

module.exports = new CampaignScheduler();