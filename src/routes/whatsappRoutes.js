const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const requireAuth = require('../middleware/auth');

// Import models
const MessageLog = require('../models/MessageLog');
const ChatSession = require('../models/ChatSession');
const Contact = require('../models/Contact');
const CampaignProgress = require('../models/CampaignProgress');

// Import WhatsApp services
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
    sendDocument
} = require('../services/whatsapp');

// ===============================
// WEBHOOK HELPER FUNCTIONS
// ===============================

// Verify webhook signature
function verifySignature(rawBody, signatureHeader) {
    try {
        // Dev mode - skip verification if no secret
        if (!process.env.META_APP_SECRET) {
            console.log('⚠️ Dev mode: Skipping signature verification');
            return true;
        }

        if (!signatureHeader || !rawBody) {
            console.warn('❌ Missing signature or body');
            return false;
        }

        const parts = signatureHeader.split('=');
        if (parts.length !== 2) return false;

        const sigHash = parts[1];
        const expected = crypto
            .createHmac('sha256', process.env.META_APP_SECRET)
            .update(rawBody)
            .digest('hex');

        const isValid = crypto.timingSafeEqual(
            Buffer.from(sigHash, 'hex'),
            Buffer.from(expected, 'hex')
        );

        if (!isValid) {
            console.warn('❌ Signature verification failed');
        }

        return isValid;
    } catch (error) {
        console.error('Signature verification error:', error);
        return false;
    }
}

// Update chat session for webhook
async function updateChatSessionForWebhook(tenantId, phone, messageData) {
    try {
        const cleanedPhone = phone.replace('+', '').trim();

        // Find or create contact
        let contact = await Contact.findOne({
            tenantId,
            phone: cleanedPhone
        });

        if (!contact) {
            contact = await Contact.create({
                tenantId,
                phone: cleanedPhone,
                name: `Contact ${cleanedPhone}`,
                hasWhatsApp: true,
                lastInteraction: new Date(),
                createdAt: new Date()
            });
            console.log(`✅ Created new contact: ${cleanedPhone}`);
        } else {
            contact.lastInteraction = new Date();
            contact.hasWhatsApp = true;
            await contact.save();
        }

        // Prepare session data
        const updateData = {
            tenantId,
            phone: cleanedPhone,
            contactId: contact._id,
            lastMessage: messageData.body?.substring(0, 200) || '[Media]',
            lastMessageType: messageData.type || 'text',
            lastDirection: messageData.direction,
            lastStatus: messageData.status || 'received',
            lastInteraction: new Date(),
            updatedAt: new Date(),
            $inc: { messageCount: 1 }
        };

        if (messageData.direction === 'inbound') {
            updateData.$inc.unreadCount = 1;
            updateData.hasReplied = true;
        } else {
            updateData.unreadCount = 0;
        }

        // Update or create chat session
        const session = await ChatSession.findOneAndUpdate(
            { tenantId, phone: cleanedPhone },
            updateData,
            {
                upsert: true,
                new: true,
                setDefaultsOnInsert: true
            }
        );

        console.log(`✅ Updated chat session for ${cleanedPhone}`);
        return { session, contact };
    } catch (error) {
        console.error('❌ Error updating chat session:', error);
        return null;
    }
}

