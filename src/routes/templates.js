const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/auth');
const Template = require('../models/Template');
const axios = require('axios');
const { validateTextMessage, validateTemplatePlaceholders, isHttpsUrl } = require('../utils/validators');

const PAGE_ACCESS_TOKEN = process.env.META_WA_TOKEN;
const WHATSAPP_BUSINESS_ACCOUNT_ID = process.env.META_WA_BUSINESS_ID || '1502633441171423';
const GRAPH_VERSION = process.env.META_WA_GRAPH_VERSION || 'v17.0';

// Helper to construct the components array for both Facebook API and DB save
function buildTemplateComponents(template) {
    const components = [];

    if (template.header) {
        components.push({
            type: 'HEADER',
            format: template.header.format, // IMAGE / VIDEO / TEXT / DOCUMENT
            text: template.header.text || undefined
        });
    }

    if (template.body) {
        components.push({
            type: 'BODY',
            text: template.body
        });
    }

    if (template.footer) {
        components.push({
            type: 'FOOTER',
            text: template.footer
        });
    }

    if (template.buttons && template.buttons.length) {
        components.push({
            type: 'BUTTONS',
            buttons: template.buttons.map(btn => {
                if (btn.type === 'URL') {
                    return {
                        type: 'URL',
                        text: btn.text,
                        url: btn.url
                    };
                }
                if (btn.type === 'PHONE_NUMBER') {
                    return {
                        type: 'PHONE_NUMBER',
                        text: btn.text,
                        phone_number: btn.phone
                    };
                }
                return {
                    type: 'QUICK_REPLY',
                    text: btn.text
                };
            })
        });
    }
    return components;
}

// ============================================
// NEW: Fetch approved templates from Meta API
// ============================================

/**
 * Fetch all approved templates from Meta
 */
