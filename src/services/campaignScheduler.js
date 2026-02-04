const cron = require('node-cron');
const moment = require('moment-timezone');
const mongoose = require('mongoose');
const Campaign = require('../models/Campaign');
const CampaignStep = require('../models/CampaignStep');
const Contact = require('../models/Contact');
const CampaignProgress = require('../models/CampaignProgress');
const MessageLog = require('../models/MessageLog');
const { sendText, sendImage, sendVideo, sendFile, sendTemplate } = require('./whatsapp');
const campaignProcessor = require('./campaignProcessor');

class CampaignScheduler {
  constructor() {
    this.scheduledJobs = new Map();
    this.timeoutJobs = new Map();
    this.activeCampaigns = new Map();
    this.isInitialized = false;
    this.executionHistory = new Map();
    
    console.log('🚀 Campaign Scheduler Initialized - NO DUPLICATES');
    console.log('🕐 Timezone: Asia/Kolkata');
    
    moment.tz.setDefault('Asia/Kolkata');
  }

  async init() {
    try {
      if (this.isInitialized) {
        console.log('⚠️ Scheduler already initialized');
        return;
      }
      
      console.log('\n' + '='.repeat(60));
      console.log('🚀 INITIALIZING CAMPAIGN SCHEDULER');
      console.log('🔒 DUPLICATE PREVENTION: ENABLED');
      console.log('🚫 NO PAST MESSAGES WILL BE SENT');
      console.log('='.repeat(60));
      
      // Wait for MongoDB connection
      await this.waitForMongoConnection();
      
      // Initialize campaign processor
      await campaignProcessor.init();
      
      // Get ALL active campaigns
      const activeCampaigns = await Campaign.find({ status: 'active' });
      
      console.log(`📊 Found ${activeCampaigns.length} active campaigns`);
      
      // Setup each campaign (FUTURE SCHEDULES ONLY)
      for (const campaign of activeCampaigns) {
        console.log(`\n🔄 Setting up FUTURE schedules: ${campaign.name}`);
        await this.setupCampaign(campaign);
      }
      
      // Start monitoring
      this.startMonitoring();
      
      this.isInitialized = true;
      
      console.log('\n' + '='.repeat(60));
      console.log('✅ SCHEDULER INITIALIZED SUCCESSFULLY');
      console.log('📡 Running in 24/7 autonomous mode');
      console.log('⏰ FUTURE messages will send automatically');
      console.log('🚫 PAST messages will NOT be resent');
      console.log('💤 Server restart safe - No duplicates');
      console.log('='.repeat(60));
      
    } catch (error) {
      console.error('❌ Initialization error:', error);
      setTimeout(() => this.init(), 30000);
    }
  }