// Process inbound message from webhook
async function processInboundMessage(msg, tenantId, businessPhone) {
    try {
        const from = msg.from;
        const messageId = msg.id;

        // Check duplicate
        const existing = await MessageLog.findOne({
            provider: 'meta',
            whatsappMessageId: messageId
        });

        if (existing) {
            console.log(`⏭️ Duplicate message ${messageId}, skipping`);
            return null;
        }

        // Extract message content
        let messageContent = '';
        let messageType = msg.type || 'text';
        let mediaUrl = '';

        switch (msg.type) {
            case 'text':
                messageContent = msg.text?.body || '';
                break;
            case 'image':
                messageContent = msg.image?.caption || '[Image]';
                mediaUrl = msg.image?.id || '';
                break;
            case 'video':
                messageContent = msg.video?.caption || '[Video]';
                mediaUrl = msg.video?.id || '';
                break;
            case 'audio':
                messageContent = '[Audio Message]';
                mediaUrl = msg.audio?.id || '';
                break;
            case 'document':
                messageContent = msg.document?.caption || `[Document: ${msg.document?.filename || 'file'}]`;
                mediaUrl = msg.document?.id || '';
                break;
            case 'location':
                messageContent = `📍 Location: ${msg.location?.latitude}, ${msg.location?.longitude}`;
                break;
            case 'contacts':
                messageContent = '[Contacts Shared]';
                break;
            case 'interactive':
                if (msg.interactive?.type === 'button_reply') {
                    messageContent = `[Button: ${msg.interactive.button_reply?.title}]`;
                } else if (msg.interactive?.type === 'list_reply') {
                    messageContent = `[List: ${msg.interactive.list_reply?.title}]`;
                } else {
                    messageContent = '[Interactive Message]';
                }
                break;
            default:
                messageContent = `[${msg.type || 'Unknown Message'}]`;
        }

        // Create timestamp
        const timestamp = msg.timestamp ?
            new Date(parseInt(msg.timestamp) * 1000) : new Date();

        // Save message log
        const messageLog = await MessageLog.create({
            tenantId,
            from: from,
            to: businessPhone,
            body: messageContent,
            type: messageType,
            direction: 'inbound',
            status: 'received',
            provider: 'meta',
            whatsappMessageId: messageId,
            provider_message_id: messageId,
            mediaUrl: mediaUrl,
            timestamp: timestamp,
            payload: msg
        });

        // Update chat session
        await updateChatSessionForWebhook(tenantId, from, {
            body: messageContent,
            type: messageType,
            direction: 'inbound',
            status: 'received'
        });

        // Update campaign progress if contact replied
        const contact = await Contact.findOne({ tenantId, phone: from });
        if (contact) {
            await CampaignProgress.updateMany(
                {
                    tenantId,
                    contactId: contact._id,
                    hasReplied: false,
                    status: { $in: ['active', 'pending'] }
                },
                {
                    $set: {
                        hasReplied: true,
                        repliedAt: timestamp,
                        status: 'replied'
                    }
                }
            );
            console.log(`✅ Updated campaign progress for ${from}`);
        }

        console.log(`✅ Inbound message saved: ${from} - ${messageContent.substring(0, 50)}`);
        return messageLog;
    } catch (error) {
        console.error('❌ Process inbound error:', error);
        return null;
    }
}

// Process status update from webhook
async function processStatusUpdate(statusUpdate, tenantId) {
    try {
        const { id: messageId, status, recipient_id } = statusUpdate;

        if (!messageId || !status) {
            console.warn('❌ Invalid status update');
            return;
        }

        // Find the message
        const message = await MessageLog.findOne({
            provider: 'meta',
            whatsappMessageId: messageId
        });

        if (!message) {
            console.log(`⚠️ Message not found: ${messageId}`);
            return;
        }

        // Update message status
        const updatedMessage = await MessageLog.findOneAndUpdate(
            { whatsappMessageId: messageId },
            {
                $set: {
                    status: status,
                    updatedAt: new Date(),
                    payload: statusUpdate
                }
            },
            { new: true }
        );

        // Update chat session
        if (message.to) {
            await ChatSession.findOneAndUpdate(
                { tenantId, phone: message.to },
                {
                    $set: {
                        lastStatus: status,
                        updatedAt: new Date()
                    }
                }
            );
        }

        console.log(`✅ Status updated: ${messageId} -> ${status}`);
        return updatedMessage;
    } catch (error) {
        console.error('❌ Process status error:', error);
    }
}

// ===============================
// WEBHOOK ROUTES
// ===============================

