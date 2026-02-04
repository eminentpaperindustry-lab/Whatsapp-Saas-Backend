const axios = require('axios');
const crypto = require("crypto");
const MessageLog = require("../models/MessageLog");
const Template = require("../models/Template"); // Add Template model

// Environment variables should be set here, but for this example, they are placeholders
const GRAPH_VERSION = process.env.META_WA_GRAPH_VERSION || 'v17.0';
const WABA_ID = process.env.META_WA_BUSINESS_ID;     // Your WhatsApp Business Account ID
const PHONE_ID = process.env.META_WA_PHONE_ID;       // Your Phone number ID for sending
const TOKEN = process.env.META_WA_TOKEN;            // Your Access Token

if (!WABA_ID || !PHONE_ID || !TOKEN) {
  console.warn('Warning: Missing Meta WA config (WABA_ID, PHONE_ID, TOKEN). Please set them.');
}

const TEMPLATE_LIST_URL = `https://graph.facebook.com/${GRAPH_VERSION}/${WABA_ID}/message_templates`;
const MESSAGE_SEND_URL = `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_ID}/messages`;

// Utility function to clean text (remove newlines, tabs, consecutive spaces)
function cleanText(text) {
  if (!text) return text;
  return text.replace(/[\n\t]+/g, ' ').replace(/ {5,}/g, '    ');
}

// Function to send raw payload to WhatsApp
async function sendRaw(payload) {
  console.log('📤 WhatsApp send payload:', JSON.stringify(payload, null, 2));
  try {
    const res = await axios.post(MESSAGE_SEND_URL, payload, {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
    });
    console.log('✅ WhatsApp send response:', res.data);
    return res.data;
  } catch (err) {
    console.error('❌ WhatsApp send error:', err.response?.data || err.message);
    throw err;
  }
}

// Fetch template details from WhatsApp API
async function fetchTemplateDetail(templateName, language = 'en_US') {
  const url = `${TEMPLATE_LIST_URL}?name=${templateName}&fields=name,components,language,status`;
  const resp = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
    },
  });

  const data = resp.data;
  if (!data.data || data.data.length === 0) {
    throw new Error('Template not found in Meta: ' + templateName);
  }

  // Find the template matching the exact language code
  let tpl = data.data.find((t) => t.language.toLowerCase() === language.toLowerCase());
  if (!tpl) tpl = data.data[0]; // Fallback to the first available template

  if (!tpl.components) tpl.components = []; // Ensure components property exists
  return tpl;
}

// Function to map dynamic template components (UPDATED for new Template model)
function mapTemplateComponents(components, dynamicParams) {
  const mappedComponents = [];
  let dynamicParamIndex = 0;

  components.forEach((comp) => {
    const type = comp.type.toLowerCase();
    let parameters = [];

    // 1. Handle HEADER component
    if (type === 'header') {
      const format = (comp.format || 'text').toLowerCase();

      if (format === 'text' && comp.text) {
        // Check for variables in header text
        const variableMatches = comp.text.match(/{{(\d+)}}/g) || [];
        for (const match of variableMatches) {
          if (dynamicParams[dynamicParamIndex]) {
            parameters.push({ type: 'text', text: cleanText(dynamicParams[dynamicParamIndex]) });
            dynamicParamIndex++;
          }
        }
      } else if (['image', 'video', 'document'].includes(format)) {
        // Dynamic media in the header
        if (dynamicParams[dynamicParamIndex]) {
          parameters.push({ type: format, [format]: { link: dynamicParams[dynamicParamIndex] } });
          dynamicParamIndex++;
        }
      }
    }

    // 2. Handle BODY component
    else if (type === 'body' && comp.text) {
      const bodyText = comp.text;
      const variableMatches = bodyText.match(/{{(\d+)}}/g) || [];
      
      for (let i = 0; i < variableMatches.length; i++) {
        if (dynamicParams[dynamicParamIndex]) {
          parameters.push({ type: 'text', text: cleanText(dynamicParams[dynamicParamIndex]) });
          dynamicParamIndex++;
        } else {
          console.warn(`Missing dynamic parameter for body variable index ${i}`);
        }
      }
    }

    // 3. Handle BUTTONS component
    else if (type === 'buttons' && comp.buttons) {
      comp.buttons.forEach((btn) => {
        // Handle URL buttons with dynamic parameters
        if (btn.type.toLowerCase() === 'url' && btn.url && btn.url.includes('{{')) {
          if (dynamicParams[dynamicParamIndex]) {
            parameters.push({ type: 'text', text: cleanText(dynamicParams[dynamicParamIndex]) });
            dynamicParamIndex++;
          }
        }
      });
    }

    if (parameters.length > 0) {
      mappedComponents.push({ 
        type: type.toUpperCase(), 
        parameters 
      });
    }
  });

  return mappedComponents.filter(comp => comp.parameters && comp.parameters.length > 0);
}