  async waitForMongoConnection() {
    console.log('🔗 Waiting for MongoDB connection...');
    
    let attempts = 0;
    const maxAttempts = 30;
    
    while (attempts < maxAttempts) {
      if (mongoose.connection.readyState === 1) {
        console.log('✅ MongoDB connected');
        return true;
      }
      
      attempts++;
      console.log(`⏳ Waiting for MongoDB (${attempts}/${maxAttempts})...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    throw new Error('MongoDB connection timeout');
  }

  async setupCampaign(campaign) {
    try {
      const campaignId = campaign._id.toString();
      
      // Stop existing jobs
      this.stopCampaign(campaignId);
      
      // Get all steps
      const steps = await CampaignStep.find({ campaignId: campaign._id })
        .sort({ day: 1, sequence: 1 });
      
      if (steps.length === 0) {
        console.log('⚠️ No steps found');
        return;
      }
      
      console.log(`📊 Found ${steps.length} steps`);
      
      // Setup based on campaign type
      switch (campaign.campaignType) {
        case 'daily':
          await this.setupDailyCampaign(campaign, steps);
          break;
        case 'weekly':
          await this.setupWeeklyCampaign(campaign, steps);
          break;
        case 'monthly':
          await this.setupMonthlyCampaign(campaign, steps);
          break;
        case 'fixed':
          await this.setupFixedCampaign(campaign, steps);
          break;
        case 'content_based':
          console.log('🎯 Content-based campaign - manual only');
          break;
        default:
          console.log(`⚠️ Unknown type: ${campaign.campaignType}`);
      }
      
      // Mark as active
      this.activeCampaigns.set(campaignId, {
        id: campaign._id,
        name: campaign.name,
        type: campaign.campaignType,
        steps: steps.length,
        setupAt: new Date(),
        lastExecution: null
      });
      
      console.log(`✅ Campaign "${campaign.name}" setup complete`);
      
    } catch (error) {
      console.error(`❌ Setup error for ${campaign.name}:`, error);
    }
  }

  async setupDailyCampaign(campaign, steps) {
    try {
      console.log(`📅 Setting up DAILY campaign`);
      
      // Group steps by time
      const stepsByTime = this.groupStepsByTime(steps);
      
      // Schedule each time
      for (const [stepTime, timeSteps] of Object.entries(stepsByTime)) {
        const [hour, minute] = stepTime.split(':').map(Number);
        
        // Cron pattern: minute hour * * *
        const cronPattern = `${minute} ${hour} * * *`;
        const jobId = `daily_${campaign._id}_${stepTime.replace(':', '')}`;
        
        console.log(`⏰ Daily at ${stepTime}: ${timeSteps.length} steps`);
        
        const job = cron.schedule(cronPattern, async () => {
          await this.executeDailyStep(campaign, timeSteps, stepTime);
        }, {
          scheduled: true,
          timezone: "Asia/Kolkata"
        });
        
        this.scheduledJobs.set(jobId, job);
        console.log(`✅ Scheduled: ${cronPattern}`);
      }
      
    } catch (error) {
      console.error('❌ Daily setup error:', error);
    }
  }

  async executeDailyStep(campaign, steps, stepTime) {
    const executionKey = `daily_${campaign._id}_${stepTime}_${new Date().toDateString()}`;
    
    // Check if already executed today
    if (this.executionHistory.has(executionKey)) {
      console.log(`⏭️ Already executed ${campaign.name} at ${stepTime} today`);
      return;
    }
    
    console.log(`\n🚀 DAILY EXECUTION: ${campaign.name} at ${stepTime}`);
    console.log(`🕐 Time: ${moment().tz('Asia/Kolkata').format('HH:mm:ss')}`);
    
    this.executionHistory.set(executionKey, new Date());
    
    // Execute all steps for this time
    for (const step of steps.sort((a, b) => a.sequence - b.sequence)) {
      await this.executeStepForAllContacts(step, campaign);
      await this.sleep(1000);
    }
    
    // Update campaign
    await Campaign.findByIdAndUpdate(campaign._id, {
      lastExecutionDate: new Date(),
      $inc: { executedCount: 1 }
    });
    
    // Update active campaigns map
    const campaignData = this.activeCampaigns.get(campaign._id.toString());
    if (campaignData) {
      campaignData.lastExecution = new Date();
      this.activeCampaigns.set(campaign._id.toString(), campaignData);
    }
  }

  async setupWeeklyCampaign(campaign, steps) {
    try {
      console.log(`📅 Setting up WEEKLY campaign`);
      
      // Group steps by day and time
      const stepsByDayAndTime = {};
      
      steps.forEach(step => {
        const dayOfWeek = step.dayOfWeek !== undefined ? step.dayOfWeek : 0;
        const stepTime = step.stepTime || '09:00';
        const key = `${dayOfWeek}_${stepTime}`;
        
        if (!stepsByDayAndTime[key]) stepsByDayAndTime[key] = [];
        stepsByDayAndTime[key].push(step);
      });
      
      // Schedule each combination
      for (const [key, timeSteps] of Object.entries(stepsByDayAndTime)) {
        const [dayOfWeek, stepTime] = key.split('_');
        const [hour, minute] = stepTime.split(':').map(Number);
        
        // Cron pattern: minute hour * * dayOfWeek
        const cronPattern = `${minute} ${hour} * * ${dayOfWeek}`;
        const jobId = `weekly_${campaign._id}_${key}`;
        
        console.log(`⏰ Day ${dayOfWeek} at ${stepTime}: ${timeSteps.length} steps`);
        
        const job = cron.schedule(cronPattern, async () => {
          await this.executeWeeklyStep(campaign, timeSteps, dayOfWeek, stepTime);
        }, {
          scheduled: true,
          timezone: "Asia/Kolkata"
        });
        
        this.scheduledJobs.set(jobId, job);
        console.log(`✅ Scheduled: ${cronPattern}`);
      }
      
    } catch (error) {
      console.error('❌ Weekly setup error:', error);
    }
  }

  async executeWeeklyStep(campaign, steps, dayOfWeek, stepTime) {
    const weekKey = moment().format('YYYY-WW');
    const executionKey = `weekly_${campaign._id}_${dayOfWeek}_${stepTime}_${weekKey}`;
    
    // Check if already executed this week
    if (this.executionHistory.has(executionKey)) {
      console.log(`⏭️ Already executed ${campaign.name} on day ${dayOfWeek} at ${stepTime} this week`);
      return;
    }
    
    console.log(`\n🚀 WEEKLY EXECUTION: ${campaign.name}`);
    console.log(`📅 Day: ${dayOfWeek}, Time: ${stepTime}`);
    
    this.executionHistory.set(executionKey, new Date());
    
    // Execute steps
    for (const step of steps.sort((a, b) => a.sequence - b.sequence)) {
      await this.executeStepForAllContacts(step, campaign);
      await this.sleep(1000);
    }
    
    // Update campaign
    await Campaign.findByIdAndUpdate(campaign._id, {
      lastExecutionDate: new Date(),
      $inc: { executedCount: 1 }
    });
  }

  async setupMonthlyCampaign(campaign, steps) {
    try {
      console.log(`📅 Setting up MONTHLY campaign`);
      
      // Group steps by date and time
      const stepsByDateAndTime = {};
      
      steps.forEach(step => {
        const dayOfMonth = step.dayOfMonth !== undefined ? step.dayOfMonth : 1;
        const stepTime = step.stepTime || '09:00';
        const key = `${dayOfMonth}_${stepTime}`;
        
        if (!stepsByDateAndTime[key]) stepsByDateAndTime[key] = [];
        stepsByDateAndTime[key].push(step);
      });
      
      // Schedule each combination
      for (const [key, timeSteps] of Object.entries(stepsByDateAndTime)) {
        const [dayOfMonth, stepTime] = key.split('_');
        const [hour, minute] = stepTime.split(':').map(Number);
        
        // Cron pattern: minute hour dayOfMonth * *
        const cronPattern = `${minute} ${hour} ${dayOfMonth} * *`;
        const jobId = `monthly_${campaign._id}_${key}`;
        
        console.log(`⏰ Date ${dayOfMonth} at ${stepTime}: ${timeSteps.length} steps`);
        
        const job = cron.schedule(cronPattern, async () => {
          await this.executeMonthlyStep(campaign, timeSteps, dayOfMonth, stepTime);
        }, {
          scheduled: true,
          timezone: "Asia/Kolkata"
        });
        
        this.scheduledJobs.set(jobId, job);
        console.log(`✅ Scheduled: ${cronPattern}`);
      }
      
    } catch (error) {
      console.error('❌ Monthly setup error:', error);
    }
  }

  async executeMonthlyStep(campaign, steps, dayOfMonth, stepTime) {
    const monthKey = moment().format('YYYY-MM');
    const executionKey = `monthly_${campaign._id}_${dayOfMonth}_${stepTime}_${monthKey}`;
    
    // Check if already executed this month
    if (this.executionHistory.has(executionKey)) {
      console.log(`⏭️ Already executed ${campaign.name} on date ${dayOfMonth} at ${stepTime} this month`);
      return;
    }
    
    console.log(`\n🚀 MONTHLY EXECUTION: ${campaign.name}`);
    console.log(`📅 Date: ${dayOfMonth}, Time: ${stepTime}`);
    
    this.executionHistory.set(executionKey, new Date());
    
    // Execute steps
    for (const step of steps.sort((a, b) => a.sequence - b.sequence)) {
      await this.executeStepForAllContacts(step, campaign);
      await this.sleep(1000);
    }
    
    // Update campaign
    await Campaign.findByIdAndUpdate(campaign._id, {
      lastExecutionDate: new Date(),
      $inc: { executedCount: 1 }
    });
  }

  async setupFixedCampaign(campaign, steps) {
    try {
      console.log(`📅 Setting up FIXED campaign (FUTURE ONLY)`);
      
      // Get all contacts
      const contacts = await this.getAllCampaignContacts(campaign);
      
      if (contacts.length === 0) {
        console.log('❌ No contacts found');
        return;
      }
      
      console.log(`👥 Found ${contacts.length} contacts`);
      
      // Schedule FUTURE steps only
      for (const contact of contacts) {
        await this.setupFixedCampaignForContact(campaign, contact, steps);
      }
      
    } catch (error) {
      console.error('❌ Fixed campaign setup error:', error);
    }
  }

  async setupFixedCampaignForContact(campaign, contact, steps) {
    try {
      // Get or create progress
      let progress = await CampaignProgress.findOne({
        campaignId: campaign._id,
        contactId: contact._id
      });
      
      if (!progress) {
        progress = new CampaignProgress({
          campaignId: campaign._id,
          contactId: contact._id,
          tenantId: campaign.tenantId,
          currentDay: 1,
          status: 'active',
          startedAt: new Date(),
          completedSteps: []
        });
        await progress.save();
      }
      
      if (progress.status === 'completed') {
        console.log(`✅ ${contact.phone} already completed campaign`);
        return;
      }
      
      // Get steps starting from current day
      const futureSteps = steps.filter(s => s.day >= progress.currentDay);
      
      // Schedule FUTURE steps only
      for (const step of futureSteps) {
        await this.scheduleFixedStep(campaign, contact, step, progress);
      }
      
    } catch (error) {
      console.error(`❌ Setup error for ${contact.phone}:`, error);
    }
  }

  async scheduleFixedStep(campaign, contact, step, progress) {
    try {
      const [hour, minute] = step.stepTime.split(':').map(Number);
      
      // Calculate target datetime
      const daysToAdd = step.day - progress.currentDay;
      const targetDate = moment().tz('Asia/Kolkata').add(daysToAdd, 'days');
      targetDate.hours(hour);
      targetDate.minutes(minute);
      targetDate.seconds(0);
      
      const now = moment().tz('Asia/Kolkata');
      const delayMs = targetDate.valueOf() - now.valueOf();
      
      // Check if step was already sent (using model method)
      const alreadySent = progress.hasStepBeenSent && typeof progress.hasStepBeenSent === 'function' 
        ? progress.hasStepBeenSent(step._id, step.sequence, step.day)
        : await this.checkIfStepSent(campaign._id, step._id, contact._id, step.day);
      
      if (alreadySent) {
        console.log(`⏭️ Already sent to ${contact.phone}, step ${step.sequence}, day ${step.day}`);
        return;
      }
      
      // If time has passed, mark as missed (DO NOT SEND)
      if (delayMs <= 0) {
        console.log(`⏰ TIME PASSED: ${contact.phone}, Step ${step.sequence}, Day ${step.day}`);
        console.log(`   Scheduled: ${targetDate.format('DD/MM/YYYY HH:mm')}`);
        console.log(`   Current: ${now.format('DD/MM/YYYY HH:mm')}`);
        console.log(`   ❌ Marking as MISSED (not sending)`);
        
        // Mark as missed in progress
        if (progress.markStepAsMissed && typeof progress.markStepAsMissed === 'function') {
          await progress.markStepAsMissed(
            step._id,
            step.sequence,
            step.day,
            step.stepTime
          );
        } else {
          await this.markStepAsMissedInProgress(progress, step._id, step.sequence, step.day, step.stepTime);
        }
        
        return;
      }
      
      const jobId = `fixed_${campaign._id}_${contact._id}_${step._id}`;
      
      console.log(`⏰ Scheduling FUTURE step ${step.sequence} for ${contact.phone}`);
      console.log(`   Day ${step.day} at ${step.stepTime}`);
      console.log(`   Will execute in ${Math.round(delayMs/1000/60)} minutes`);
      
      // Add to currentDaySteps as scheduled
      progress.currentDaySteps.push({
        stepId: step._id,
        sequence: step.sequence,
        stepTime: step.stepTime,
        scheduledAt: new Date(),
        status: 'scheduled'
      });
      await progress.save();
      
      const timeoutId = setTimeout(async () => {
        console.log(`\n🚀 EXECUTING SCHEDULED STEP for ${contact.phone}`);
        console.log(`📅 Day ${step.day}, Time: ${step.stepTime}`);
        
        try {
          // Double check if already sent
          const stillNotSent = progress.hasStepBeenSent && typeof progress.hasStepBeenSent === 'function'
            ? !progress.hasStepBeenSent(step._id, step.sequence, step.day)
            : !(await this.checkIfStepSent(campaign._id, step._id, contact._id, step.day));
          
          if (stillNotSent) {
            const result = await this.executeStepForContact(step, contact, campaign, progress);
            
            if (result.success) {
              // Update currentDaySteps status
              const stepIndex = progress.currentDaySteps.findIndex(s => 
                s.stepId && s.stepId.toString() === step._id.toString()
              );
              
              if (stepIndex !== -1) {
                progress.currentDaySteps[stepIndex].status = 'sent';
                progress.currentDaySteps[stepIndex].sentAt = new Date();
                progress.currentDaySteps[stepIndex].messageId = result.messageId;
                await progress.save();
              }
            }
          } else {
            console.log(`⏭️ Already sent to ${contact.phone}, skipping`);
          }
          
          this.timeoutJobs.delete(jobId);
        } catch (error) {
          console.error(`❌ Execution error:`, error);
          
          // Mark as failed in progress
          const stepIndex = progress.currentDaySteps.findIndex(s => 
            s.stepId && s.stepId.toString() === step._id.toString()
          );
          
          if (stepIndex !== -1) {
            progress.currentDaySteps[stepIndex].status = 'failed';
            progress.currentDaySteps[stepIndex].error = error.message;
            await progress.save();
          }
        }
      }, delayMs);
      
      this.timeoutJobs.set(jobId, timeoutId);
      
    } catch (error) {
      console.error('❌ Error scheduling fixed step:', error);
    }
  }

  async checkIfStepSent(campaignId, stepId, contactId, day) {
    try {
      const existingMessage = await MessageLog.findOne({
        campaignId: campaignId,
        contactId: contactId,
        stepDay: day,
        status: 'sent',
        createdAt: {
          $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) // Check last 24 hours
        }
      });
      
      return !!existingMessage;
    } catch (error) {
      console.error('❌ Error checking if step sent:', error);
      return false;
    }
  }

  async markStepAsMissedInProgress(progress, stepId, sequence, day, stepTime) {
    try {
      // Add to completed steps as missed
      progress.completedSteps.push({
        day: day,
        stepId: stepId,
        sequence: sequence,
        stepTime: stepTime,
        scheduledAt: new Date(), // When it should have been sent
        status: 'missed',
        missedAt: new Date()
      });
      
      // Update missed count
      progress.missedStepCount = (progress.missedStepCount || 0) + 1;
      progress.lastInteraction = new Date();
      
      await progress.save();
      
      console.log(`✅ Marked step ${sequence}, day ${day} as missed for ${progress.contactId}`);
    } catch (error) {
      console.error('❌ Error marking step as missed:', error);
    }
  }

  async executeStepForAllContacts(step, campaign) {
    try {
      console.log(`\n🎯 EXECUTING STEP ${step.sequence} FOR ALL CONTACTS`);
      
      const contacts = await this.getAllCampaignContacts(campaign);
      
      if (contacts.length === 0) {
        console.log('⚠️ No contacts found');
        return;
      }
      
      console.log(`📞 Total contacts: ${contacts.length}`);
      
      // Process in batches
      const batchSize = 5;
      let successCount = 0;
      
      for (let i = 0; i < contacts.length; i += batchSize) {
        const batch = contacts.slice(i, i + batchSize);
        
        console.log(`📦 Batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(contacts.length/batchSize)}`);
        
        const promises = batch.map(contact => 
          this.sendToSingleContact(step, contact, campaign).catch(error => {
            console.error(`❌ Error for ${contact.phone}:`, error.message);
            return { success: false };
          })
        );
        
        const results = await Promise.allSettled(promises);
        
        results.forEach(result => {
          if (result.status === 'fulfilled' && result.value && result.value.success) {
            successCount++;
          }
        });
        
        // Small delay between batches
        if (i + batchSize < contacts.length) {
          await this.sleep(2000);
        }
      }
      
      console.log(`✅ Execution complete: ${successCount} sent`);
      
    } catch (error) {
      console.error('❌ Error executing step:', error);
    }
  }

  async executeStepForContact(step, contact, campaign, progress) {
    try {
      // Check if already sent using campaign processor
      const alreadySent = campaignProcessor.hasMessageBeenSent
        ? await campaignProcessor.hasMessageBeenSent(
            campaign._id,
            step._id,
            contact._id,
            new Date()
          )
        : await this.checkIfStepSent(campaign._id, step._id, contact._id, step.day);
      
      if (alreadySent) {
        console.log(`🚫 DUPLICATE PREVENTED: Already sent to ${contact.phone}`);
        return { success: true, skipped: true, reason: 'already_sent' };
      }
      
      const result = await this.sendToSingleContact(step, contact, campaign);
      
      if (result.success && campaign.campaignType === 'fixed' && progress) {
        await this.updateFixedProgress(step, contact, campaign, progress, result.messageId);
      }
      
      return result;
      
    } catch (error) {
      console.error(`❌ Error executing for ${contact.phone}:`, error);
      
      // Mark as failed in progress
      if (campaign.campaignType === 'fixed' && progress) {
        await this.markStepAsFailedInProgress(progress, step._id, step.sequence, step.day, step.stepTime, error.message);
      }
      
      return { success: false, error: error.message };
    }
  }

  async sendToSingleContact(step, contact, campaign) {
    try {
      const to = contact.phone.replace(/\+/g, '');
      
      console.log(`📨 Sending ${step.type} to ${to}`);
      
      let response = null;
      let messageType = step.type;
      let messageId = null;
      
      // Send based on type
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
        if (!step.templateName) {
          throw new Error('Template name is required');
        }
        
        response = await sendTemplate({
          to,
          templateName: step.templateName,
          language: step.language || 'en_US',
          tenantId: campaign.tenantId
        });
      }
      
      // Extract message ID from response
      if (response && response.messages && response.messages[0]) {
        messageId = response.messages[0].id;
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
        timestamp: new Date(),
        templateName: step.type === 'template' ? step.templateName : null,
        sentAt: new Date(),
        messageId: messageId,
        whatsappMessageId: messageId
      });
      
      console.log(`✅ Sent ${step.type} to ${contact.phone}`);
      return { 
        success: true, 
        contact: contact.phone,
        messageId: messageId 
      };
      
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
        timestamp: new Date(),
        templateName: step.type === 'template' ? step.templateName : null
      });
      
      throw error;
    }
  }

  async updateFixedProgress(step, contact, campaign, progress, messageId) {
    try {
      // Mark step as completed
      progress.completedSteps.push({
        day: step.day,
        stepId: step._id,
        sequence: step.sequence,
        stepTime: step.stepTime,
        sentAt: new Date(),
        status: 'sent',
        messageId: messageId
      });
      
      // Update completed step count
      progress.completedStepCount = (progress.completedStepCount || 0) + 1;
      progress.lastInteraction = new Date();
      progress.lastMessageSentAt = new Date();
      
      // Check if all steps for current day are done
      const totalStepsForDay = await CampaignStep.countDocuments({
        campaignId: campaign._id,
        day: step.day
      });
      
      const completedStepsForDay = progress.completedSteps.filter(
        s => s.day === step.day && s.status === 'sent'
      ).length;
      
      if (completedStepsForDay >= totalStepsForDay) {
        console.log(`🎉 Day ${step.day} completed for ${contact.phone}`);
        
        // Move to next day
        progress.currentDay = step.day + 1;
        
        // Clear current day steps
        progress.currentDaySteps = progress.currentDaySteps.filter(s => 
          !s.stepId || s.stepId.toString() !== step._id.toString()
        );
        
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

  async markStepAsFailedInProgress(progress, stepId, sequence, day, stepTime, errorMessage) {
    try {
      // Add to completed steps as failed
      progress.completedSteps.push({
        day: day,
        stepId: stepId,
        sequence: sequence,
        stepTime: stepTime,
        sentAt: new Date(),
        status: 'failed',
        error: errorMessage
      });
      
      // Update failed count
      progress.failedStepCount = (progress.failedStepCount || 0) + 1;
      progress.lastInteraction = new Date();
      
      await progress.save();
      
      console.log(`❌ Marked step ${sequence}, day ${day} as failed`);
    } catch (error) {
      console.error('❌ Error marking step as failed:', error);
    }
  }

  async getAllCampaignContacts(campaign) {
    try {
      let allContacts = [];
      
      if (campaign.sectionIds && campaign.sectionIds.length > 0) {
        for (const sectionId of campaign.sectionIds) {
          const sectionContacts = await Contact.find({ 
            tenantId: campaign.tenantId,
            section: sectionId 
          });
          allContacts = allContacts.concat(sectionContacts);
        }
      }
      
      // Remove duplicates
      const uniqueContacts = [];
      const seen = new Set();
      
      for (const contact of allContacts) {
        const phone = contact.phone;
        if (!seen.has(phone)) {
          seen.add(phone);
          uniqueContacts.push(contact);
        }
      }
      
      return uniqueContacts;
      
    } catch (error) {
      console.error('❌ Error getting contacts:', error);
      return [];
    }
  }

  groupStepsByTime(steps) {
    const stepsByTime = {};
    steps.forEach(step => {
      const stepTime = step.stepTime || '09:00';
      if (!stepsByTime[stepTime]) stepsByTime[stepTime] = [];
      stepsByTime[stepTime].push(step);
    });
    return stepsByTime;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  stopCampaign(campaignId) {
    console.log(`\n🛑 STOPPING CAMPAIGN: ${campaignId}`);
    
    let stoppedCount = 0;
    
    // Stop cron jobs
    this.scheduledJobs.forEach((job, key) => {
      if (key.includes(campaignId.toString())) {
        job.stop();
        this.scheduledJobs.delete(key);
        stoppedCount++;
      }
    });
    
    // Clear timeouts
    this.timeoutJobs.forEach((timeout, key) => {
      if (key.includes(campaignId.toString())) {
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
      if (key.includes(campaignId.toString())) {
        job.stop();
      }
    });
    
    this.timeoutJobs.forEach((timeout, key) => {
      if (key.includes(campaignId.toString())) {
        clearTimeout(timeout);
        this.timeoutJobs.delete(key);
      }
    });
    
    console.log(`✅ Campaign paused`);
  }

  startMonitoring() {
    // Log status every 5 minutes
    setInterval(() => {
      this.printStatus();
    }, 300000);
    
    console.log('📊 Monitoring started (every 5 minutes)');
  }

  printStatus() {
    const now = moment().tz('Asia/Kolkata');
    console.log('\n📋 SCHEDULER STATUS');
    console.log('='.repeat(50));
    console.log(`🕐 Time: ${now.format('YYYY-MM-DD HH:mm:ss')}`);
    console.log(`🏃 Active Campaigns: ${this.activeCampaigns.size}`);
    console.log(`⏰ Cron Jobs: ${this.scheduledJobs.size}`);
    console.log(`⏳ Timeout Jobs: ${this.timeoutJobs.size}`);
    console.log(`📊 Execution History: ${this.executionHistory.size}`);
    console.log('='.repeat(50));
  }

  getStatus() {
    return {
      initialized: this.isInitialized,
      activeCampaigns: this.activeCampaigns.size,
      cronJobs: this.scheduledJobs.size,
      timeoutJobs: this.timeoutJobs.size,
      executionHistory: this.executionHistory.size,
      timestamp: new Date().toISOString(),
      mode: 'NO_DUPLICATES'
    };
  }

  async cleanup() {
    console.log('\n🧹 CLEANING UP SCHEDULER');
    
    // Stop all cron jobs
    this.scheduledJobs.forEach((job, key) => {
      job.stop();
    });
    this.scheduledJobs.clear();
    
    // Clear all timeouts
    this.timeoutJobs.forEach((timeout, key) => {
      clearTimeout(timeout);
    });
    this.timeoutJobs.clear();
    
    // Clear active campaigns
    this.activeCampaigns.clear();
    
    // Clear execution history
    this.executionHistory.clear();
    
    this.isInitialized = false;
    
    console.log('✅ Scheduler cleaned up');
  }

  async scheduleStepForCampaign(step, campaign) {
    if (campaign.status !== 'active') {
      console.log('⚠️ Campaign not active, skipping');
      return;
    }
    
    if (this.isInitialized) {
      console.log(`\n➕ ADDING STEP TO ACTIVE CAMPAIGN`);
      console.log(`📋 Campaign: ${campaign.name}, Step: ${step.sequence}`);
      
      // Re-setup the entire campaign
      await this.setupCampaign(campaign);
    }
  }
}

// Create and export singleton
const scheduler = new CampaignScheduler();

// Auto-initialize
setTimeout(() => {
  scheduler.init().catch(console.error);
}, 3000);

// Handle termination
process.on('SIGTERM', () => scheduler.cleanup());
process.on('SIGINT', () => scheduler.cleanup());

module.exports = scheduler;