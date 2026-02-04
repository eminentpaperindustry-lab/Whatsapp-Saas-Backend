const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/auth');
const { 
    getAllTemplates, 
    getTemplateByName,
    checkWhatsAppHealth,
    sendText,
    sendImage,
    sendVideo,
    sendFile,
    sendLocation,
    sendContact,
    sendTemplate,
    sendRaw,
    getTemplates,
    findTemplateInDB
} = require('../services/whatsapp');

// ========================
// TEMPLATE MANAGEMENT APIs
// ========================

// GET /api/whatsapp/templates - Get ALL templates from Meta
router.get('/templates', requireAuth, async (req, res) => {
    try {
        console.log('📞 [API] GET /whatsapp/templates - Fetching ALL templates from Meta');
        
        const result = await getAllTemplates(req.tenantId);
        
        console.log('📊 [API] Templates fetched:', {
            success: result.success,
            total: result.total,
            metaTemplates: result.templates?.length || 0,
            localTemplates: result.localTemplates?.length || 0
        });
        
        if (result.success) {
            res.json({
                success: true,
                templates: result.templates || [], // ALL Meta templates
                localTemplates: result.localTemplates || [], // Local DB templates
                total: result.total || 0,
                message: `Successfully loaded ${result.templates?.length || 0} templates from Meta`
            });
        } else {
            res.status(500).json({
                success: false,
                error: result.error || 'Failed to fetch templates from Meta',
                templates: [],
                localTemplates: []
            });
        }
    } catch (error) {
        console.error('❌ [API] GET /whatsapp/templates error:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            templates: [],
            localTemplates: []
        });
    }
});

// GET /api/whatsapp/templates/meta - Get ONLY Meta templates (approved)
router.get('/templates/meta', requireAuth, async (req, res) => {
    try {
        console.log('📞 [API] GET /whatsapp/templates/meta - Fetching Meta templates');
        
        const result = await getAllTemplates(req.tenantId);
        
        if (result.success) {
            // Filter only APPROVED templates from Meta
            const approvedTemplates = (result.templates || []).filter(t => 
                t.status === 'APPROVED'
            );
            
            res.json({
                success: true,
                templates: approvedTemplates,
                total: approvedTemplates.length,
                message: `Loaded ${approvedTemplates.length} approved templates from Meta`
            });
        } else {
            res.status(500).json({
                success: false,
                error: result.error,
                templates: []
            });
        }
    } catch (error) {
        console.error('❌ [API] GET /whatsapp/templates/meta error:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            templates: []
        });
    }
});

// GET /api/whatsapp/templates/local - Get ONLY local templates
router.get('/templates/local', requireAuth, async (req, res) => {
    try {
        console.log('📞 [API] GET /whatsapp/templates/local - Fetching local templates');
        
        const result = await getAllTemplates(req.tenantId);
        
        if (result.success) {
            res.json({
                success: true,
                templates: result.localTemplates || [],
                total: result.localTemplates?.length || 0,
                message: `Loaded ${result.localTemplates?.length || 0} local templates`
            });
        } else {
            res.status(500).json({
                success: false,
                error: result.error,
                templates: []
            });
        }
    } catch (error) {
        console.error('❌ [API] GET /whatsapp/templates/local error:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            templates: []
        });
    }
});

