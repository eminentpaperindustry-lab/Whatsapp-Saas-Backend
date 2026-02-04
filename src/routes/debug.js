const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Campaign = require('../models/Campaign');
const CampaignStep = require('../models/CampaignStep');
const MessageLog = require('../models/MessageLog');
const CampaignProgress = require('../models/CampaignProgress');
const campaignScheduler = require('../services/campaignScheduler');

// Debug endpoint - List all campaigns with status
router.get('/campaigns', async (req, res) => {
  try {
    const campaigns = await Campaign.find()
      .populate('sectionIds', 'name')
      .sort({ createdAt: -1 });
    
    const campaignsWithStatus = campaigns.map(campaign => ({
      ...campaign.toObject(),
      isScheduled: campaignScheduler.activeCampaigns.has(campaign._id.toString()),
      stepsCount: 0, // We'll update this
      messagesCount: 0
    }));
    
    // Get counts
    for (let campaign of campaignsWithStatus) {
      campaign.stepsCount = await CampaignStep.countDocuments({ campaignId: campaign._id });
      campaign.messagesCount = await MessageLog.countDocuments({ campaignId: campaign._id });
    }
    
    res.json(campaignsWithStatus);
  } catch (error) {
    console.error('Debug error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Debug endpoint - Check scheduler status
router.get('/scheduler', async (req, res) => {
  try {
    const status = campaignScheduler.getStatus();
    
    res.json({
      ...status,
      serverTime: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      uptime: process.uptime(),
      memory: process.memoryUsage()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Debug endpoint - Manually trigger a campaign step
router.post('/trigger-step/:campaignId/:stepId', async (req, res) => {
  try {
    const { campaignId, stepId } = req.params;
    
    const result = await campaignScheduler.testStep(campaignId, stepId);
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Debug endpoint - Reset scheduler
router.post('/reset-scheduler', async (req, res) => {
  try {
    campaignScheduler.cleanup();
    await campaignScheduler.init();
    
    res.json({
      success: true,
      message: 'Scheduler reset successfully'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Debug endpoint - Check database stats
router.get('/db-stats', async (req, res) => {
  try {
    const dbStats = await mongoose.connection.db.stats();
    const collections = await mongoose.connection.db.listCollections().toArray();
    
    res.json({
      ok: dbStats.ok,
      collections: collections.length,
      objects: dbStats.objects,
      dataSize: dbStats.dataSize,
      storageSize: dbStats.storageSize
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;