const express = require('express');
const router = express.Router();
const MessageLog = require('../models/MessageLog');
const requireAuth = require('../middleware/auth'); // <<--- नया: requireAuth middleware import किया

// GET /api/analyze/campaign/:campaignId
// सुरक्षा फिक्स: requireAuth middleware जोड़ा और tenantId के आधार पर फ़िल्टर किया
router.get('/campaign/:campaignId', requireAuth, async (req, res) => {
  try {
    const campaignId = req.params.campaignId;
    // फिक्स: केवल current tenant के MessageLogs को फ़ेच करें
    const logs = await MessageLog.find({ 
      tenantId: req.tenantId, // req.tenantId का उपयोग करें (campaigns.js से match करने के लिए)
      campaignId 
    });
    
    const sent = logs.length;
    const delivered = logs.filter(l => l.status === 'delivered').length;
    const read = logs.filter(l => l.status === 'read' || l.status === 'seen').length;
    const failed = logs.filter(l => l.status === 'failed').length;

    res.json({
      summary: { sent, delivered, read, failed },
      logs // पूरा detail भेज दो frontend के लिए
    });
  } catch (err) {
    console.error('analyze.js error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
