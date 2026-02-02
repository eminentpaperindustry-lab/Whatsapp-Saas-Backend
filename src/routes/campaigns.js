const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/auth');
const Campaign = require('../models/Campaign');
const CampaignStep = require('../models/CampaignStep');
const CampaignProgress = require('../models/CampaignProgress');
const Contact = require('../models/Contact');
const MessageLog = require('../models/MessageLog');
const { sendText, sendImage, sendVideo, sendFile, sendTemplate } = require('../services/whatsapp');
const { isHttpsUrl } = require('../utils/validators');
const campaignScheduler = require('../services/campaignScheduler');

// --- Campaign Routes ---

// Create campaign
router.post('/', requireAuth, async (req, res) => {
  try {
    const { 
      name, 
      description, 
      sectionIds,
      campaignType,
      autoStart,
      repeatCount,
      contentType,
      contentId
    } = req.body;
    
    console.log('🎯 Creating campaign:', { name, campaignType, sectionIds });
    
    if (!sectionIds || !Array.isArray(sectionIds) || sectionIds.length === 0) {
      return res.status(400).json({ error: 'Please select at least one section' });
    }
    
    const campaignData = {
      tenantId: req.tenantId,
      name,
      sectionIds,
      description,
      createdBy: req.user.id,
      campaignType: campaignType || 'fixed',
      autoStart: autoStart || false,
      repeatCount: repeatCount || 0,
      contentType: contentType,
      contentId: contentId,
      status: autoStart ? 'active' : 'draft',
      executedCount: 0
    };
    
    // Calculate totalDays for fixed campaigns
    if (campaignType === 'fixed') {
      campaignData.totalDays = 1; // Default, will update when steps are added
    }
    
    const doc = await Campaign.create(campaignData);
    
    // If autoStart is true, start the campaign
    if (autoStart) {
      await campaignScheduler.startCampaign(doc._id);
    }
    
    console.log('✅ Campaign created:', doc._id);
    res.json(doc);
  } catch (err) {
    console.error('❌ Create campaign error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// List campaigns
router.get('/', requireAuth, async (req, res) => {
  try {
    const list = await Campaign.find({ tenantId: req.tenantId })
      .populate('sectionIds', 'name')
      .sort({ createdAt: -1 });
    res.json(list);
  } catch (err) {
    console.error('❌ List campaigns error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get single campaign
router.get('/:campaignId', requireAuth, async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.campaignId)
      .populate('sectionIds', 'name');
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    res.json(campaign);
  } catch (err) {
    console.error('❌ Get campaign error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update campaign
router.put('/:campaignId', requireAuth, async (req, res) => {
  try {
    const { 
      name, 
      description, 
      status,
      sectionIds,
      repeatCount
    } = req.body;
    
    const campaign = await Campaign.findById(req.params.campaignId);
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    
    // Update fields
    if (name !== undefined) campaign.name = name;
    if (description !== undefined) campaign.description = description;
    if (status !== undefined) campaign.status = status;
    if (sectionIds !== undefined) campaign.sectionIds = sectionIds;
    if (repeatCount !== undefined) campaign.repeatCount = repeatCount;
    
    await campaign.save();
    
    // Handle scheduling if status changed
    if (status === 'active') {
      await campaignScheduler.startCampaign(campaign._id);
    } else if (status === 'paused' || status === 'completed') {
      campaignScheduler.stopCampaign(campaign._id);
    }
    
    res.json(campaign);
  } catch (err) {
    console.error('❌ Update campaign error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete campaign
router.delete('/:campaignId', requireAuth, async (req, res) => {
  try {
    const campaignId = req.params.campaignId;

    const campaignResult = await Campaign.findByIdAndDelete(campaignId);
    if (!campaignResult) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    // Stop scheduler if running
    campaignScheduler.stopCampaign(campaignId);

    // Delete associated data
    await CampaignStep.deleteMany({ campaignId });
    await CampaignProgress.deleteMany({ campaignId });
    await MessageLog.deleteMany({ campaignId });

    res.json({ message: 'Campaign deleted successfully' });
  } catch (err) {
    console.error('❌ Delete campaign error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// --- Campaign Step Routes ---

// Add step
router.post('/:campaignId/steps', requireAuth, async (req, res) => {
  try {
    const { 
      sequence, 
      day = 1,
      type, 
      body, 
      templateName, 
      language, 
      mediaUrl, 
      caption,
      stepTime = '09:00',
      dayOfWeek,
      dayOfMonth,
      condition = 'always'
    } = req.body;
    
    const campaign = await Campaign.findById(req.params.campaignId);
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    // Check for duplicate sequence number for same day
    const existingStep = await CampaignStep.findOne({
      campaignId: req.params.campaignId,
      day: day,
      sequence: sequence
    });

    if (existingStep) {
      return res.status(400).json({ 
        error: `Step with sequence ${sequence} already exists for day ${day}.` 
      });
    }

    // Validate content based on type
    if (type === 'text' && !body?.trim()) {
      return res.status(400).json({ error: 'Message body is required for text type' });
    }

    if (type === 'media' && !mediaUrl?.trim()) {
      return res.status(400).json({ error: 'Media URL is required for media type' });
    }

    if (type === 'template' && !templateName) {
      return res.status(400).json({ error: 'Template name is required for template type' });
    }

    // Validate media URL format
    if (type === 'media' && mediaUrl && !isHttpsUrl(mediaUrl)) {
      return res.status(400).json({ error: 'mediaUrl must be HTTPS' });
    }

    // Validate stepTime format
    const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
    if (stepTime && !timeRegex.test(stepTime)) {
      return res.status(400).json({ error: 'stepTime must be in HH:MM format (24-hour)' });
    }

    const stepData = {
      campaignId: req.params.campaignId,
      sequence: parseInt(sequence),
      day: day,
      type,
      body: body || '',
      templateName: templateName || null,
      language: language || null,
      mediaUrl: mediaUrl || '',
      caption: caption || '',
      stepTime: stepTime,
      dayOfWeek: dayOfWeek !== undefined ? dayOfWeek : null,
      dayOfMonth: dayOfMonth !== undefined ? dayOfMonth : null,
      condition: condition
    };

    const step = await CampaignStep.create(stepData);
    
    // Update campaign totalDays if fixed campaign
    if (campaign.campaignType === 'fixed' && step.day > campaign.totalDays) {
      campaign.totalDays = step.day;
      await campaign.save();
    }
    
    // If campaign is active, schedule this step
    if (campaign.status === 'active') {
      await campaignScheduler.scheduleStepForCampaign(step, campaign);
    }
    
    console.log('✅ Step added:', step._id);
    res.json(step);
  } catch (err) {
    console.error('❌ Add step error:', err);
    if (err.code === 11000) {
      return res.status(400).json({ 
        error: 'Duplicate sequence for this day.' 
      });
    }
    res.status(500).json({ error: 'Server error' });
  }
});

// List steps
router.get('/:campaignId/steps', requireAuth, async (req, res) => {
  try {
    const steps = await CampaignStep.find({ campaignId: req.params.campaignId })
      .sort({ day: 1, sequence: 1 });
    res.json(steps);
  } catch (err) {
    console.error('❌ Get steps error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update step
router.put('/:campaignId/steps/:stepId', requireAuth, async (req, res) => {
  try {
    const { stepId, campaignId } = req.params;
    const updateData = req.body;

    // Check if sequence is being updated and if it conflicts
    if (updateData.sequence) {
      const existingStep = await CampaignStep.findOne({
        campaignId,
        day: updateData.day || 1,
        sequence: updateData.sequence,
        _id: { $ne: stepId }
      });

      if (existingStep) {
        return res.status(400).json({ 
          error: `Step with sequence ${updateData.sequence} already exists for this day.` 
        });
      }
    }

    const step = await CampaignStep.findOneAndUpdate(
      { _id: stepId, campaignId },
      updateData,
      { new: true }
    );

    if (!step) {
      return res.status(404).json({ error: 'Step not found' });
    }

    // Re-schedule if campaign is active
    const campaign = await Campaign.findById(campaignId);
    if (campaign && campaign.status === 'active') {
      // Remove old scheduling
      campaignScheduler.unscheduleStep(stepId);
      // Schedule updated step
      await campaignScheduler.scheduleStepForCampaign(step, campaign);
    }

    res.json(step);
  } catch (err) {
    console.error('❌ Update step error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete step
router.delete('/:campaignId/steps/:stepId', requireAuth, async (req, res) => {
  try {
    const { campaignId, stepId } = req.params;

    const stepResult = await CampaignStep.findOneAndDelete({ 
      _id: stepId, 
      campaignId: campaignId 
    });

    if (!stepResult) {
      return res.status(404).json({ error: 'Step not found' });
    }

    // Remove from scheduler
    campaignScheduler.unscheduleStep(stepId);

    // Re-sequence steps for the same day
    const remainingSteps = await CampaignStep.find({ 
      campaignId, 
      day: stepResult.day 
    }).sort({ sequence: 1 });
    
    // Update sequence numbers starting from 1
    for (let i = 0; i < remainingSteps.length; i++) {
      const step = remainingSteps[i];
      const newSequence = i + 1;
      
      if (step.sequence !== newSequence) {
        await CampaignStep.findByIdAndUpdate(step._id, { sequence: newSequence });
      }
    }

    res.json({ 
      message: 'Step deleted successfully', 
      reSequenced: true 
    });
  } catch (err) {
    console.error('❌ Delete step error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// --- Campaign Control Routes ---

// Start/Pause/Resume/Stop campaign
router.post('/:campaignId/control', requireAuth, async (req, res) => {
  try {
    const { action } = req.body;
    const campaign = await Campaign.findById(req.params.campaignId);
    
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    
    let message = '';
    
    switch (action) {
      case 'start':
      case 'resume':
        campaign.status = 'active';
        await campaign.save();
        await campaignScheduler.startCampaign(campaign._id);
        message = `Campaign ${action === 'start' ? 'started' : 'resumed'}`;
        break;
        
      case 'pause':
        campaign.status = 'paused';
        await campaign.save();
        campaignScheduler.pauseCampaign(campaign._id);
        message = 'Campaign paused';
        break;
        
      case 'stop':
        campaign.status = 'completed';
        await campaign.save();
        campaignScheduler.stopCampaign(campaign._id);
        message = 'Campaign stopped';
        break;
        
      default:
        return res.status(400).json({ error: 'Invalid action' });
    }
    
    res.json({ 
      message,
      status: campaign.status
    });
    
  } catch (err) {
    console.error('❌ Control campaign error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get campaign statistics
router.get('/:campaignId/stats', requireAuth, async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.campaignId)
      .populate('sectionIds', 'name');
      
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const steps = await CampaignStep.countDocuments({ campaignId: req.params.campaignId });
    const totalMessages = await MessageLog.countDocuments({ campaignId: req.params.campaignId });
    const sentMessages = await MessageLog.countDocuments({ 
      campaignId: req.params.campaignId,
      status: 'sent'
    });
    const failedMessages = await MessageLog.countDocuments({ 
      campaignId: req.params.campaignId,
      status: 'failed'
    });
    const activeContacts = await CampaignProgress.countDocuments({
      campaignId: req.params.campaignId,
      status: 'active'
    });
    const completedContacts = await CampaignProgress.countDocuments({
      campaignId: req.params.campaignId,
      status: 'completed'
    });
    
    const successRate = totalMessages > 0 ? ((sentMessages / totalMessages) * 100).toFixed(2) : 0;
    
    // Get total contacts in selected sections
    let totalContacts = 0;
    if (campaign.sectionIds && campaign.sectionIds.length > 0) {
      for (const section of campaign.sectionIds) {
        const contactCount = await Contact.countDocuments({ 
          tenantId: campaign.tenantId,
          section: section._id || section
        });
        totalContacts += contactCount;
      }
    }
    
    res.json({
      campaign,
      stepsCount: steps,
      totalMessages,
      sentMessages,
      failedMessages,
      activeContacts,
      completedContacts,
      totalContacts,
      successRate: parseFloat(successRate)
    });
    
  } catch (err) {
    console.error('❌ Campaign stats error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get campaign progress
router.get('/:campaignId/progress', requireAuth, async (req, res) => {
  try {
    const progress = await CampaignProgress.find({ 
      campaignId: req.params.campaignId 
    })
    .populate('contactId', 'phone name email')
    .sort({ updatedAt: -1 });
    
    res.json(progress);
  } catch (err) {
    console.error('❌ Campaign progress error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// --- Trigger Routes ---

// Trigger campaign test
router.post('/:campaignId/trigger', requireAuth, async (req, res) => {
  try {
    const test = req.query.test === 'true';
    const campaign = await Campaign.findById(req.params.campaignId);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    // Get contacts from all selected sections
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

    // Remove duplicates
    const uniqueContacts = Array.from(new Set(contacts.map(c => c._id.toString())))
      .map(id => contacts.find(c => c._id.toString() === id));

    if (uniqueContacts.length === 0) {
      return res.status(404).json({ error: "No contacts found" });
    }

    const steps = await CampaignStep.find({ campaignId: campaign._id }).sort({ day: 1, sequence: 1 });
    if (!steps.length) return res.status(400).json({ error: 'No steps defined' });

    // For test mode
    if (test) {
      await triggerTestMode(steps, uniqueContacts, campaign);
      return res.json({ 
        message: 'Test triggered', 
        steps: steps.length, 
        contacts: uniqueContacts.length 
      });
    }

    // For actual trigger
    campaign.status = 'active';
    await campaign.save();
    
    await campaignScheduler.startCampaign(campaign._id);
    
    return res.json({ 
      message: `${campaign.campaignType} campaign activated`,
      contacts: uniqueContacts.length
    });
    
  } catch (err) {
    console.error('❌ Trigger campaign error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Trigger content-based campaign
router.post('/:campaignId/trigger-content', requireAuth, async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.campaignId);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    
    if (campaign.campaignType !== 'content_based') {
      return res.status(400).json({ error: 'Not a content-based campaign' });
    }
    
    // Get contacts from all selected sections
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

    if (uniqueContacts.length === 0) {
      return res.status(404).json({ error: "No contacts found" });
    }

    // Send content to all contacts
    const promises = uniqueContacts.map(async (contact) => {
      const to = contact.phone.replace(/\+/g, '');
      
      try {
        let resp = null;
        
        switch (campaign.contentType) {
          case 'text':
            resp = await sendText({ to, body: campaign.contentId });
            break;
          case 'template':
            const [templateName, language] = campaign.contentId.split("::");
            resp = await sendTemplate({
              to,
              templateName,
              language: language || 'en_US'
            });
            break;
          case 'media':
            const mediaUrl = campaign.contentId;
            if (mediaUrl.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
              resp = await sendImage({ to, imageUrl: mediaUrl, caption: '' });
            } else if (mediaUrl.match(/\.(mp4|avi|mov|wmv)$/i)) {
              resp = await sendVideo({ to, videoUrl: mediaUrl, caption: '' });
            } else {
              resp = await sendFile({ to, fileUrl: mediaUrl, caption: '' });
            }
            break;
        }

        // Log successful message
        await MessageLog.create({
          tenantId: campaign.tenantId,
          campaignId: campaign._id,
          contactId: contact._id,
          provider: 'meta',
          to: contact.phone,
          direction: 'outbound',
          type: campaign.contentType,
          status: 'sent'
        });

      } catch (err) {
        console.error('❌ Send error for', contact.phone, err);
        
        // Log failed message
        await MessageLog.create({
          tenantId: campaign.tenantId,
          campaignId: campaign._id,
          contactId: contact._id,
          provider: 'meta',
          to: contact.phone,
          direction: 'outbound',
          type: campaign.contentType,
          status: 'failed',
          error: err.message
        });
      }
    });
    
    await Promise.all(promises);
    
    res.json({
      message: 'Content-based campaign triggered',
      contacts: uniqueContacts.length
    });
    
  } catch (error) {
    console.error('❌ Content-based campaign error:', error);
    res.status(500).json({ error: 'Failed to trigger campaign' });
  }
});

// --- Helper Functions ---

async function triggerTestMode(steps, contacts, campaign) {
  // For test, only send to first contact
  const testContacts = [contacts[0]];
  
  console.log(`🧪 TEST MODE: Sending to ${testContacts[0].phone}`);
  
  for (const step of steps) {
    console.log(`\n🧪 TEST: Step ${step.sequence} (Day ${step.day})`);
    
    await Promise.all(testContacts.map(async (contact) => {
      try {
        // Use scheduler's processCampaignStep
        await campaignScheduler.processCampaignStep(step, contact, campaign);
      } catch (error) {
        console.error(`❌ Test error for ${contact.phone}:`, error);
      }
    }));
    
    // Add delay between steps for test
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}

// --- Debug Routes ---

// Debug campaign scheduler
router.get('/debug/scheduler', requireAuth, async (req, res) => {
  try {
    campaignScheduler.listScheduledJobs();
    
    res.json({
      message: 'Scheduler debug info',
      activeCampaigns: Array.from(campaignScheduler.activeCampaigns.values()),
      timeoutJobs: campaignScheduler.timeoutJobs.size,
      cronJobs: campaignScheduler.scheduledJobs.size,
      serverTime: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      serverTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone
    });
  } catch (err) {
    console.error('❌ Debug error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Test immediate step execution
router.post('/:campaignId/test-step/:stepId', requireAuth, async (req, res) => {
  try {
    const { campaignId, stepId } = req.params;
    
    const result = await campaignScheduler.testStep(campaignId, stepId);
    
    if (result.success) {
      res.json({
        success: true,
        message: `Test step executed`,
        ...result
      });
    } else {
      res.status(400).json({
        success: false,
        message: result.message
      });
    }
  } catch (err) {
    console.error('❌ Test step error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Clear all jobs
router.post('/debug/clear-all', requireAuth, async (req, res) => {
  try {
    // Clear all timeout jobs
    campaignScheduler.timeoutJobs.forEach((timeout) => {
      clearTimeout(timeout);
    });
    campaignScheduler.timeoutJobs.clear();
    
    // Clear all cron jobs
    campaignScheduler.scheduledJobs.forEach((job) => {
      job.stop();
    });
    campaignScheduler.scheduledJobs.clear();
    
    // Clear active campaigns
    campaignScheduler.activeCampaigns.clear();
    
    res.json({
      message: 'All scheduler jobs cleared',
      cleared: {
        timeoutJobs: 0,
        cronJobs: 0,
        activeCampaigns: 0
      }
    });
  } catch (err) {
    console.error('❌ Clear all error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;