const axios = require('axios');
const crypto = require("crypto");
const MessageLog = require("../models/MessageLog");

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

// Function to send raw payload to WhatsApp (No change needed here)
async function sendRaw(payload) {
  console.log('WhatsApp send payload:', JSON.stringify(payload, null, 2));
  try {
    const res = await axios.post(MESSAGE_SEND_URL, payload, {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
    });
    console.log('WhatsApp send response:', res.data);
    return res.data;
  } catch (err) {
    console.error('WhatsApp send error:', err.response?.data || err.message);
    throw err;
  }
}

// Fetch template details from WhatsApp API (No major change needed here)
async function fetchTemplateDetail(templateName, language = 'en') {
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

// Function to map dynamic template components (UPDATED LOGIC)
// This function maps dynamic content (variables or media links) into the 'parameters' array.
function mapTemplateComponents(components, dynamicParams) {
  const mappedComponents = [];
  let dynamicParamIndex = 0; // Index to track which dynamicParam is being used

  components.forEach((comp) => {
    const type = comp.type.toLowerCase();
    let parameters = [];

    // 1. Handle HEADER component (for dynamic media or text variables)
    if (type === 'header') {
      const format = (comp.format || 'text').toLowerCase(); // e.g., TEXT, IMAGE, VIDEO, DOCUMENT

      if (format === 'text' && comp.localizable_params && comp.localizable_params.length > 0) {
        // Dynamic text variable in the header (e.g., {{1}})
        if (dynamicParams[dynamicParamIndex]) {
          parameters.push({ type: 'text', text: cleanText(dynamicParams[dynamicParamIndex]) });
          dynamicParamIndex++;
        }
      } else if (['image', 'video', 'document'].includes(format)) {
        // Dynamic media in the header (e.g., an image link)
        if (dynamicParams[dynamicParamIndex]) {
          parameters.push({ type: format, [format]: { link: dynamicParams[dynamicParamIndex] } });
          dynamicParamIndex++;
        }
      }
    }

    // 2. Handle BODY component (for dynamic text variables)
    else if (type === 'body' && comp.localizable_params) {
      const bodyParamsCount = comp.localizable_params.length;
          
      // Map only the necessary dynamicParams to the body variables
      for (let i = 0; i < bodyParamsCount; i++) {
        if (dynamicParams[dynamicParamIndex]) {
          parameters.push({ type: 'text', text: cleanText(dynamicParams[dynamicParamIndex]) });
          dynamicParamIndex++;
        } else {
            // Handle case where dynamicParams are missing for a body variable
            console.warn(`Missing dynamic parameter for body variable index ${i}`);
        }
      }
    }

    // 3. Handle BUTTON component (for dynamic URLs)
    else if (type === 'button' && comp.buttons) {
      comp.buttons.forEach((btn) => {
        // Check if the button URL is dynamic (ends with {{1}} etc.)
        if (btn.type.toLowerCase() === 'url' && btn.url && btn.url.includes('{{')) {
          if (dynamicParams[dynamicParamIndex]) {
            parameters.push({ type: 'text', text: cleanText(dynamicParams[dynamicParamIndex]) });
            dynamicParamIndex++;
          }
        }
      });
    }

    if (parameters.length > 0) {
      mappedComponents.push({ type, parameters });
    }
  });

  // Filter out any component types that do not have parameters
  return mappedComponents.filter(comp => comp.parameters && comp.parameters.length > 0);
}

// Send WhatsApp Template (UPDATED LOGIC)
async function sendTemplate({
  to,
  templateName,
  language = 'en', // Changed default to 'en' for simplicity, but 'en_US' is also common
  dynamicParams = [], // Array of strings for variables: ['Value for {{1}}', 'Value for {{2}}', ...]
}) {
  if (!to || !templateName) {
    throw new Error('to and templateName required for template message');
  }

  // 1. Fetch template details to check for variables
  const tplDetail = await fetchTemplateDetail(templateName, language);
  console.log('Fetched template detail:', JSON.stringify(tplDetail, null, 2));

  const components = tplDetail.components || [];

  // 2. Check if the template has any dynamic variables at all
  const hasVariables = components.some(comp => 
        (comp.localizable_params && comp.localizable_params.length > 0) || 
        (comp.type === 'BUTTON' && comp.buttons && comp.buttons.some(btn => btn.url && btn.url.includes('{{')))
    );

  let validComponents = [];

  // 3. ONLY map components if variables are present (Fixed-text templates skip this)
  if (hasVariables && dynamicParams.length > 0) {
    validComponents = mapTemplateComponents(components, dynamicParams);
  }
  
  // IMPORTANT: If a template has variables but dynamicParams is missing, this will result in an error
  // The check above will prevent a malformed request for a fixed template.

  // 4. Create the final payload
  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: language },
    },
  };
  
  // 5. Conditionally add the 'components' array ONLY if it's not empty
  if (validComponents.length > 0) {
      payload.template.components = validComponents;
  }

  console.log('Final payload to send:', JSON.stringify(payload, null, 2));

  return sendRaw(payload);
}