// Helper function to find template in database
async function findTemplateInDB(templateName, tenantId = null) {
  try {
    const query = {
      status: 'APPROVED',
      $or: []
    };
    
    // Add tenantId if provided
    if (tenantId) {
      query.tenantId = tenantId;
    }
    
    // Try multiple search patterns
    const searchPatterns = [];
    
    // 1. Exact name match (lowercase)
    const lowercaseName = templateName.toLowerCase().replace(/\s+/g, '_');
    searchPatterns.push({ name: lowercaseName });
    
    // 2. Case-insensitive name match
    searchPatterns.push({ name: { $regex: new RegExp(`^${templateName}$`, 'i') } });
    
    // 3. Display name match
    searchPatterns.push({ displayName: { $regex: new RegExp(templateName, 'i') } });
    
    // 4. Remove special characters and search
    const cleanName = templateName.replace(/[^a-zA-Z0-9]/g, ' ').trim().toLowerCase().replace(/\s+/g, '_');
    if (cleanName !== lowercaseName) {
      searchPatterns.push({ name: cleanName });
    }
    
    query.$or = searchPatterns;
    
    const template = await Template.findOne(query);
    
    if (template) {
      console.log('✅ Template found in DB:', {
        searched: templateName,
        found: template.name,
        displayName: template.displayName
      });
      return template;
    }
    
    return null;
  } catch (error) {
    console.error('❌ Error finding template in DB:', error);
    return null;
  }
}

// Send WhatsApp Template (UPDATED for new Template model)
async function sendTemplate({
  to,
  templateName,
  language = 'en_US',
  dynamicParams = [], // Array of strings for variables
  components = [],     // Optional: Pre-built components
  tenantId = null     // Optional: Tenant ID for DB lookup
}) {
  if (!to || !templateName) {
    throw new Error('to and templateName required for template message');
  }

  try {
    console.log('📋 Template request details:', {
      templateName,
      language,
      tenantId,
      dynamicParamsCount: dynamicParams.length
    });

    // 1. First try to find template in local database
    let actualTemplateName = templateName;
    const localTemplate = await findTemplateInDB(templateName, tenantId);
    
    if (localTemplate) {
      actualTemplateName = localTemplate.name;
      console.log('✅ Using template from local DB:', actualTemplateName);
    } else {
      console.log('⚠️ Template not found locally, trying with provided name');
      
      // Try to convert to lowercase format
      const formattedName = templateName.toLowerCase().replace(/\s+/g, '_');
      if (formattedName !== templateName) {
        console.log('🔄 Trying formatted name:', formattedName);
        const formattedTemplate = await findTemplateInDB(formattedName, tenantId);
        if (formattedTemplate) {
          actualTemplateName = formattedTemplate.name;
          console.log('✅ Found with formatted name:', actualTemplateName);
        }
      }
    }

    // 2. Fetch template details from Meta
    const tplDetail = await fetchTemplateDetail(actualTemplateName, language);
    console.log('✅ Fetched template detail from Meta:', tplDetail.name);

    let validComponents = [];

    // 3. If dynamicParams provided, map them to components
    if (dynamicParams && dynamicParams.length > 0) {
      validComponents = mapTemplateComponents(tplDetail.components || [], dynamicParams);
    } 
    // 4. Else if components provided directly, use them
    else if (components && components.length > 0) {
      validComponents = components;
    }

    // 5. Create the final payload
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'template',
      template: {
        name: actualTemplateName,
        language: { 
          code: language,
          policy: 'deterministic'
        },
      },
    };
    
    // 6. Conditionally add the 'components' array ONLY if it's not empty
    if (validComponents.length > 0) {
      payload.template.components = validComponents;
    }

    console.log('📤 Final template payload:', JSON.stringify(payload, null, 2));
    return sendRaw(payload);
    
  } catch (error) {
    console.error('❌ Error in sendTemplate:', error.message);
    throw error;
  }
}

