const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/auth');
const Template = require('../models/Template');
const axios = require('axios');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const FormData = require('form-data');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads/templates/';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, `template_${uniqueSuffix}${ext}`);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { 
    fileSize: 16 * 1024 * 1024,
    files: 5
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|bmp|webp|mp4|mov|avi|mkv|wmv|flv|pdf|doc|docx|xlsx|xls|ppt|pptx|txt/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('File type not supported'));
    }
  }
});

// Meta API Configuration
const PAGE_ACCESS_TOKEN = process.env.META_WA_TOKEN;
const WHATSAPP_BUSINESS_ACCOUNT_ID = process.env.META_WA_BUSINESS_ID;
const GRAPH_VERSION = process.env.META_WA_GRAPH_VERSION || 'v19.0';
const PHONE_NUMBER_ID = process.env.META_WA_PHONE_ID;

// ============================================
// META API FUNCTIONS - FIXED
// ============================================

// Upload media to Meta
async function uploadMediaToMeta(filePath, mediaType) {
  try {
    const uploadUrl = `https://graph.facebook.com/${GRAPH_VERSION}/${WHATSAPP_BUSINESS_ACCOUNT_ID}/uploads`;
    
    const form = new FormData();
    form.append('file', fs.createReadStream(filePath));
    form.append('type', mediaType);
    form.append('messaging_product', 'whatsapp');
    
    const response = await axios.post(uploadUrl, form, {
      headers: {
        'Authorization': `Bearer ${PAGE_ACCESS_TOKEN}`,
        ...form.getHeaders()
      }
    });
    
    return {
      success: true,
      id: response.data.id
    };
  } catch (error) {
    console.error('❌ Media upload error:', error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data?.error?.message || error.message
    };
  }
}

// Create template on Meta
async function createTemplateOnMeta(templateData, headerFile = null) {
  try {
    console.log('📤 Creating template on Meta:', templateData.name);
    
    if (!PAGE_ACCESS_TOKEN || !WHATSAPP_BUSINESS_ACCOUNT_ID) {
      return {
        success: false,
        error: 'Meta API credentials not configured'
      };
    }
    
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${WHATSAPP_BUSINESS_ACCOUNT_ID}/message_templates`;
    
    // Format template name
    const templateName = templateData.name.toLowerCase().replace(/\s+/g, '_');
    
    // Build components
    const components = [];
    
    // Header component
    if (templateData.header && templateData.header.format !== 'NONE') {
      const headerComponent = {
        type: 'HEADER',
        format: templateData.header.format
      };
      
      if (templateData.header.format === 'TEXT') {
        headerComponent.text = templateData.header.text;
        if (templateData.header.text) {
          headerComponent.example = {
            header_text: [templateData.header.text]
          };
        }
      } else if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(templateData.header.format)) {
        let mediaId = null;
        
        // Upload file if exists
        if (headerFile && headerFile.path) {
          const uploadResult = await uploadMediaToMeta(
            headerFile.path, 
            templateData.header.format.toLowerCase()
          );
          
          if (uploadResult.success) {
            mediaId = uploadResult.id;
            console.log('✅ Media uploaded to Meta:', mediaId);
          }
        }
        
        // Use example URL if file upload failed
        if (!mediaId && templateData.header.example) {
          mediaId = templateData.header.example;
        }
        
        if (mediaId) {
          headerComponent.example = {
            header_handle: [mediaId]
          };
        }
      }
      
      components.push(headerComponent);
    }
    
    // Body component
    if (templateData.body) {
      const bodyComponent = {
        type: 'BODY',
        text: templateData.body
      };
      
      const variableMatches = templateData.body.match(/{{(\d+)}}/g) || [];
      if (variableMatches.length > 0) {
        const examples = [];
        for (let i = 0; i < Math.min(variableMatches.length, 10); i++) {
          examples.push(`Sample Value ${i + 1}`);
        }
        bodyComponent.example = {
          body_text: [examples]
        };
      }
      
      components.push(bodyComponent);
    }
    
    // Footer component
    if (templateData.footer && templateData.footer.trim()) {
      components.push({
        type: 'FOOTER',
        text: templateData.footer
      });
    }
    
    // Buttons component
    if (templateData.buttons && templateData.buttons.length > 0) {
      const buttonsComponent = {
        type: 'BUTTONS'
      };
      
      const metaButtons = templateData.buttons.map(button => {
        const metaButton = {
          type: button.type,
          text: button.text
        };
        
        if (button.type === 'URL') {
          metaButton.url = button.url;
          if (button.url && button.url.includes('{{')) {
            metaButton.example = [button.url.replace(/{{(\d+)}}/g, 'example.com')];
          }
        } else if (button.type === 'PHONE_NUMBER') {
          metaButton.phone_number = button.phone;
        }
        
        return metaButton;
      });
      
      buttonsComponent.buttons = metaButtons;
      components.push(buttonsComponent);
    }
    
    // Prepare request
    const requestBody = {
      name: templateName,
      language: templateData.language || 'en_US',
      category: templateData.category || 'UTILITY',
      components: components
    };

    console.log('📤 Sending to Meta API:', JSON.stringify(requestBody, null, 2));

    const response = await axios.post(url, requestBody, {
      headers: {
        'Authorization': `Bearer ${PAGE_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      timeout: 60000
    });

    console.log('✅ Meta response:', response.data);
    
    return {
      success: true,
      data: response.data,
      id: response.data.id,
      name: templateName,
      status: 'PENDING'
    };
  } catch (error) {
    console.error('❌ Meta API error:');
    console.error('Status:', error.response?.status);
    console.error('Data:', error.response?.data);
    console.error('Message:', error.message);
    
    return {
      success: false,
      error: error.response?.data?.error?.message || error.message || 'Meta API failed',
      details: error.response?.data
    };
  }
}