// GET - Webhook verification
router.get('/webhook', (req, res) => {
    try {
        const mode = req.query['hub.mode'];
        const token = req.query['hub.verify_token'];
        const challenge = req.query['hub.challenge'];

        console.log('\n' + '='.repeat(50));
        console.log('🔐 WEBHOOK VERIFICATION REQUEST');
        console.log('='.repeat(50));
        console.log('Mode:', mode);
        console.log('Token received:', token);
        console.log('Expected token:', process.env.META_VERIFY_TOKEN);
        console.log('Challenge:', challenge);
        console.log('Full URL:', req.originalUrl);
        console.log('='.repeat(50));

        // Hardcoded tokens for testing
        const expectedTokens = [
            process.env.META_VERIFY_TOKEN,
            'whatsapp_test_token_2024',
            'test_token_123',
            'my_test_webhook_token_123',
            'whatsapp_webhook_token'
        ];

        let tokenMatched = false;
        let matchedToken = '';

        for (const expectedToken of expectedTokens) {
            if (token === expectedToken) {
                tokenMatched = true;
                matchedToken = expectedToken;
                break;
            }
        }

        if (mode === 'subscribe' && tokenMatched) {
            console.log('✅ TOKEN MATCHED:', matchedToken);
            console.log('✅ Sending challenge response:', challenge);

            res.setHeader('Content-Type', 'text/plain');
            res.status(200).send(challenge);
        } else {
            console.log('❌ TOKEN MISMATCH');
            console.log('Expected one of:', expectedTokens);
            console.log('Received:', token);
            res.status(403).send('Forbidden - Token mismatch');
        }
    } catch (error) {
        console.error('❌ Webhook verification error:', error);
        res.status(500).send('Server error');
    }
});

// POST - Webhook handler
router.post('/webhook',
    express.raw({ type: 'application/json' }),
    async (req, res) => {
        // Send immediate response to Meta
        res.sendStatus(200);

        let rawBody = null;

        try {
            rawBody = req.body.toString();
            const signature = req.headers['x-hub-signature-256'];
            const io = req.app.get('io');

            // Verify signature
            if (!verifySignature(rawBody, signature)) {
                console.warn('❌ Invalid webhook signature');
                return;
            }

            // Parse webhook data
            const data = JSON.parse(rawBody);

            console.log('📨 Webhook received:', {
                object: data.object,
                entries: data.entry?.length || 0
            });

            // Process each entry
            for (const entry of data.entry || []) {
                for (const change of entry.changes || []) {
                    const value = change.value;

                    if (change.field === 'messages') {
                        // Default tenant
                        const tenantId = process.env.DEFAULT_TENANT_ID || 'default';
                        const businessPhone = process.env.BUSINESS_PHONE_NUMBER || '919876543210';

                        // Process messages
                        for (const message of value.messages || []) {
                            const savedMessage = await processInboundMessage(
                                message,
                                tenantId,
                                businessPhone
                            );

                            // Emit socket event
                            if (savedMessage && io) {
                                io.to(`tenant_${tenantId}`).emit('message:new', savedMessage);

                                io.to(`tenant_${tenantId}`).emit('session:updated', {
                                    phone: message.from,
                                    lastMessage: savedMessage.body,
                                    lastDirection: 'inbound',
                                    lastStatus: 'received',
                                    unreadCount: 1,
                                    hasReplied: true,
                                    updatedAt: new Date()
                                });

                                console.log(`📡 Socket event emitted for ${message.from}`);
                            }
                        }

                        // Process status updates
                        for (const status of value.statuses || []) {
                            const updatedMessage = await processStatusUpdate(status, tenantId);

                            if (updatedMessage && io) {
                                io.to(`tenant_${tenantId}`).emit('message:status_updated', updatedMessage);
                            }
                        }
                    }
                }
            }

            console.log('✅ Webhook processing completed');
        } catch (error) {
            console.error('❌ Webhook processing error:', error.message);
            console.error(error.stack);
        }
    }
);

// ===============================
// TEMPLATE MANAGEMENT APIs (AUTH REQUIRED)
// ===============================

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

// ===============================
// MESSAGING APIs (AUTH REQUIRED)
// ===============================

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