// --- Rest of your functions (No major changes needed as they are correct) ---

// Send Text Message
async function sendText({ to, body }) {
  if (!to || !body) throw new Error('to and body required');
  const payload = { messaging_product: 'whatsapp', to, type: 'text', text: { body } };
  return sendRaw(payload);
}

// Send Image
async function sendImage({ to, imageUrl, caption = '' }) {
  if (!to || !imageUrl) throw new Error('to and imageUrl required');
  const payload = { messaging_product: 'whatsapp', to, type: 'image', image: { link: imageUrl, caption } };
  return sendRaw(payload);
}

// Send Video
async function sendVideo({ to, videoUrl, caption = '' }) {
  if (!to || !videoUrl) throw new Error('to and videoUrl required');
  const payload = { messaging_product: 'whatsapp', to, type: 'video', video: { link: videoUrl, caption } };
  return sendRaw(payload);
}

// Send File
async function sendFile({ to, fileUrl, caption = '' }) {
  if (!to || !fileUrl) throw new Error('to and fileUrl required');
  const payload = { messaging_product: 'whatsapp', to, type: 'document', document: { link: fileUrl, caption } };
  return sendRaw(payload);
}

// Send Location
async function sendLocation({ to, latitude, longitude, name = '', address = '' }) {
  if (!to || !latitude || !longitude) throw new Error('to, latitude, and longitude are required');
  const payload = {
    messaging_product: 'whatsapp',
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
// CAMPAIGN SPECIFIC FUNCTIONS
// =======================

/**
 * Process campaign step for a contact
 */
async function processCampaignStep(step, contact, campaign) {
  try {
    const to = contact.phone.replace(/\+/g, '');
    console.log(`Processing campaign step ${step.sequence} for ${to}`);

    let response = null;

    switch (step.type) {
      case 'text':
        response = await sendText({ to, body: step.body });
        break;
        
      case 'media':
        // Check if media URL is image, video or document
        const mediaUrl = step.mediaUrl;
        if (mediaUrl.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
          response = await sendImage({ to, imageUrl: mediaUrl, caption: step.body || '' });
        } else if (mediaUrl.match(/\.(pdf|doc|docx|txt|xlsx)$/i)) {
          response = await sendFile({ to, fileUrl: mediaUrl, caption: step.body || '' });
        } else {
          // Default to image
          response = await sendImage({ to, imageUrl: mediaUrl, caption: step.body || '' });
        }
        break;
        
      case 'template':
        if (!step.templateName) {
          throw new Error('Template name is required for template messages');
        }
        response = await sendTemplate({
          to,
          templateName: step.templateName,
          language: step.language || 'en_US'
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
    console.error(`Error processing step for ${contact.phone}:`, error);
    return {
      success: false,
      error: error.message,
      contactId: contact._id,
      stepId: step._id
    };
  }
}

/**
 * Send batch messages (for campaign triggers)
 */
// services/whatsapp.js में sendTemplate function update करें

// async function sendTemplate({
//   to,
//   templateName,
//   language = 'en_US',
//   components = []  // Dynamic variables
// }) {
//   if (!to || !templateName) {
//     throw new Error('to and templateName required for template message');
//   }

//   try {
//     // First get template details to check structure
//     const templateResult = await getTemplateByName(templateName, language);
    
//     if (!templateResult.success) {
//       throw new Error(`Template "${templateName}" not found: ${templateResult.error}`);
//     }
    
//     const template = templateResult.template;
    
//     // Build components array for dynamic variables
//     const templateComponents = [];
    
//     if (components && components.length > 0) {
//       // Group components by type
//       const headerComponents = components.filter(c => c.type === 'HEADER');
//       const bodyComponents = components.filter(c => c.type === 'BODY');
//       const buttonComponents = components.filter(c => c.type === 'BUTTONS');
      
//       if (headerComponents.length > 0) {
//         templateComponents.push({
//           type: 'HEADER',
//           parameters: headerComponents.map(comp => ({
//             type: comp.format === 'IMAGE' ? 'image' : 
//                   comp.format === 'VIDEO' ? 'video' : 
//                   comp.format === 'DOCUMENT' ? 'document' : 'text',
//             ...(comp.format === 'TEXT' ? { text: comp.text } : 
//                 comp.format === 'IMAGE' ? { image: { link: comp.text } } :
//                 comp.format === 'VIDEO' ? { video: { link: comp.text } } :
//                 comp.format === 'DOCUMENT' ? { document: { link: comp.text } } : {})
//           }))
//         });
//       }
      
//       if (bodyComponents.length > 0) {
//         templateComponents.push({
//           type: 'BODY',
//           parameters: bodyComponents.map(comp => ({
//             type: 'text',
//             text: comp.text
//           }))
//         });
//       }
      
//       if (buttonComponents.length > 0) {
//         buttonComponents.forEach(buttonComp => {
//           templateComponents.push({
//             type: 'BUTTON',
//             sub_type: 'URL',
//             index: buttonComp.index || '0',
//             parameters: [{
//               type: 'text',
//               text: buttonComp.text
//             }]
//           });
//         });
//       }
//     }
    
//     // Prepare payload
//     const payload = {
//       messaging_product: 'whatsapp',
//       recipient_type: 'individual',
//       to: to,
//       type: 'template',
//       template: {
//         name: templateName,
//         language: {
//           code: language
//         }
//       }
//     };
    
//     // Add components if we have dynamic variables
//     if (templateComponents.length > 0) {
//       payload.template.components = templateComponents;
//     }
    
//     console.log('Sending template payload:', JSON.stringify(payload, null, 2));
    
//     // Send the message
//     const response = await sendRaw(payload);
//     return response;
    
//   } catch (error) {
//     console.error('Error sending template:', error);
//     throw error;
//   }
// }

async function sendBatchMessages(messages) {
  try {
    const results = await Promise.all(
      messages.map(async (msg) => {
        try {
          const result = await processCampaignStep(msg.step, msg.contact, msg.campaign);
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
    console.error('Error sending batch messages:', error);
    throw error;
  }
}

// ... existing code ...

async function sendTemplate({
  to,
  templateName,
  language = 'en_US',
  components = []
}) {
  if (!to || !templateName) {
    throw new Error('to and templateName required for template message');
  }

  try {
    const GRAPH_VERSION = process.env.META_WA_GRAPH_VERSION || 'v17.0';
    const PHONE_ID = process.env.META_WA_PHONE_ID;
    const TOKEN = process.env.META_WA_TOKEN;
    
    if (!PHONE_ID || !TOKEN) {
      throw new Error('WhatsApp API credentials not configured');
    }
    
    const MESSAGE_SEND_URL = `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_ID}/messages`;
    
    // Prepare payload
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: to,
      type: 'template',
      template: {
        name: templateName,
        language: {
          code: language,
          policy: 'deterministic'
        }
      }
    };
    
    // Add components if we have dynamic variables
    if (components && components.length > 0) {
      payload.template.components = components;
    }
    
    console.log('Sending template payload:', JSON.stringify(payload, null, 2));
    
    // Send the message
    const response = await axios.post(MESSAGE_SEND_URL, payload, {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
    });
    
    console.log('Template response:', response.data);
    return response.data;
    
  } catch (error) {
    console.error('Error sending template:', error.response?.data || error.message);
    throw error;
  }
}

// ... rest of the code ...

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

// Get templates from Meta
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

// services/whatsapp.js में ये function add करें

/**
 * Get all approved templates from Meta
 */
// services/whatsapp.js में ये function है जो templates fetch कर रहा है
async function getAllTemplates() {
  try {
    const GRAPH_VERSION = process.env.META_WA_GRAPH_VERSION || 'v17.0';
    const WABA_ID = process.env.META_WA_BUSINESS_ID;
    const TOKEN = process.env.META_WA_TOKEN;
    
    console.log('📞 Fetching templates with:');
    console.log('  WABA_ID:', WABA_ID);
    console.log('  TOKEN:', TOKEN ? 'Present' : 'Missing');
    
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
    
    if (approvedTemplates.length > 0) {
      console.log('📝 Sample template:', {
        name: approvedTemplates[0].name,
        language: approvedTemplates[0].language,
        status: approvedTemplates[0].status,
        category: approvedTemplates[0].category
      });
    }
    
    return {
      success: true,
      templates: approvedTemplates,
      total: approvedTemplates.length
    };
    
  } catch (error) {
    console.error('❌ Error fetching templates from Meta:');
    console.error('  Message:', error.message);
    
    if (error.response) {
      console.error('  Status:', error.response.status);
      console.error('  Data:', JSON.stringify(error.response.data, null, 2));
    } else if (error.request) {
      console.error('  No response received');
    }
    
    return {
      success: false,
      error: error.response?.data?.error?.message || error.message,
      templates: [],
      total: 0
    };
  }
}

/**
 * Get template by name
 */
async function getTemplateByName(templateName, language = 'en_US') {
  try {
    const GRAPH_VERSION = process.env.META_WA_GRAPH_VERSION || 'v17.0';
    const WABA_ID = process.env.META_WA_BUSINESS_ID;
    const TOKEN = process.env.META_WA_TOKEN;
    
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${WABA_ID}/message_templates`;
    
    const response = await axios.get(url, {
      headers: {
        'Authorization': `Bearer ${TOKEN}`
      },
      params: {
        name: templateName,
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
      template: template
    };
    
  } catch (error) {
    console.error(`Error fetching template ${templateName}:`, error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data?.error?.message || error.message,
      template: null
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
  getTemplates
};