// =======================
// SIMPLE MESSAGE FUNCTIONS
// =======================

// Send Text Message
async function sendText({ to, body }) {
  if (!to || !body) throw new Error('to and body required');
  const payload = { 
    messaging_product: 'whatsapp', 
    recipient_type: 'individual',
    to, 
    type: 'text', 
    text: { body } 
  };
  return sendRaw(payload);
}

// Send Image
async function sendImage({ to, imageUrl, caption = '' }) {
  if (!to || !imageUrl) throw new Error('to and imageUrl required');
  const payload = { 
    messaging_product: 'whatsapp', 
    recipient_type: 'individual',
    to, 
    type: 'image', 
    image: { link: imageUrl, caption } 
  };
  return sendRaw(payload);
}

// Send Video
async function sendVideo({ to, videoUrl, caption = '' }) {
  if (!to || !videoUrl) throw new Error('to and videoUrl required');
  const payload = { 
    messaging_product: 'whatsapp', 
    recipient_type: 'individual',
    to, 
    type: 'video', 
    video: { link: videoUrl, caption } 
  };
  return sendRaw(payload);
}

// Send File
async function sendFile({ to, fileUrl, caption = '' }) {
  if (!to || !fileUrl) throw new Error('to and fileUrl required');
  const payload = { 
    messaging_product: 'whatsapp', 
    recipient_type: 'individual',
    to, 
    type: 'document', 
    document: { link: fileUrl, caption } 
  };
  return sendRaw(payload);
}

// Send Location
async function sendLocation({ to, latitude, longitude, name = '', address = '' }) {
  if (!to || !latitude || !longitude) throw new Error('to, latitude, and longitude are required');
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'location',
    location: {
      latitude,
      longitude,
      name,
      address,
    },
  };
  return sendRaw(payload);
}

// Send Contact
async function sendContact({ to, contacts }) {
  if (!to || !Array.isArray(contacts)) throw new Error('to and contacts array are required');
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'contacts',
    contacts: contacts.map((contact) => ({
      profile: { name: contact.name },
      phones: [{ phone: contact.phone }],
    })),
  };
  return sendRaw(payload);
}

// =======================
// CAMPAIGN FUNCTIONS
// =======================

/**
 * Process campaign step for a contact
 */
async function processCampaignStep(step, contact, campaign, tenantId = null) {
  try {
    const to = contact.phone.replace(/\+/g, '');
    console.log(`🎯 Processing campaign step ${step.sequence} for ${to}`);

    let response = null;

    switch (step.type) {
      case 'text':
        response = await sendText({ to, body: step.body });
        break;
        
      case 'media':
        const mediaUrl = step.mediaUrl;
        if (mediaUrl.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
          response = await sendImage({ 
            to, 
            imageUrl: mediaUrl, 
            caption: step.caption || '' 
          });
        } else if (mediaUrl.match(/\.(mp4|avi|mov|wmv)$/i)) {
          response = await sendVideo({ 
            to, 
            videoUrl: mediaUrl, 
            caption: step.caption || '' 
          });
        } else {
          response = await sendFile({ 
            to, 
            fileUrl: mediaUrl, 
            caption: step.caption || '' 
          });
        }
        break;
        
      case 'template':
        if (!step.templateName) {
          throw new Error('Template name is required for template messages');
        }
        
        // Extract dynamic parameters from step if available
        let dynamicParams = [];
        if (step.dynamicParams && Array.isArray(step.dynamicParams)) {
          dynamicParams = step.dynamicParams;
        }
        
        response = await sendTemplate({
          to,
          templateName: step.templateName,
          language: step.language || 'en_US',
          dynamicParams: dynamicParams,
          tenantId: tenantId || campaign.tenantId
        });
        break;
        
      default:
        throw new Error(`Unknown step type: ${step.type}`);
    }

    return {
      success: true,
      data: response,
      contactId: contact._id,
      stepId: step._id
    };
  } catch (error) {
    console.error(`❌ Error processing step for ${contact.phone}:`, error);
    return {
      success: false,
      error: error.message,
      contactId: contact._id,
      stepId: step._id
    };
  }
}

/**
 * Send batch messages
 */