// Delete template from Meta
async function deleteTemplateFromMeta(templateId) {
  try {
    if (!PAGE_ACCESS_TOKEN) {
      return {
        success: false,
        error: 'Meta credentials missing'
      };
    }
    
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${templateId}`;
    
    console.log('🗑️ Deleting template from Meta:', templateId);
    
    const response = await axios.delete(url, {
      headers: {
        'Authorization': `Bearer ${PAGE_ACCESS_TOKEN}`
      }
    });

    console.log('✅ Deleted from Meta:', response.data);
    return {
      success: true,
      data: response.data
    };
  } catch (error) {
    console.error('❌ Meta delete error:', error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data?.error?.message || error.message
    };
  }
}

// Fetch all templates from Meta
async function fetchMetaTemplates() {
  try {
    if (!PAGE_ACCESS_TOKEN || !WHATSAPP_BUSINESS_ACCOUNT_ID) {
      return {
        success: false,
        error: 'Meta credentials missing',
        templates: []
      };
    }
    
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${WHATSAPP_BUSINESS_ACCOUNT_ID}/message_templates`;
    
    const response = await axios.get(url, {
      headers: {
        'Authorization': `Bearer ${PAGE_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      params: {
        fields: 'id,name,language,status,category,components,quality_score,created_time'
      }
    });

    return {
      success: true,
      templates: response.data.data || []
    };
  } catch (error) {
    console.error('❌ Fetch Meta templates error:', error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data?.error?.message || error.message,
      templates: []
    };
  }
}

// Get single template from Meta
async function getTemplateFromMeta(templateName, language = 'en_US') {
  try {
    const result = await fetchMetaTemplates();
    if (!result.success) return null;
    
    const formattedName = templateName.toLowerCase().replace(/\s+/g, '_');
    return result.templates.find(t => 
      t.name.toLowerCase() === formattedName && 
      t.language === language
    );
  } catch (error) {
    console.error('Get template from Meta error:', error);
    return null;
  }
}

// Send test message
async function sendTestMessage(templateName, phoneNumber, language = 'en_US', variables = {}) {
  try {
    if (!PAGE_ACCESS_TOKEN || !PHONE_NUMBER_ID) {
      return {
        success: false,
        error: 'WhatsApp API not configured'
      };
    }
    
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`;
    
    const messageData = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phoneNumber,
      type: 'template',
      template: {
        name: templateName,
        language: {
          code: language
        }
      }
    };
    
    // Add variables if any
    const components = [];
    const bodyVariables = Object.keys(variables).filter(key => key.startsWith('{{'));
    
    if (bodyVariables.length > 0) {
      const parameters = [];
      bodyVariables.forEach(key => {
        const match = key.match(/{{(\d+)}}/);
        if (match) {
          parameters.push({
            type: 'text',
            text: variables[key] || `Value ${match[1]}`
          });
        }
      });
      
      if (parameters.length > 0) {
        components.push({
          type: 'BODY',
          parameters: parameters
        });
      }
    }
    
    if (components.length > 0) {
      messageData.template.components = components;
    }
    
    const response = await axios.post(url, messageData, {
      headers: {
        'Authorization': `Bearer ${PAGE_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    return {
      success: true,
      data: response.data
    };
  } catch (error) {
    console.error('Test message error:', error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data?.error?.message || error.message
    };
  }
}

// ============================================
// HELPER FUNCTIONS
// ============================================

// Validate template data
function validateTemplateData(templateData) {
  const errors = [];
  
  if (!templateData.name || templateData.name.trim().length === 0) {
    errors.push('Template name is required');
  }
  
  const nameRegex = /^[a-z0-9_]+$/;
  if (!nameRegex.test(templateData.name.toLowerCase().replace(/\s+/g, '_'))) {
    errors.push('Template name can only contain lowercase letters, numbers, and underscores');
  }
  
  if (!templateData.body || templateData.body.trim().length === 0) {
    errors.push('Body text is required');
  }
  
  if (templateData.body.length > 1024) {
    errors.push('Body text cannot exceed 1024 characters');
  }
  
  if (templateData.header?.format === 'TEXT') {
    if (!templateData.header.text || templateData.header.text.trim().length === 0) {
      errors.push('Header text is required for TEXT format');
    }
    if (templateData.header.text.length > 60) {
      errors.push('Header text cannot exceed 60 characters');
    }
  }
  
  if (templateData.footer && templateData.footer.length > 60) {
    errors.push('Footer text cannot exceed 60 characters');
  }
  
  if (templateData.buttons && templateData.buttons.length > 0) {
    if (templateData.buttons.length > 3) {
      errors.push('Maximum 3 buttons allowed');
    }
    
    templateData.buttons.forEach((button, index) => {
      if (!button.text || button.text.trim().length === 0) {
        errors.push(`Button ${index + 1}: Text is required`);
      }
      
      if (button.text.length > 25) {
        errors.push(`Button ${index + 1}: Text cannot exceed 25 characters`);
      }
      
      if (button.type === 'URL') {
        if (!button.url || button.url.trim().length === 0) {
          errors.push(`Button ${index + 1}: URL is required for URL button`);
        }
      }
      
      if (button.type === 'PHONE_NUMBER') {
        if (!button.phone || button.phone.trim().length === 0) {
          errors.push(`Button ${index + 1}: Phone number is required`);
        }
        const phoneRegex = /^\+[1-9]\d{1,14}$/;
        if (!phoneRegex.test(button.phone)) {
          errors.push(`Button ${index + 1}: Invalid phone number format (must be E.164: +1234567890)`);
        }
      }
    });
  }
  
  return errors;
}

// Extract data from Meta components
function extractFromMetaComponents(metaTemplate) {
  const result = {
    body: '',
    header: { format: 'NONE' },
    footer: '',
    buttons: [],
    variables: []
  };
  
  if (!metaTemplate.components) return result;
  
  metaTemplate.components.forEach(component => {
    switch(component.type) {
      case 'HEADER':
        result.header = {
          format: component.format || 'NONE',
          text: component.text || ''
        };
        break;
        
      case 'BODY':
        result.body = component.text || '';
        // Extract variables
        const bodyMatches = component.text?.match(/{{(\d+)}}/g) || [];
        bodyMatches.forEach(match => {
          const num = match.match(/\d+/)[0];
          result.variables.push({
            type: 'body',
            number: parseInt(num),
            placeholder: match,
            description: `Body variable ${num}`,
            example: `Value ${num}`
          });
        });
        break;
        
      case 'FOOTER':
        result.footer = component.text || '';
        break;
        
      case 'BUTTONS':
        if (component.buttons) {
          result.buttons = component.buttons.map(btn => ({
            type: btn.type,
            text: btn.text,
            url: btn.url || '',
            phone: btn.phone_number || ''
          }));
        }
        break;
    }
  });
  
  return result;
}

// ============================================
// TEMPLATE ROUTES
// ============================================

// GET: Template statistics
router.get('/stats/overview', requireAuth, async (req, res) => {
  try {
    const stats = await Template.getStats(req.tenantId);
    res.json({
      success: true,
      stats
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch statistics'
    });
  }
});

// POST: Sync templates from Meta
router.post('/sync/meta', requireAuth, async (req, res) => {
  try {
    console.log('🔄 Syncing templates from Meta...');
    
    const result = await fetchMetaTemplates();
    
    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error
      });
    }

    const synced = [];
    const errors = [];

    for (const metaTemplate of result.templates) {
      try {
        const existing = await Template.findOne({
          tenantId: req.tenantId,
          name: metaTemplate.name,
          language: metaTemplate.language,
          status: { $ne: 'DELETED' }
        });

        const extracted = extractFromMetaComponents(metaTemplate);
        
        if (existing) {
          // Update existing
          await Template.findByIdAndUpdate(existing._id, {
            status: metaTemplate.status,
            category: metaTemplate.category,
            components: metaTemplate.components,
            quality_score: metaTemplate.quality_score,
            fbTemplateId: metaTemplate.id,
            ...extracted,
            updatedAt: new Date(),
            source: 'meta',
            metaUpdatedAt: new Date(metaTemplate.created_time),
            lastSyncedAt: new Date()
          });
          
          synced.push({
            id: existing._id,
            name: metaTemplate.name,
            status: metaTemplate.status,
            action: 'updated'
          });
        } else {
          // Create new
          const template = new Template({
            tenantId: req.tenantId,
            name: metaTemplate.name,
            language: metaTemplate.language,
            category: metaTemplate.category,
            status: metaTemplate.status,
            components: metaTemplate.components,
            fbTemplateId: metaTemplate.id,
            quality_score: metaTemplate.quality_score,
            createdBy: req.userId,
            source: 'meta',
            ...extracted,
            metaCreatedAt: new Date(metaTemplate.created_time),
            lastSyncedAt: new Date()
          });
          
          await template.save();
          synced.push({
            id: template._id,
            name: metaTemplate.name,
            status: metaTemplate.status,
            action: 'created'
          });
        }
      } catch (error) {
        errors.push({
          template: metaTemplate.name,
          error: error.message
        });
      }
    }

    res.json({
      success: true,
      message: `Synced ${synced.length} templates`,
      synced,
      errors: errors.length > 0 ? errors : undefined,
      total: result.templates.length
    });
  } catch (error) {
    console.error('Sync error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to sync templates'
    });
  }
});

// GET: List all templates (excluding deleted)
router.get('/', requireAuth, async (req, res) => {
  try {
    const { 
      category, 
      status, 
      language, 
      search,
      hasHeader,
      hasButtons,
      source,
      limit = 50,
      page = 1
    } = req.query;
    
    const query = { 
      tenantId: req.tenantId,
      status: { $ne: 'DELETED' }
    };
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Apply filters
    if (category && category !== 'all') query.category = category;
    if (status && status !== 'all') query.status = status;
    if (language) query.language = language;
    if (source) query.source = source;
    
    if (hasHeader === 'true') query['header.format'] = { $ne: 'NONE' };
    if (hasHeader === 'false') query['header.format'] = 'NONE';
    
    if (hasButtons === 'true') query['buttons.0'] = { $exists: true };
    if (hasButtons === 'false') query.buttons = { $size: 0 };
    
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { body: { $regex: search, $options: 'i' } },
        { displayName: { $regex: search, $options: 'i' } },
        { category: { $regex: search, $options: 'i' } }
      ];
    }
    
    // Execute query
    const [templates, total] = await Promise.all([
      Template.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Template.countDocuments(query)
    ]);
    
    // Format response
    const formattedTemplates = templates.map(t => ({
      ...t,
      id: t._id.toString(),
      formattedName: t.displayName || t.name.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
      canEdit: t.source === 'local' && !['APPROVED', 'DELETED'].includes(t.status),
      canDelete: t.source === 'local' && t.status !== 'DELETED',
      canTest: t.status === 'APPROVED' && t.fbTemplateId,
      isOnMeta: !!t.fbTemplateId
    }));
    
    res.json({
      success: true,
      templates: formattedTemplates,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('List templates error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch templates'
    });
  }
});

// POST: Create new template
router.post('/', requireAuth, upload.fields([
  { name: 'headerMedia', maxCount: 1 }
]), async (req, res) => {
  try {
    const {
      name,
      body,
      language = 'en_US',
      category = 'UTILITY',
      headerType = 'NONE',
      headerText,
      headerExample,
      footer,
      buttons = '[]',
      subCategory,
      isSecured = 'false',
      privacyPolicyUrl,
      termsUrl
    } = req.body;

    console.log('📝 Creating new template:', { name, category, language, headerType });

    // Validation
    if (!name?.trim() || !body?.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Template name and body are required'
      });
    }

    // Parse buttons
    let parsedButtons = [];
    try {
      parsedButtons = JSON.parse(buttons);
    } catch (e) {
      parsedButtons = [];
    }

    // Prepare template data
    const templateData = {
      name: name.toLowerCase().replace(/\s+/g, '_'),
      body: body.trim(),
      language,
      category,
      header: { format: headerType },
      footer: footer?.trim() || '',
      buttons: parsedButtons,
      subCategory: subCategory?.trim() || undefined,
      isSecured: isSecured === 'true'
    };

    // Handle header
    const headerFile = req.files?.headerMedia?.[0];
    if (headerType === 'TEXT') {
      templateData.header.text = headerText?.trim() || '';
    } else if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerType)) {
      if (headerFile) {
        templateData.header.mediaUrl = `/uploads/templates/${headerFile.filename}`;
        templateData.header.example = templateData.header.mediaUrl;
        templateData.header.filename = headerFile.originalname;
        templateData.header.mimeType = headerFile.mimetype;
      } else if (headerExample) {
        templateData.header.example = headerExample;
      }
    }

    // Check for duplicates
    const existing = await Template.findOne({
      tenantId: req.tenantId,
      name: templateData.name,
      language: templateData.language,
      status: { $ne: 'DELETED' }
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        error: 'Template with this name and language already exists'
      });
    }

    // ============================================
    // CREATE ON META
    // ============================================
    let metaResponse = null;
    let templateStatus = 'DRAFT';
    
    if (PAGE_ACCESS_TOKEN && WHATSAPP_BUSINESS_ACCOUNT_ID) {
      console.log('🚀 Creating template on Meta...');
      metaResponse = await createTemplateOnMeta(templateData, headerFile);
      
      if (metaResponse.success) {
        templateStatus = 'PENDING';
        console.log(`✅ Created on Meta with ID: ${metaResponse.id}, Status: ${templateStatus}`);
      } else {
        console.log('⚠️ Meta creation failed:', metaResponse.error);
        // Continue saving locally even if Meta fails
      }
    } else {
      console.log('⚠️ Meta credentials missing, saving locally only');
    }

    // Save to database
    const template = new Template({
      tenantId: req.tenantId,
      name: templateData.name,
      body: templateData.body,
      language: templateData.language,
      category: templateData.category,
      subCategory: templateData.subCategory,
      header: templateData.header,
      footer: templateData.footer,
      buttons: templateData.buttons,
      status: templateStatus,
      fbTemplateId: metaResponse?.id || null,
      createdBy: req.userId,
      source: 'local',
      isSecured: templateData.isSecured,
      complianceInfo: {
        privacyPolicyUrl: privacyPolicyUrl?.trim() || undefined,
        termsUrl: termsUrl?.trim() || undefined
      },
      metaInfo: metaResponse,
      submittedAt: templateStatus === 'PENDING' ? new Date() : undefined
    });

    // Extract variables
    template.variables = template.extractVariables();
    
    await template.save();

    console.log(`✅ Template saved: ${template.name}, Status: ${template.status}, Meta ID: ${template.fbTemplateId || 'None'}`);
    
    res.json({
      success: true,
      message: metaResponse?.success 
        ? 'Template submitted to Meta for approval' 
        : 'Template saved locally',
      template: template.toObject(),
      metaResponse: metaResponse
    });
  } catch (error) {
    console.error('Create error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET: Get single template
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const template = await Template.findOne({
      _id: req.params.id,
      tenantId: req.tenantId,
      status: { $ne: 'DELETED' }
    });

    if (!template) {
      return res.status(404).json({
        success: false,
        error: 'Template not found'
      });
    }

    // Check Meta status if template is on Meta
    if (template.fbTemplateId && template.status === 'PENDING') {
      const metaTemplate = await getTemplateFromMeta(template.name, template.language);
      if (metaTemplate && metaTemplate.status !== template.status) {
        template.status = metaTemplate.status;
        template.quality_score = metaTemplate.quality_score;
        template.lastSyncedAt = new Date();
        
        if (metaTemplate.status === 'APPROVED') {
          template.approvedAt = new Date();
        }
        
        await template.save();
      }
    }

    res.json({
      success: true,
      template: template.toObject()
    });
  } catch (error) {
    console.error('Get template error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch template'
    });
  }
});

// PUT: Update template
router.put('/:id', requireAuth, upload.fields([
  { name: 'headerMedia', maxCount: 1 }
]), async (req, res) => {
  try {
    const template = await Template.findOne({
      _id: req.params.id,
      tenantId: req.tenantId,
      status: { $ne: 'DELETED' }
    });

    if (!template) {
      return res.status(404).json({
        success: false,
        error: 'Template not found'
      });
    }

    const {
      body,
      language,
      category,
      headerType,
      headerText,
      headerExample,
      footer,
      buttons = '[]',
      subCategory,
      isSecured
    } = req.body;

    // Parse buttons
    let parsedButtons = template.buttons;
    try {
      parsedButtons = JSON.parse(buttons);
    } catch (e) {
      console.warn('Buttons parse error:', e.message);
    }

    // Prepare update
    const updateData = {
      body: body?.trim() || template.body,
      language: language || template.language,
      category: category || template.category,
      footer: footer?.trim() || template.footer,
      buttons: parsedButtons,
      subCategory: subCategory?.trim() || template.subCategory,
      isSecured: isSecured !== undefined ? isSecured === 'true' : template.isSecured,
      updatedAt: new Date(),
      updatedBy: req.userId
    };

    // Handle header
    const headerFile = req.files?.headerMedia?.[0];
    if (headerType !== undefined) {
      if (headerType === 'NONE') {
        updateData.header = { format: 'NONE' };
      } else {
        updateData.header = {
          format: headerType
        };

        if (headerType === 'TEXT') {
          updateData.header.text = headerText?.trim() || '';
        } else if (['IMAGE', 'VIDEO', 'DOCUMENT', 'LOCATION'].includes(headerType)) {
          if (headerFile) {
            updateData.header.mediaUrl = `/uploads/templates/${headerFile.filename}`;
            updateData.header.example = updateData.header.mediaUrl;
            updateData.header.filename = headerFile.originalname;
            updateData.header.mimeType = headerFile.mimetype;
          } else if (headerExample) {
            updateData.header.example = headerExample;
          } else {
            updateData.header = template.header;
          }
        }
      }
    }

    // ============================================
    // UPDATE ON META IF EXISTS
    // ============================================
    if (template.fbTemplateId && PAGE_ACCESS_TOKEN) {
      try {
        // Delete old template from Meta
        await deleteTemplateFromMeta(template.fbTemplateId);
        console.log(`🗑️ Deleted old template from Meta: ${template.name}`);
        
        // Create new template with updated data
        const newTemplateData = {
          name: template.name,
          language: updateData.language,
          category: updateData.category,
          body: updateData.body,
          header: updateData.header,
          footer: updateData.footer,
          buttons: updateData.buttons
        };
        
        const metaResponse = await createTemplateOnMeta(newTemplateData, headerFile);
        
        if (metaResponse.success) {
          updateData.fbTemplateId = metaResponse.id;
          updateData.status = 'PENDING';
          updateData.metaInfo = metaResponse;
          updateData.submittedAt = new Date();
          console.log(`✅ Re-created on Meta with new ID: ${metaResponse.id}`);
        } else {
          console.log('⚠️ Meta re-creation failed:', metaResponse.error);
        }
      } catch (metaError) {
        console.error('Meta update error:', metaError);
      }
    }

    // Update in database
    const updatedTemplate = await Template.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    );

    // Extract variables
    updatedTemplate.variables = updatedTemplate.extractVariables();
    await updatedTemplate.save();

    res.json({
      success: true,
      message: 'Template updated successfully',
      template: updatedTemplate.toObject()
    });
  } catch (error) {
    console.error('Update error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update template'
    });
  }
});

// DELETE: Delete template (from both Meta and local)
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const template = await Template.findOne({
      _id: req.params.id,
      tenantId: req.tenantId,
      status: { $ne: 'DELETED' }
    });

    if (!template) {
      return res.status(404).json({
        success: false,
        error: 'Template not found'
      });
    }

    // ============================================
    // DELETE FROM META IF EXISTS
    // ============================================
    let metaDeleteResult = null;
    if (template.fbTemplateId && PAGE_ACCESS_TOKEN) {
      console.log(`🗑️ Deleting template from Meta: ${template.name} (ID: ${template.fbTemplateId})`);
      metaDeleteResult = await deleteTemplateFromMeta(template.fbTemplateId);
      
      if (metaDeleteResult.success) {
        console.log(`✅ Deleted from Meta: ${template.name}`);
      } else {
        console.log(`⚠️ Meta delete warning: ${metaDeleteResult.error}`);
        // Continue with local deletion even if Meta delete fails
      }
    }

    // Soft delete from database
    template.status = 'DELETED';
    template.deletedAt = new Date();
    await template.save();

    console.log(`✅ Marked as deleted in database: ${template.name}`);

    res.json({
      success: true,
      message: 'Template deleted successfully',
      metaDelete: metaDeleteResult,
      template: {
        id: template._id,
        name: template.name,
        wasOnMeta: !!template.fbTemplateId
      }
    });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete template'
    });
  }
});

// POST: Duplicate template
router.post('/:id/duplicate', requireAuth, async (req, res) => {
  try {
    const { newName } = req.body;
    
    const template = await Template.findOne({
      _id: req.params.id,
      tenantId: req.tenantId,
      status: { $ne: 'DELETED' }
    });

    if (!template) {
      return res.status(404).json({
        success: false,
        error: 'Template not found'
      });
    }

    if (!newName || !newName.trim()) {
      return res.status(400).json({
        success: false,
        error: 'New template name is required'
      });
    }

    // Check if new name already exists
    const existing = await Template.findOne({
      tenantId: req.tenantId,
      name: newName.toLowerCase().replace(/\s+/g, '_'),
      language: template.language,
      status: { $ne: 'DELETED' }
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        error: 'Template with this name already exists'
      });
    }

    // Create duplicate (without Meta template ID)
    const duplicate = await template.duplicate(newName.toLowerCase().replace(/\s+/g, '_'));
    
    res.json({
      success: true,
      message: 'Template duplicated successfully',
      template: duplicate.toObject()
    });
  } catch (error) {
    console.error('Duplicate error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to duplicate template'
    });
  }
});

// POST: Send test message
router.post('/:id/test', requireAuth, async (req, res) => {
  try {
    const { phoneNumber, variables = {} } = req.body;
    
    const template = await Template.findOne({
      _id: req.params.id,
      tenantId: req.tenantId,
      status: { $ne: 'DELETED' }
    });

    if (!template) {
      return res.status(404).json({
        success: false,
        error: 'Template not found'
      });
    }

    // Check if template is approved
    if (template.status !== 'APPROVED') {
      return res.status(400).json({
        success: false,
        error: 'Template must be approved to send test messages'
      });
    }

    // Send test message
    const result = await sendTestMessage(template.name, phoneNumber, template.language, variables);
    
    if (result.success) {
      // Update usage stats
      template.usageCount = (template.usageCount || 0) + 1;
      template.lastUsed = new Date();
      await template.save();
      
      res.json({
        success: true,
        message: 'Test message sent successfully',
        data: result.data
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    console.error('Test send error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send test message'
    });
  }
});

// GET: Force sync status
router.get('/:id/sync-status', requireAuth, async (req, res) => {
  try {
    const template = await Template.findOne({
      _id: req.params.id,
      tenantId: req.tenantId,
      status: { $ne: 'DELETED' }
    });

    if (!template) {
      return res.status(404).json({
        success: false,
        error: 'Template not found'
      });
    }

    // Check Meta status
    let statusUpdate = null;
    if (template.fbTemplateId) {
      const metaTemplate = await getTemplateFromMeta(template.name, template.language);
      if (metaTemplate && metaTemplate.status !== template.status) {
        const oldStatus = template.status;
        template.status = metaTemplate.status;
        template.quality_score = metaTemplate.quality_score;
        template.metaUpdatedAt = new Date();
        template.lastSyncedAt = new Date();
        
        if (metaTemplate.status === 'APPROVED') {
          template.approvedAt = new Date();
        }
        
        await template.save();
        
        statusUpdate = {
          oldStatus,
          newStatus: metaTemplate.status
        };
      }
    }

    if (statusUpdate) {
      res.json({
        success: true,
        message: `Status updated from ${statusUpdate.oldStatus} to ${statusUpdate.newStatus}`,
        template: template.toObject()
      });
    } else {
      res.json({
        success: true,
        message: 'Status is up to date',
        template: template.toObject()
      });
    }
  } catch (error) {
    console.error('Sync status error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to sync status'
    });
  }
});

// POST: Submit for approval
router.post('/:id/submit', requireAuth, async (req, res) => {
  try {
    const template = await Template.findOne({
      _id: req.params.id,
      tenantId: req.tenantId,
      source: 'local',
      status: { $ne: 'DELETED' }
    });

    if (!template) {
      return res.status(404).json({
        success: false,
        error: 'Template not found'
      });
    }

    if (template.status === 'APPROVED') {
      return res.status(400).json({
        success: false,
        error: 'Template is already approved'
      });
    }

    // Create on Meta if not already created
    let metaResponse = null;
    if (!template.fbTemplateId && PAGE_ACCESS_TOKEN) {
      metaResponse = await createTemplateOnMeta(template.prepareForMetaAPI());
      
      if (metaResponse.success) {
        template.fbTemplateId = metaResponse.id;
        template.status = 'PENDING';
        template.submittedAt = new Date();
        await template.save();
        
        res.json({
          success: true,
          message: 'Template submitted to Meta for approval',
          template: template.toObject()
        });
      } else {
        res.status(400).json({
          success: false,
          error: metaResponse.error
        });
      }
    } else if (template.fbTemplateId) {
      // Already on Meta, just update status
      template.status = 'PENDING';
      template.submittedAt = new Date();
      await template.save();
      
      res.json({
        success: true,
        message: 'Template submitted for approval',
        template: template.toObject()
      });
    } else {
      res.status(400).json({
        success: false,
        error: 'Meta API not configured'
      });
    }
  } catch (error) {
    console.error('Submit error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to submit template'
    });
  }
});

// GET: Debug Meta connection
router.get('/debug/meta', requireAuth, async (req, res) => {
  try {
    const result = await fetchMetaTemplates();
    
    const credentials = {
      hasToken: !!PAGE_ACCESS_TOKEN,
      hasBusinessId: !!WHATSAPP_BUSINESS_ACCOUNT_ID,
      businessId: WHATSAPP_BUSINESS_ACCOUNT_ID,
      phoneId: PHONE_NUMBER_ID,
      graphVersion: GRAPH_VERSION
    };
    
    res.json({
      success: result.success,
      credentials,
      templates: result.templates?.map(t => ({
        id: t.id,
        name: t.name,
        status: t.status,
        language: t.language,
        category: t.category,
        quality_score: t.quality_score
      })),
      total: result.templates?.length || 0,
      error: result.error
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET: Get template variables
router.get('/:id/variables', requireAuth, async (req, res) => {
  try {
    const template = await Template.findOne({
      _id: req.params.id,
      tenantId: req.tenantId,
      status: { $ne: 'DELETED' }
    });

    if (!template) {
      return res.status(404).json({
        success: false,
        error: 'Template not found'
      });
    }

    res.json({
      success: true,
      variables: template.variables || []
    });
  } catch (error) {
    console.error('Get variables error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch variables'
    });
  }
});

// GET: Get template preview
router.get('/:id/preview', requireAuth, async (req, res) => {
  try {
    const template = await Template.findOne({
      _id: req.params.id,
      tenantId: req.tenantId,
      status: { $ne: 'DELETED' }
    });

    if (!template) {
      return res.status(404).json({
        success: false,
        error: 'Template not found'
      });
    }

    const preview = {
      name: template.name,
      displayName: template.displayName,
      category: template.category,
      language: template.language,
      status: template.status,
      header: template.header,
      body: template.body,
      footer: template.footer,
      buttons: template.buttons,
      variables: template.variables,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
      metaId: template.fbTemplateId,
      canTest: template.status === 'APPROVED' && template.fbTemplateId
    };

    res.json({
      success: true,
      preview
    });
  } catch (error) {
    console.error('Preview error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate preview'
    });
  }
});

// GET: Export template as JSON
router.get('/:id/export', requireAuth, async (req, res) => {
  try {
    const template = await Template.findOne({
      _id: req.params.id,
      tenantId: req.tenantId,
      status: { $ne: 'DELETED' }
    });

    if (!template) {
      return res.status(404).json({
        success: false,
        error: 'Template not found'
      });
    }

    const exportData = {
      name: template.name,
      language: template.language,
      category: template.category,
      header: template.header,
      body: template.body,
      footer: template.footer,
      buttons: template.buttons,
      variables: template.variables,
      metaId: template.fbTemplateId,
      exportedAt: new Date().toISOString()
    };

    res.json({
      success: true,
      template: exportData
    });
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to export template'
    });
  }
});

module.exports = router;