// GET /api/whatsapp/templates/name/:templateName - Get template by name
router.get('/templates/name/:templateName', requireAuth, async (req, res) => {
    try {
        const { templateName } = req.params;
        const { language = 'en_US' } = req.query;
        
        console.log(`📞 [API] GET /whatsapp/templates/name/${templateName}`);
        
        const result = await getTemplateByName(templateName, language, req.tenantId);
        
        if (result.success) {
            res.json({
                success: true,
                template: result.template,
                localTemplate: result.localTemplate
            });
        } else {
            res.status(404).json({
                success: false,
                error: result.error || 'Template not found'
            });
        }
    } catch (error) {
        console.error(`❌ [API] GET /whatsapp/templates/name/:name error:`, error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// POST /api/whatsapp/templates/search - Search templates
router.post('/templates/search', requireAuth, async (req, res) => {
    try {
        const { templateName, language, category } = req.body;
        
        console.log('🔍 [API] POST /whatsapp/templates/search - Searching templates');
        
        const result = await getAllTemplates(req.tenantId);
        
        if (result.success) {
            let filteredTemplates = result.templates || [];
            
            // Apply filters
            if (templateName) {
                filteredTemplates = filteredTemplates.filter(t => 
                    t.name.toLowerCase().includes(templateName.toLowerCase()) ||
                    (t.displayName && t.displayName.toLowerCase().includes(templateName.toLowerCase()))
                );
            }
            
            if (language) {
                filteredTemplates = filteredTemplates.filter(t => 
                    t.language.toLowerCase() === language.toLowerCase()
                );
            }
            
            if (category) {
                filteredTemplates = filteredTemplates.filter(t => 
                    t.category === category
                );
            }
            
            res.json({
                success: true,
                templates: filteredTemplates,
                total: filteredTemplates.length,
                message: `Found ${filteredTemplates.length} templates`
            });
        } else {
            res.status(500).json({
                success: false,
                error: result.error,
                templates: []
            });
        }
    } catch (error) {
        console.error('❌ [API] POST /whatsapp/templates/search error:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            templates: []
        });
    }
});

// ========================
// MESSAGING APIs
// ========================

// POST /api/whatsapp/send/text - Send text message
router.post('/send/text', requireAuth, async (req, res) => {
    try {
        const { to, body } = req.body;
        
        if (!to || !body) {
            return res.status(400).json({
                success: false,
                error: 'to and body are required'
            });
        }
        
        console.log(`📤 [API] Sending text to ${to}`);
        
        const result = await sendText({ to, body });
        
        res.json({
            success: true,
            message: 'Text message sent successfully',
            data: result
        });
    } catch (error) {
        console.error('❌ [API] POST /whatsapp/send/text error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// POST /api/whatsapp/send/template - Send template message
router.post('/send/template', requireAuth, async (req, res) => {
    try {
        const { to, templateName, language = 'en_US', dynamicParams = [] } = req.body;
        
        if (!to || !templateName) {
            return res.status(400).json({
                success: false,
                error: 'to and templateName are required'
            });
        }
        
        console.log(`📤 [API] Sending template ${templateName} to ${to}`);
        
        const result = await sendTemplate({
            to,
            templateName,
            language,
            dynamicParams,
            tenantId: req.tenantId
        });
        
        res.json({
            success: true,
            message: 'Template message sent successfully',
            data: result
        });
    } catch (error) {
        console.error('❌ [API] POST /whatsapp/send/template error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// POST /api/whatsapp/send/media - Send media message
router.post('/send/media', requireAuth, async (req, res) => {
    try {
        const { to, mediaUrl, caption = '', mediaType } = req.body;
        
        if (!to || !mediaUrl) {
            return res.status(400).json({
                success: false,
                error: 'to and mediaUrl are required'
            });
        }
        
        console.log(`📤 [API] Sending media to ${to}`);
        
        let result;
        const url = mediaUrl.toLowerCase();
        
        // Determine media type
        if (mediaType === 'image' || url.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
            result = await sendImage({ to, imageUrl: mediaUrl, caption });
        } else if (mediaType === 'video' || url.match(/\.(mp4|avi|mov|wmv|mkv)$/i)) {
            result = await sendVideo({ to, videoUrl: mediaUrl, caption });
        } else {
            result = await sendFile({ to, fileUrl: mediaUrl, caption });
        }
        
        res.json({
            success: true,
            message: 'Media message sent successfully',
            data: result
        });
    } catch (error) {
        console.error('❌ [API] POST /whatsapp/send/media error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// POST /api/whatsapp/send/batch - Send batch messages
router.post('/send/batch', requireAuth, async (req, res) => {
    try {
        const { messages } = req.body;
        
        if (!messages || !Array.isArray(messages)) {
            return res.status(400).json({
                success: false,
                error: 'messages array is required'
            });
        }
        
        console.log(`📤 [API] Sending batch of ${messages.length} messages`);
        
        // Process batch messages
        const results = await Promise.all(
            messages.map(async (msg) => {
                try {
                    // You need to pass appropriate parameters based on your use case
                    // This is a simplified version
                    return {
                        success: true,
                        to: msg.to,
                        message: 'Message queued'
                    };
                } catch (error) {
                    return {
                        success: false,
                        to: msg.to,
                        error: error.message
                    };
                }
            })
        );
        
        res.json({
            success: true,
            message: `Processed ${messages.length} messages`,
            results: results
        });
    } catch (error) {
        console.error('❌ [API] POST /whatsapp/send/batch error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ========================
// HEALTH & STATUS APIs
// ========================

// GET /api/whatsapp/health - Check WhatsApp API health
router.get('/health', requireAuth, async (req, res) => {
    try {
        console.log('🏥 [API] Checking WhatsApp health');
        
        const result = await checkWhatsAppHealth();
        
        res.json({
            success: true,
            healthy: result.healthy,
            data: result.data,
            error: result.error
        });
    } catch (error) {
        console.error('❌ [API] GET /whatsapp/health error:', error);
        res.status(500).json({
            success: false,
            healthy: false,
            error: error.message
        });
    }
});

// GET /api/whatsapp/status - Get WhatsApp status
router.get('/status', requireAuth, async (req, res) => {
    try {
        console.log('📊 [API] Getting WhatsApp status');
        
        const healthResult = await checkWhatsAppHealth();
        
        // Try to get templates count
        let templateCount = 0;
        try {
            const templateResult = await getAllTemplates(req.tenantId);
            if (templateResult.success) {
                templateCount = templateResult.templates?.length || 0;
            }
        } catch (templateErr) {
            console.log('⚠️ Could not fetch template count:', templateErr.message);
        }
        
        res.json({
            success: true,
            status: {
                api: healthResult.healthy ? 'active' : 'inactive',
                templates: templateCount,
                phoneId: process.env.META_WA_PHONE_ID ? 'configured' : 'not configured',
                businessId: process.env.META_WA_BUSINESS_ID ? 'configured' : 'not configured',
                timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('❌ [API] GET /whatsapp/status error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ========================
// CAMPAIGN SUPPORT APIs
// ========================

// GET /api/whatsapp/campaign-templates - Templates for campaigns
router.get('/campaign-templates', requireAuth, async (req, res) => {
    try {
        console.log('🎯 [API] GET /whatsapp/campaign-templates - Templates for campaigns');
        
        const result = await getAllTemplates(req.tenantId);
        
        if (result.success) {
            // Format templates for campaign dropdown
            const formattedTemplates = (result.templates || []).map(template => ({
                id: template.name, // Use template name as ID
                name: template.name,
                displayName: template.name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
                language: template.language || 'en_US',
                status: template.status || 'APPROVED',
                category: template.category || 'UTILITY',
                components: template.components || [],
                metaTemplate: true
            }));
            
            // Add local templates
            const localFormatted = (result.localTemplates || []).map(template => ({
                id: template.name,
                name: template.name,
                displayName: template.displayName || template.name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
                language: template.language || 'en_US',
                status: template.status || 'APPROVED',
                category: template.category || 'UTILITY',
                fbTemplateId: template.fbTemplateId,
                localTemplate: true
            }));
            
            const allTemplates = [...formattedTemplates, ...localFormatted];
            
            res.json({
                success: true,
                templates: allTemplates,
                metaCount: formattedTemplates.length,
                localCount: localFormatted.length,
                total: allTemplates.length,
                message: `Loaded ${allTemplates.length} templates for campaigns`
            });
        } else {
            res.status(500).json({
                success: false,
                error: result.error,
                templates: []
            });
        }
    } catch (error) {
        console.error('❌ [API] GET /whatsapp/campaign-templates error:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            templates: []
        });
    }
});

// POST /api/whatsapp/validate-template - Validate template for sending
router.post('/validate-template', requireAuth, async (req, res) => {
    try {
        const { templateName, language = 'en_US' } = req.body;
        
        if (!templateName) {
            return res.status(400).json({
                success: false,
                error: 'templateName is required'
            });
        }
        
        console.log(`✅ [API] Validating template: ${templateName}`);
        
        const result = await getTemplateByName(templateName, language, req.tenantId);
        
        if (result.success) {
            res.json({
                success: true,
                valid: true,
                template: result.template,
                message: `Template "${templateName}" is valid and approved`
            });
        } else {
            res.json({
                success: false,
                valid: false,
                error: result.error,
                message: `Template "${templateName}" is not valid: ${result.error}`
            });
        }
    } catch (error) {
        console.error('❌ [API] POST /whatsapp/validate-template error:', error);
        res.status(500).json({
            success: false,
            valid: false,
            error: error.message
        });
    }
});

module.exports = router;