async function sendBatchMessages(messages) {
  try {
    const results = await Promise.all(
      messages.map(async (msg) => {
        try {
          const result = await processCampaignStep(msg.step, msg.contact, msg.campaign, msg.tenantId);
          return result;
        } catch (error) {
          return {
            success: false,
            error: error.message,
            contactId: msg.contact._id,
            stepId: msg.step._id
          };
        }
      })
    );

    return results;
  } catch (error) {
    console.error('❌ Error sending batch messages:', error);
    throw error;
  }
}

// =======================
// TEMPLATE MANAGEMENT
// =======================

/**
 * Get all approved templates from Meta
 */
async function getAllTemplates(tenantId = null) {
  try {
    console.log('📞 Fetching templates from Meta...');
    
    if (!WABA_ID || !TOKEN) {
      throw new Error('WhatsApp API credentials not configured');
    }
    
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${WABA_ID}/message_templates`;
    
    console.log('🌐 API URL:', url);
    
    const response = await axios.get(url, {
      headers: {
        'Authorization': `Bearer ${TOKEN}`
      },
      params: {
        fields: 'name,language,status,category,components'
      }
    });
    
    console.log('✅ API Response received');
    console.log('📊 Total templates in response:', response.data.data?.length || 0);
    
    // Filter only APPROVED templates
    const approvedTemplates = response.data.data?.filter(template => 
      template.status === 'APPROVED'
    ) || [];
    
    console.log('✅ Approved templates:', approvedTemplates.length);
    
    // Also get templates from local database
    let localTemplates = [];
    if (tenantId) {
      localTemplates = await Template.find({
        tenantId: tenantId,
        status: 'APPROVED'
      }).select('name displayName language category');
      
      console.log('📊 Local templates:', localTemplates.length);
    }
    
    return {
      success: true,
      templates: approvedTemplates,
      localTemplates: localTemplates,
      total: approvedTemplates.length
    };
    
  } catch (error) {
    console.error('❌ Error fetching templates from Meta:');
    console.error('  Message:', error.message);
    
    if (error.response) {
      console.error('  Status:', error.response.status);
      console.error('  Data:', JSON.stringify(error.response.data, null, 2));
    }
    
    return {
      success: false,
      error: error.response?.data?.error?.message || error.message,
      templates: [],
      localTemplates: [],
      total: 0
    };
  }
}

/**
 * Get template by name
 */
async function getTemplateByName(templateName, language = 'en_US', tenantId = null) {
  try {
    // First check local database
    let localTemplate = null;
    if (tenantId) {
      localTemplate = await findTemplateInDB(templateName, tenantId);
    }
    
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${WABA_ID}/message_templates`;
    
    const response = await axios.get(url, {
      headers: {
        'Authorization': `Bearer ${TOKEN}`
      },
      params: {
        name: localTemplate ? localTemplate.name : templateName,
        fields: 'name,language,status,category,components'
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
      throw new Error(`Template "${templateName}" not found or not approved`);
    }
    
    return {
      success: true,
      template: template,
      localTemplate: localTemplate
    };
    
  } catch (error) {
    console.error(`❌ Error fetching template ${templateName}:`, error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data?.error?.message || error.message,
      template: null,
      localTemplate: null
    };
  }
}

/**
 * Get templates from Meta (Simple version)
 */
async function getTemplates() {
  try {
    const response = await axios.get(TEMPLATE_LIST_URL, {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
      },
    });
    return response.data;
  } catch (error) {
    console.error('❌ WhatsApp API Error (getTemplates):', error.response?.data || error.message);
    throw error;
  }
}

// WhatsApp Health Check
async function checkWhatsAppHealth() {
  try {
    const response = await axios.get(
      `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_ID}/phone_numbers`,
      {
        headers: {
          Authorization: `Bearer ${TOKEN}`,
        },
      }
    );
    return {
      healthy: true,
      data: response.data,
    };
  } catch (error) {
    return {
      healthy: false,
      error: error.response?.data || error.message,
    };
  }
}

// =======================
// EXPORTS
// =======================
module.exports = {
  sendTemplate,
  sendText,
  sendImage,
  sendVideo,
  sendFile,
  sendLocation,
  sendContact,
  sendRaw,
  processCampaignStep,
  sendBatchMessages,
  checkWhatsAppHealth,
  getTemplates,
  getAllTemplates,
  getTemplateByName,
  findTemplateInDB
};