async function fetchMetaTemplates() {
    try {
        console.log('🔍 Fetching templates from Meta API...');
        
        const url = `https://graph.facebook.com/${GRAPH_VERSION}/${WHATSAPP_BUSINESS_ACCOUNT_ID}/message_templates`;
        
        console.log('API URL:', url);
        
        const response = await axios.get(url, {
            headers: {
                'Authorization': `Bearer ${PAGE_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            params: {
                fields: 'name,language,status,category,components'
            }
        });

        console.log('✅ API Response received');
        console.log('Total templates:', response.data.data?.length || 0);
        
        // Filter only APPROVED templates
        const approvedTemplates = response.data.data?.filter(template => 
            template.status === 'APPROVED'
        ) || [];

        console.log('✅ Approved templates:', approvedTemplates.length);
        
        // Log each template
        approvedTemplates.forEach((template, index) => {
            console.log(`${index + 1}. ${template.name} [${template.language}] - ${template.category}`);
        });

        return {
            success: true,
            templates: approvedTemplates,
            total: approvedTemplates.length
        };

    } catch (error) {
        console.error('❌ Meta API Fetch Error:', error.response?.data || error.message);
        return {
            success: false,
            error: error.response?.data?.error?.message || error.message,
            templates: [],
            total: 0
        };
    }
}

/**
 * Get template details by name from Meta
 */
async function fetchMetaTemplateByName(templateName, language = 'en_US') {
    try {
        const url = `https://graph.facebook.com/${GRAPH_VERSION}/${WHATSAPP_BUSINESS_ACCOUNT_ID}/message_templates`;
        
        const response = await axios.get(url, {
            headers: {
                'Authorization': `Bearer ${PAGE_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            params: {
                name: templateName,
                fields: 'name,language,status,category,components,quality_score'
            }
        });

        const templates = response.data.data || [];
        
        // Find template with matching language
        let template = templates.find(t => t.language === language);
        
        // If not found, get first approved template with this name
        if (!template) {
            template = templates.find(t => t.status === 'APPROVED');
        }

        if (!template) {
            return {
                success: false,
                error: `Template "${templateName}" not found or not approved`
            };
        }

        return {
            success: true,
            template: template
        };

    } catch (error) {
        console.error(`Meta API Fetch Error for ${templateName}:`, error.response?.data || error.message);
        return {
            success: false,
            error: error.response?.data?.error?.message || error.message
        };
    }
}

// Helper to extract variables from template components
function extractTemplateVariables(components) {
    if (!components || !Array.isArray(components)) return [];
    
    const variables = [];
    
    components.forEach(component => {
        const type = component.type?.toUpperCase();
        
        if (type === 'HEADER') {
            // Check for text header
            if (component.format === 'TEXT' && component.text) {
                const matches = component.text.match(/{{(\d+)}}/g) || [];
                matches.forEach(match => {
                    const varNum = match.match(/\d+/)[0];
                    variables.push({
                        type: 'header',
                        number: parseInt(varNum),
                        placeholder: match,
                        description: `Header variable ${varNum}`
                    });
                });
            }
        }
        
        if (type === 'BODY' && component.text) {
            const matches = component.text.match(/{{(\d+)}}/g) || [];
            matches.forEach(match => {
                const varNum = match.match(/\d+/)[0];
                variables.push({
                    type: 'body',
                    number: parseInt(varNum),
                    placeholder: match,
                    description: `Body variable ${varNum}`
                });
            });
        }
        
        if (type === 'BUTTONS' && component.buttons) {
            component.buttons.forEach((button, index) => {
                if (button.type === 'URL' && button.url) {
                    const matches = button.url.match(/{{(\d+)}}/g) || [];
                    matches.forEach(match => {
                        const varNum = match.match(/\d+/)[0];
                        variables.push({
                            type: 'button_url',
                            number: parseInt(varNum),
                            placeholder: match,
                            description: `Button ${index + 1} URL variable ${varNum}`
                        });
                    });
                }
            });
        }
    });
    
    // Sort by variable number
    return variables.sort((a, b) => a.number - b.number);
}

// ============================================
// NEW ROUTES FOR META TEMPLATES
// ============================================

// GET: Fetch approved templates from Meta
router.get('/meta-templates', requireAuth, async (req, res) => {
    try {
        console.log(`📞 Fetching meta templates for tenant: ${req.tenantId}`);
        
        const result = await fetchMetaTemplates();
        
        if (!result.success) {
            console.error('Failed to fetch templates:', result.error);
            return res.status(500).json({
                success: false,
                error: 'Failed to fetch templates from Meta',
                details: result.error
            });
        }

        console.log(`✅ Formatting ${result.templates.length} templates for frontend`);
        
        // Format templates for frontend
        const formattedTemplates = result.templates.map(template => {
            const templateId = `${template.name}::${template.language}`;
            const variables = extractTemplateVariables(template.components);
            
            console.log(`   - ${template.name} [${template.language}]: ${variables.length} variables`);
            
            return {
                id: templateId,
                name: template.name,
                language: template.language,
                category: template.category,
                status: template.status,
                quality_score: template.quality_score,
                components: template.components || [],
                variables: variables,
                variableCount: variables.length
            };
        });

        console.log(`🎯 Returning ${formattedTemplates.length} templates to frontend`);

        res.json({
            success: true,
            templates: formattedTemplates,
            total: result.total
        });

    } catch (error) {
        console.error('❌ Error fetching Meta templates:', error);
        res.status(500).json({
            success: false,
            error: 'Server error',
            details: error.message
        });
    }
});

// GET: Get template details by name from Meta
router.get('/meta/:templateName', requireAuth, async (req, res) => {
    try {
        const { templateName } = req.params;
        const { language = 'en_US' } = req.query;
        
        const result = await fetchMetaTemplateByName(templateName, language);
        
        if (!result.success) {
            return res.status(404).json({
                error: 'Template not found on Meta',
                details: result.error
            });
        }

        const template = result.template;
        
        // Format template details
        const formattedTemplate = {
            id: `${template.name}::${template.language}`,
            name: template.name,
            language: template.language,
            category: template.category,
            status: template.status,
            quality_score: template.quality_score,
            components: template.components || [],
            variables: extractTemplateVariables(template.components)
        };

        res.json({
            success: true,
            template: formattedTemplate
        });

    } catch (error) {
        console.error('Error getting template details from Meta:', error);
        res.status(500).json({
            error: 'Server error',
            details: error.message
        });
    }
});

// GET: Sync Meta templates to local database
router.post('/meta/sync', requireAuth, async (req, res) => {
    try {
        const result = await fetchMetaTemplates();
        
        if (!result.success) {
            return res.status(500).json({
                error: 'Failed to fetch templates from Meta',
                details: result.error
            });
        }

        const syncedTemplates = [];
        const errors = [];

        // Sync each template to local DB
        for (const metaTemplate of result.templates) {
            try {
                // Check if template already exists
                const existingTemplate = await Template.findOne({
                    tenantId: req.tenantId,
                    name: metaTemplate.name,
                    language: metaTemplate.language
                });

                if (existingTemplate) {
                    // Update existing template
                    await Template.findByIdAndUpdate(existingTemplate._id, {
                        components: metaTemplate.components || [],
                        category: metaTemplate.category,
                        status: metaTemplate.status,
                        quality_score: metaTemplate.quality_score,
                        updatedAt: new Date()
                    });
                    syncedTemplates.push({
                        name: metaTemplate.name,
                        language: metaTemplate.language,
                        action: 'updated'
                    });
                } else {
                    // Create new template
                    await Template.create({
                        tenantId: req.tenantId,
                        name: metaTemplate.name,
                        type: 'whatsapp',
                        components: metaTemplate.components || [],
                        language: metaTemplate.language,
                        category: metaTemplate.category,
                        status: metaTemplate.status,
                        quality_score: metaTemplate.quality_score,
                        fbTemplateId: metaTemplate.id
                    });
                    syncedTemplates.push({
                        name: metaTemplate.name,
                        language: metaTemplate.language,
                        action: 'created'
                    });
                }
            } catch (syncError) {
                errors.push({
                    template: metaTemplate.name,
                    error: syncError.message
                });
            }
        }

        res.json({
            success: true,
            message: `Synced ${syncedTemplates.length} templates from Meta`,
            synced: syncedTemplates,
            errors: errors.length > 0 ? errors : undefined,
            total: result.total
        });

    } catch (error) {
        console.error('Error syncing Meta templates:', error);
        res.status(500).json({
            error: 'Server error',
            details: error.message
        });
    }
});

// ============================================
// EXISTING ROUTES (with improvements)
// ============================================

// Helper to create WhatsApp template on Facebook Business Manager using Axios
async function createWhatsAppTemplateOnFacebook(template) {
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${WHATSAPP_BUSINESS_ACCOUNT_ID}/message_templates`;

    const sanitizedTemplateName = template.name.replace(/\s+/g, '_').toLowerCase();
    const validCategories = ['UTILITY', 'MARKETING', 'AUTHENTICATION'];
    const category = validCategories.includes(template.category) ? template.category : 'MARKETING';

    const components = buildTemplateComponents(template); 

    const body = {
        name: sanitizedTemplateName,
        language: template.language || 'en_US',
        category: category,
        components
    };

    try {
        const res = await axios.post(url, body, {
            headers: {
                'Authorization': `Bearer ${PAGE_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });
        return res.data;
    } catch (error) {
        console.error('Facebook API (Create) error:', error.response ? error.response.data : error.message);
        throw new Error(error.response ? JSON.stringify(error.response.data) : error.message);
    }
}

// NEW Helper to delete WhatsApp template from Facebook Business Manager
async function deleteTemplateFromFacebook(templateName) {
    const sanitizedTemplateName = templateName.replace(/\s+/g, '_').toLowerCase();
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${WHATSAPP_BUSINESS_ACCOUNT_ID}/message_templates`;

    try {
        const res = await axios.delete(url, {
            headers: {
                'Authorization': `Bearer ${PAGE_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            data: {
                name: sanitizedTemplateName
            }
        });
        return res.data;
    } catch (error) {
        // Log error but don't re-throw, as template might be gone or in an undeletable state
        console.warn(`Facebook API (Delete) warning for ${sanitizedTemplateName}:`, error.response ? error.response.data : error.message);
        return { success: false, message: 'Deletion attempt failed or not necessary.' };
    }
}

// --- POST: Create New Template ---
router.post('/', requireAuth, async (req, res) => {
    try {
        const { name, type, body, mediaUrl, placeholders = [], language, category, header, footer, buttons } = req.body;
        
        // 1. Basic Validation
        if (!name) return res.status(400).json({ error: 'Template name required' });
        
        // Validate placeholders
        if (placeholders.length > 10) {
            return res.status(400).json({ error: 'Maximum 10 placeholders allowed' });
        }

        // 2. Build Components Array (The Facebook Format)
        const templateDataForFBAndDB = { name, body, mediaUrl, language, category, header, footer, buttons };
        const components = buildTemplateComponents(templateDataForFBAndDB);

        // 3. Create Template on Facebook
        let fbResponse;
        try {
            fbResponse = await createWhatsAppTemplateOnFacebook(templateDataForFBAndDB);
        } catch (fbErr) {
            return res.status(400).json({ error: 'Facebook API error: ' + fbErr.message });
        }

        // 4. Save Template to Local DB in Consistent Format
        const doc = await Template.create({
            tenantId: req.tenantId,
            name,
            type,
            components: components, 
            mediaUrl: mediaUrl || '',
            placeholders,
            language: language || 'en_US',
            category: category || 'MARKETING',
            fbTemplateId: fbResponse.id || null,
            status: 'PENDING'
        });

        res.json(doc);
    } catch (err) {
        console.error('templates.js create error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// --- NEW: PUT /:id - Edit/Update Template ---
router.put('/:id', requireAuth, async (req, res) => {
    try {
        const { name, type, body, mediaUrl, placeholders = [], language, category, header, footer, buttons } = req.body;
        
        if (!name) return res.status(400).json({ error: 'Template name required' });
        
        // Validate placeholders
        if (placeholders.length > 10) {
            return res.status(400).json({ error: 'Maximum 10 placeholders allowed' });
        }

        // 1. Find the existing template
        const existingTemplate = await Template.findOne({ _id: req.params.id, tenantId: req.tenantId });
        if (!existingTemplate) return res.status(404).json({ error: 'Template not found' });

        const oldFbName = existingTemplate.name;

        // 2. Build New Components Array
        const newTemplateDataForFBAndDB = { name, body, mediaUrl, language, category, header, footer, buttons };
        const components = buildTemplateComponents(newTemplateDataForFBAndDB);

        // 3. Delete Old Template from Facebook
        if (existingTemplate.fbTemplateId) {
            await deleteTemplateFromFacebook(oldFbName);
        }

        // 4. Create New Template on Facebook
        let fbResponse;
        try {
            fbResponse = await createWhatsAppTemplateOnFacebook(newTemplateDataForFBAndDB);
        } catch (fbErr) {
            return res.status(400).json({ error: 'Facebook API error on re-creation: ' + fbErr.message });
        }

        // 5. Update Local DB
        const updatedDoc = await Template.findOneAndUpdate(
            { _id: req.params.id, tenantId: req.tenantId },
            {
                name,
                type,
                components: components,
                mediaUrl: mediaUrl || '',
                placeholders,
                language: language || 'en_US',
                category: category || 'MARKETING',
                fbTemplateId: fbResponse.id || null,
                status: 'PENDING',
                updatedAt: new Date()
            },
            { new: true }
        );

        res.json(updatedDoc);
    } catch (err) {
        console.error('templates.js update error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// --- GET: List Templates (local + meta) ---
router.get('/', requireAuth, async (req, res) => {
    try {
        const { source = 'all' } = req.query; // 'local', 'meta', 'all'
        
        let templates = [];
        
        if (source === 'local' || source === 'all') {
            const localTemplates = await Template.find({ tenantId: req.tenantId }).sort({ createdAt: -1 });
            templates = templates.concat(localTemplates.map(t => ({ ...t.toObject(), source: 'local' })));
        }
        
        if (source === 'meta' || source === 'all') {
            const metaResult = await fetchMetaTemplates();
            if (metaResult.success) {
                const metaTemplates = metaResult.templates.map(t => ({
                    ...t,
                    source: 'meta',
                    id: `${t.name}::${t.language}`,
                    variables: extractTemplateVariables(t.components)
                }));
                templates = templates.concat(metaTemplates);
            }
        }
        
        res.json(templates);
    } catch (err) {
        console.error('templates.js list error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// --- DELETE: Delete Template (Local DB + Facebook API) ---
router.delete('/:id', requireAuth, async (req, res) => {
    try {
        const template = await Template.findOne({ _id: req.params.id, tenantId: req.tenantId });

        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }

        // 1. Delete from Facebook
        if (template.fbTemplateId) {
            await deleteTemplateFromFacebook(template.name);
        }

        // 2. Delete from Local DB
        await Template.deleteOne({ _id: req.params.id, tenantId: req.tenantId });
        
        res.json({ success: true, message: 'Template deleted from local DB and Facebook API.' });
    } catch (err) {
        console.error('templates.js delete error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET: Get template by ID
router.get('/:id', requireAuth, async (req, res) => {
    try {
        const template = await Template.findOne({ _id: req.params.id, tenantId: req.tenantId });
        
        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }
        
        res.json(template);
    } catch (err) {
        console.error('templates.js get error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Debug endpoint
router.get('/debug', async (req, res) => {
    try {
        const TOKEN = process.env.META_WA_TOKEN;
        const WABA_ID = process.env.META_WA_BUSINESS_ID;
        const GRAPH_VERSION = process.env.META_WA_GRAPH_VERSION || 'v17.0';
        
        console.log('🔍 Debug Template Fetch:');
        console.log('  TOKEN present:', !!TOKEN);
        console.log('  WABA_ID:', WABA_ID);
        
        if (!TOKEN || !WABA_ID) {
            return res.json({
                success: false,
                error: 'Missing environment variables',
                token: !!TOKEN,
                wabaId: !!WABA_ID
            });
        }
        
        // Test 1: Get account info
        console.log('\n1. Testing Account Info...');
        const accountUrl = `https://graph.facebook.com/${GRAPH_VERSION}/${WABA_ID}`;
        
        let accountInfo;
        try {
            const accountRes = await axios.get(accountUrl, {
                headers: { 'Authorization': `Bearer ${TOKEN}` }
            });
            accountInfo = accountRes.data;
            console.log('   ✅ Account Info:', JSON.stringify(accountInfo, null, 2));
        } catch (accountError) {
            console.log('   ❌ Account Error:', accountError.response?.data || accountError.message);
            accountInfo = { error: accountError.message };
        }
        
        // Test 2: Get templates
        console.log('\n2. Testing Templates...');
        const templatesUrl = `https://graph.facebook.com/${GRAPH_VERSION}/${WABA_ID}/message_templates`;
        
        let templatesData;
        try {
            const templatesRes = await axios.get(templatesUrl, {
                headers: { 'Authorization': `Bearer ${TOKEN}` },
                params: { 
                    fields: 'name,language,status,category',
                    limit: 50
                }
            });
            templatesData = templatesRes.data;
            console.log('   ✅ Templates found:', templatesData.data?.length || 0);
            
            if (templatesData.data && templatesData.data.length > 0) {
                console.log('\n   📋 All Templates:');
                templatesData.data.forEach((template, index) => {
                    console.log(`   ${index + 1}. ${template.name} [${template.language}] - ${template.status}`);
                });
            }
        } catch (templatesError) {
            console.log('   ❌ Templates Error:', templatesError.response?.data || templatesError.message);
            templatesData = { error: templatesError.message };
        }
        
        // Test 3: Try with different endpoint format
        console.log('\n3. Testing with different endpoint...');
        let alternativeData;
        try {
            const altUrl = `https://graph.facebook.com/${GRAPH_VERSION}/me/message_templates`;
            const altRes = await axios.get(altUrl, {
                headers: { 'Authorization': `Bearer ${TOKEN}` },
                params: { fields: 'name,status' }
            });
            alternativeData = altRes.data;
            console.log('   ✅ Alternative endpoint templates:', alternativeData.data?.length || 0);
        } catch (altError) {
            console.log('   ❌ Alternative endpoint error:', altError.message);
            alternativeData = { error: altError.message };
        }
        
        res.json({
            success: true,
            accountInfo: accountInfo,
            templates: templatesData,
            alternative: alternativeData,
            env: {
                hasToken: !!TOKEN,
                hasWabaId: !!WABA_ID,
                tokenLength: TOKEN?.length,
                wabaId: WABA_ID
            }
        });
        
    } catch (error) {
        console.error('Overall error:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            stack: error.stack
        });
    }
});

module.exports = router;