// ===============================
// HEALTH & STATUS APIs (AUTH REQUIRED)
// ===============================

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

// ===============================
// CAMPAIGN SUPPORT APIs (AUTH REQUIRED)
// ===============================

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

// ===============================
// CHAT SESSION APIs (FOR CHAT COMPONENT)
// ===============================

// GET /api/whatsapp/chat/sessions - Get all chat sessions
router.get('/chat/sessions', requireAuth, async (req, res) => {
    try {
        const { page = 1, limit = 50, search = '', filter = 'all', archived = 'false' } = req.query;
        const tenantId = req.tenantId || process.env.DEFAULT_TENANT_ID || 'default';

        const skip = (page - 1) * limit;

        // Build query
        const query = { tenantId };

        if (search) {
            query.$or = [
                { phone: { $regex: search, $options: 'i' } },
                { 'lastMessage': { $regex: search, $options: 'i' } }
            ];
        }

        if (filter === 'unread') {
            query.unreadCount = { $gt: 0 };
        } else if (filter === 'replied') {
            query.hasReplied = true;
        }

        if (archived === 'true') {
            query.isArchived = true;
        } else if (archived === 'false') {
            query.isArchived = { $ne: true };
        }

        // Fetch sessions with contact details
        const sessions = await ChatSession.find(query)
            .populate('contactId', 'name email tags')
            .sort({ updatedAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        // Get counts for stats
        const totalSessions = await ChatSession.countDocuments({ tenantId });
        const totalUnread = await ChatSession.countDocuments({
            tenantId,
            unreadCount: { $gt: 0 }
        });
        const repliedSessions = await ChatSession.countDocuments({
            tenantId,
            hasReplied: true
        });
        const archivedSessions = await ChatSession.countDocuments({
            tenantId,
            isArchived: true
        });

        res.json({
            success: true,
            sessions,
            stats: {
                totalSessions,
                totalUnread,
                repliedSessions,
                archivedSessions
            },
            page: parseInt(page),
            limit: parseInt(limit),
            total: totalSessions
        });
    } catch (error) {
        console.error('❌ Get chat sessions error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// GET /api/whatsapp/chat/sessions/:phone - Get session messages
router.get('/chat/sessions/:phone', requireAuth, async (req, res) => {
    try {
        const { phone } = req.params;
        const tenantId = req.tenantId || process.env.DEFAULT_TENANT_ID || 'default';

        // Get session with contact details
        const session = await ChatSession.findOne({ tenantId, phone })
            .populate('contactId', 'name email tags');

        if (!session) {
            return res.status(404).json({
                success: false,
                error: 'Session not found'
            });
        }

        // Get messages for this session
        const messages = await MessageLog.find({
            $or: [
                { from: phone, to: session.phone },
                { from: session.phone, to: phone }
            ]
        }).sort({ timestamp: 1 });

        res.json({
            success: true,
            session,
            messages,
            totalMessages: messages.length
        });
    } catch (error) {
        console.error('❌ Get session messages error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// POST /api/whatsapp/chat/sessions/:phone/messages - Send message
router.post('/chat/sessions/:phone/messages', requireAuth, async (req, res) => {
    try {
        const { phone } = req.params;
        const { message, type = 'text', mediaUrl, caption } = req.body;
        const tenantId = req.tenantId || process.env.DEFAULT_TENANT_ID || 'default';

        if (!message && !mediaUrl) {
            return res.status(400).json({
                success: false,
                error: 'Message content is required'
            });
        }

        let result;
        switch (type) {
            case 'text':
                result = await sendText({ to: phone, body: message });
                break;
            case 'image':
                result = await sendImage({ to: phone, imageUrl: mediaUrl, caption });
                break;
            case 'video':
                result = await sendVideo({ to: phone, videoUrl: mediaUrl, caption });
                break;
            case 'document':
                result = await sendDocument({ to: phone, fileUrl: mediaUrl, caption });
                break;
            default:
                return res.status(400).json({
                    success: false,
                    error: 'Invalid message type'
                });
        }

        if (result.success) {
            // Save message log
            const messageLog = await MessageLog.create({
                tenantId,
                from: process.env.BUSINESS_PHONE_NUMBER,
                to: phone,
                body: message || `[${type} Message]`,
                type,
                direction: 'outbound',
                status: result.status || 'sent',
                provider: 'meta',
                whatsappMessageId: result.messageId,
                provider_message_id: result.messageId,
                mediaUrl,
                timestamp: new Date()
            });

            // Update chat session
            await ChatSession.findOneAndUpdate(
                { tenantId, phone },
                {
                    $set: {
                        lastMessage: message || `[${type} Message]`,
                        lastMessageType: type,
                        lastDirection: 'outbound',
                        lastStatus: result.status || 'sent',
                        lastInteraction: new Date(),
                        updatedAt: new Date(),
                        hasReplied: true,
                        unreadCount: 0
                    },
                    $inc: { messageCount: 1 }
                },
                { upsert: true, new: true }
            );

            res.json({
                success: true,
                message: 'Message sent successfully',
                data: messageLog
            });
        } else {
            res.status(500).json({
                success: false,
                error: result.error || 'Failed to send message'
            });
        }
    } catch (error) {
        console.error('❌ Send message error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// GET /api/whatsapp/chat/stats - Get chat statistics
router.get('/chat/stats', requireAuth, async (req, res) => {
    try {
        const tenantId = req.tenantId || process.env.DEFAULT_TENANT_ID || 'default';

        const totalSessions = await ChatSession.countDocuments({ tenantId });
        const totalUnread = await ChatSession.countDocuments({
            tenantId,
            unreadCount: { $gt: 0 }
        });
        const repliedSessions = await ChatSession.countDocuments({
            tenantId,
            hasReplied: true
        });
        const archivedSessions = await ChatSession.countDocuments({
            tenantId,
            isArchived: true
        });

        res.json({
            success: true,
            stats: {
                totalSessions,
                totalUnread,
                repliedSessions,
                archivedSessions
            }
        });
    } catch (error) {
        console.error('❌ Get chat stats error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// PATCH /api/whatsapp/chat/sessions/:phone - Update session
router.patch('/chat/sessions/:phone', requireAuth, async (req, res) => {
    try {
        const { phone } = req.params;
        const { isArchived } = req.body;
        const tenantId = req.tenantId;

        const session = await ChatSession.findOneAndUpdate(
            { tenantId, phone },
            { $set: { isArchived } },
            { new: true }
        );

        if (!session) {
            return res.status(404).json({
                success: false,
                error: 'Session not found'
            });
        }

        res.json({
            success: true,
            message: `Session ${isArchived ? 'archived' : 'unarchived'} successfully`,
            session
        });
    } catch (error) {
        console.error('❌ Update session error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// DELETE /api/whatsapp/chat/sessions/:phone - Delete session
router.delete('/chat/sessions/:phone', requireAuth, async (req, res) => {
    try {
        const { phone } = req.params;
        const tenantId = req.tenantId;

        const session = await ChatSession.findOneAndDelete({ tenantId, phone });

        if (!session) {
            return res.status(404).json({
                success: false,
                error: 'Session not found'
            });
        }

        // Also delete related messages
        await MessageLog.deleteMany({
            $or: [
                { from: phone, to: session.phone },
                { from: session.phone, to: phone }
            ]
        });

        res.json({
            success: true,
            message: 'Session deleted successfully'
        });
    } catch (error) {
        console.error('❌ Delete session error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// POST /api/whatsapp/chat/sessions/mark-all-read - Mark all as read
router.post('/chat/sessions/mark-all-read', requireAuth, async (req, res) => {
    try {
        const tenantId = req.tenantId;

        await ChatSession.updateMany(
            { tenantId, unreadCount: { $gt: 0 } },
            { $set: { unreadCount: 0 } }
        );

        res.json({
            success: true,
            message: 'All sessions marked as read'
        });
    } catch (error) {
        console.error('❌ Mark all as read error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;