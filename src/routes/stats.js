const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/auth');
const Template = require('../models/Template');

// GET: Template statistics
router.get('/overview', requireAuth, async (req, res) => {
  try {
    console.log(`📊 Fetching template stats for tenant: ${req.tenantId}`);
    
    // Get template counts by status
    const [total, approved, pending, rejected] = await Promise.all([
      Template.countDocuments({ tenantId: req.tenantId }),
      Template.countDocuments({ tenantId: req.tenantId, status: 'APPROVED' }),
      Template.countDocuments({ tenantId: req.tenantId, status: 'PENDING' }),
      Template.countDocuments({ tenantId: req.tenantId, status: 'REJECTED' })
    ]);

    // Get counts by category
    const utilityCount = await Template.countDocuments({ 
      tenantId: req.tenantId, 
      category: 'UTILITY' 
    });
    const marketingCount = await Template.countDocuments({ 
      tenantId: req.tenantId, 
      category: 'MARKETING' 
    });
    const authCount = await Template.countDocuments({ 
      tenantId: req.tenantId, 
      category: 'AUTHENTICATION' 
    });

    const stats = {
      total,
      approved,
      pending,
      rejected,
      categories: {
        UTILITY: utilityCount,
        MARKETING: marketingCount,
        AUTHENTICATION: authCount
      }
    };

    console.log('✅ Stats calculated:', stats);
    
    res.json({
      success: true,
      stats: stats
    });
  } catch (error) {
    console.error('❌ Stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch statistics: ' + error.message
    });
  }
});

module.exports = router;