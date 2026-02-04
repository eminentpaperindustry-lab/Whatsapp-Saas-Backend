const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/auth');
const Campaign = require('../models/Campaign');
const CampaignStep = require('../models/CampaignStep');
const CampaignProgress = require('../models/CampaignProgress');
const Contact = require('../models/Contact');
const MessageLog = require('../models/MessageLog');
const Template = require('../models/Template');
const { isHttpsUrl } = require('../utils/validators');
const campaignScheduler = require('../services/campaignScheduler');
const campaignProcessor = require('../services/campaignProcessor');

// --- Campaign Routes ---

// Create campaign
router.post('/', requireAuth, async (req, res) => {
  try {
    const { 
      name, 
      description, 
      sectionIds,
      campaignType,
      autoStart = true, // Default to true for automatic
      repeatCount,
      contentType,
      contentId
    } = req.body;
    
    console.log('🎯 Creating campaign:', { name, campaignType });
    
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
      autoStart: autoStart,
      repeatCount: repeatCount || 0,
      contentType: contentType,
      contentId: contentId,
      status: autoStart ? 'active' : 'draft',
      executedCount: 0,
      lastExecutionDate: null,
      createdAt: new Date()
    };
    
    // Set totalDays for fixed campaigns
    if (campaignType === 'fixed') {
      campaignData.totalDays = 1;
    }
    
    const campaign = await Campaign.create(campaignData);
    
    // Auto-start if configured
    if (autoStart && campaignScheduler.isInitialized) {
      console.log(`🚀 Auto-starting campaign: ${campaign.name}`);
      await campaignScheduler.setupCampaign(campaign);
    }
    
    console.log('✅ Campaign created:', campaign._id);
    res.json(campaign);
    
  } catch (err) {
    console.error('❌ Create campaign error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// List campaigns
router.get('/', requireAuth, async (req, res) => {
  try {
    const campaigns = await Campaign.find({ tenantId: req.tenantId })
      .populate('sectionIds', 'name')
      .sort({ createdAt: -1 });
    
    // Add scheduler status
    const campaignsWithStatus = campaigns.map(campaign => ({
      ...campaign.toObject(),
      schedulerStatus: campaignScheduler.activeCampaigns.has(campaign._id.toString()) ? 'active' : 'inactive'
    }));
    
    res.json(campaignsWithStatus);
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
    
    // Check if scheduled
    const isScheduled = campaignScheduler.activeCampaigns.has(campaign._id.toString());
    
    res.json({
      ...campaign.toObject(),
      isScheduled,
      schedulerStatus: isScheduled ? 'active' : 'inactive'
    });
    
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
    
    // Store old status for comparison
    const oldStatus = campaign.status;
    
    // Update fields
    if (name !== undefined) campaign.name = name;
    if (description !== undefined) campaign.description = description;
    if (status !== undefined) campaign.status = status;
    if (sectionIds !== undefined) campaign.sectionIds = sectionIds;
    if (repeatCount !== undefined) campaign.repeatCount = repeatCount;
    
    await campaign.save();
    
    // Handle scheduler changes
    if (status === 'active' && oldStatus !== 'active') {
      console.log(`🚀 Activating campaign: ${campaign.name}`);
      if (campaignScheduler.isInitialized) {
        await campaignScheduler.setupCampaign(campaign);
      }
    } else if ((status === 'paused' || status === 'completed') && oldStatus === 'active') {
      console.log(`⏸️ Stopping campaign: ${campaign.name}`);
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

    const campaign = await Campaign.findByIdAndDelete(campaignId);
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    // Stop from scheduler
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

    // Check for duplicate sequence
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

    // Validate
    if (type === 'text' && !body?.trim()) {
      return res.status(400).json({ error: 'Message body is required for text type' });
    }

    if (type === 'media' && !mediaUrl?.trim()) {
      return res.status(400).json({ error: 'Media URL is required for media type' });
    }

    if (type === 'template' && !templateName) {
      return res.status(400).json({ error: 'Template name is required for template type' });
    }

    if (type === 'media' && mediaUrl && !isHttpsUrl(mediaUrl)) {
      return res.status(400).json({ error: 'mediaUrl must be HTTPS' });
    }

    // Validate stepTime
    const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
    if (stepTime && !timeRegex.test(stepTime)) {
      return res.status(400).json({ error: 'stepTime must be in HH:MM format (24-hour)' });
    }

    // Format template name
    let formattedTemplateName = templateName;
    if (type === 'template' && templateName) {
      formattedTemplateName = templateName.toLowerCase().replace(/\s+/g, '_');
      
      const templateExists = await Template.findOne({
        tenantId: req.tenantId,
        name: formattedTemplateName,
        status: 'APPROVED'
      });
      
      if (!templateExists) {
        const templateByDisplayName = await Template.findOne({
          tenantId: req.tenantId,
          displayName: { $regex: new RegExp(templateName, 'i') },
          status: 'APPROVED'
        });
        
        if (templateByDisplayName) {
          formattedTemplateName = templateByDisplayName.name;
        }
      }
    }

    const stepData = {
      campaignId: req.params.campaignId,
      sequence: parseInt(sequence),
      day: day,
      type,
      body: body || '',
      templateName: type === 'template' ? formattedTemplateName : null,
      language: language || null,
      mediaUrl: mediaUrl || '',
      caption: caption || '',
      stepTime: stepTime,
      dayOfWeek: dayOfWeek !== undefined ? dayOfWeek : null,
      dayOfMonth: dayOfMonth !== undefined ? dayOfMonth : null,
      condition: condition,
      createdAt: new Date()
    };

    const step = await CampaignStep.create(stepData);
    
    // Update campaign totalDays if fixed
    if (campaign.campaignType === 'fixed' && step.day > campaign.totalDays) {
      campaign.totalDays = step.day;
      await campaign.save();
    }
    
    // Auto-schedule if campaign is active
    if (campaign.status === 'active' && campaignScheduler.isInitialized) {
      console.log(`⏰ Auto-scheduling new step`);
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
    
    // Format template name
    if (updateData.type === 'template' && updateData.templateName) {
      updateData.templateName = updateData.templateName.toLowerCase().replace(/\s+/g, '_');
    }

    // Check sequence conflict
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
      { ...updateData, updatedAt: new Date() },
      { new: true }
    );

    if (!step) {
      return res.status(404).json({ error: 'Step not found' });
    }

    // Re-schedule if campaign active
    const campaign = await Campaign.findById(campaignId);
    if (campaign && campaign.status === 'active' && campaignScheduler.isInitialized) {
      console.log(`🔄 Re-scheduling campaign with updated step`);
      await campaignScheduler.setupCampaign(campaign);
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

    // Re-sequence steps
    const remainingSteps = await CampaignStep.find({ 
      campaignId, 
      day: stepResult.day 
    }).sort({ sequence: 1 });
    
    for (let i = 0; i < remainingSteps.length; i++) {
      const step = remainingSteps[i];
      const newSequence = i + 1;
      
      if (step.sequence !== newSequence) {
        await CampaignStep.findByIdAndUpdate(step._id, { 
          sequence: newSequence,
          updatedAt: new Date()
        });
      }
    }

    // Re-schedule campaign
    const campaign = await Campaign.findById(campaignId);
    if (campaign && campaign.status === 'active' && campaignScheduler.isInitialized) {
      await campaignScheduler.setupCampaign(campaign);
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
        
        if (campaignScheduler.isInitialized) {
          await campaignScheduler.setupCampaign(campaign);
          message = `Campaign ${action === 'start' ? 'started' : 'resumed'}`;
        } else {
          message = 'Campaign marked as active, scheduler will start it automatically';
        }
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
    
    // Get total contacts
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
    
    // Check if scheduled
    const isScheduled = campaignScheduler.activeCampaigns.has(campaign._id.toString());
    
    res.json({
      campaign,
      stepsCount: steps,
      totalMessages,
      sentMessages,
      failedMessages,
      activeContacts,
      completedContacts,
      totalContacts,
      successRate: parseFloat(successRate),
      isScheduled,
      schedulerStatus: isScheduled ? 'active' : 'inactive'
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

// --- Debug & Monitoring Routes ---

// Get scheduler status
router.get('/debug/scheduler/status', requireAuth, async (req, res) => {
  try {
    const status = campaignScheduler.getStatus();
    const processorStatus = campaignProcessor.getStatus();
    
    res.json({
      scheduler: status,
      processor: processorStatus,
      serverTime: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      uptime: process.uptime()
    });
  } catch (err) {
    console.error('❌ Scheduler status error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Manually trigger campaign (for testing)
router.post('/:campaignId/trigger-test', requireAuth, async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.campaignId);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const steps = await CampaignStep.find({ campaignId: campaign._id })
      .sort({ day: 1, sequence: 1 })
      .limit(1); // Only test first step

    if (steps.length === 0) {
      return res.status(400).json({ error: 'No steps defined' });
    }

    // Get first contact
    const contacts = await Contact.find({ 
      tenantId: campaign.tenantId,
      section: { $in: campaign.sectionIds }
    }).limit(1);

    if (contacts.length === 0) {
      return res.status(404).json({ error: 'No contacts found' });
    }

    const step = steps[0];
    const contact = contacts[0];

    console.log(`🧪 Test sending to ${contact.phone}`);
    
    // Use scheduler to send
    const result = await campaignScheduler.sendToSingleContact(step, contact, campaign);
    
    res.json({
      success: result.success,
      message: result.success ? 'Test message sent' : 'Test failed',
      contact: contact.phone,
      step: step.sequence
    });
    
  } catch (err) {
    console.error('❌ Test trigger error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Fix campaign scheduling
router.post('/:campaignId/fix-scheduling', requireAuth, async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.campaignId);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    if (campaign.status !== 'active') {
      return res.status(400).json({ error: 'Campaign is not active' });
    }

    console.log(`🔧 Fixing scheduling for ${campaign.name}`);
    
    // Stop current scheduling
    campaignScheduler.stopCampaign(campaign._id);
    
    // Re-setup
    await campaignScheduler.setupCampaign(campaign);
    
    res.json({
      success: true,
      message: 'Campaign scheduling fixed',
      campaign: campaign.name
    });
    
  } catch (err) {
    console.error('❌ Fix scheduling error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Check for duplicate messages
router.get('/:campaignId/check-duplicates', requireAuth, async (req, res) => {
  try {
    const campaignId = req.params.campaignId;
    
    // Find potential duplicates (same contact, same step within 1 hour)
    const duplicates = await MessageLog.aggregate([
      {
        $match: {
          campaignId: mongoose.Types.ObjectId(campaignId),
          status: 'sent'
        }
      },
      {
        $group: {
          _id: {
            contactId: '$contactId',
            stepSequence: '$stepSequence',
            date: {
              $dateToString: { format: "%Y-%m-%d", date: "$createdAt" }
            }
          },
          count: { $sum: 1 },
          messages: { $push: "$$ROOT" }
        }
      },
      {
        $match: {
          count: { $gt: 1 }
        }
      }
    ]);
    
    res.json({
      totalMessages: await MessageLog.countDocuments({ campaignId }),
      potentialDuplicates: duplicates.length,
      duplicates: duplicates
    });
    
  } catch (err) {
    console.error('❌ Check duplicates error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;