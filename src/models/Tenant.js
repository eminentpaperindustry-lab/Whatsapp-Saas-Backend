// // src/models/Tenant.js
// const mongoose = require('mongoose');

// const TenantSchema = new mongoose.Schema({
//   name: { type: String, required: true },
//   contact_email: String,
//   metadata: { type: Object, default: {} }
// }, { timestamps: true });

// module.exports = mongoose.model('Tenant', TenantSchema);


const mongoose = require('mongoose');

const TenantSchema = new mongoose.Schema({
  name: { type: String, required: true },
  contact_email: String,
  phone: String,
  address: String,
  metadata: { type: Object, default: {} },
  
  // WhatsApp settings
  whatsappBusinessId: String,
  whatsappPhoneId: String,
  whatsappAccessToken: String,
  whatsappWebhookVerifyToken: String,
  whatsappPhoneNumber: String,
  
  // Chat settings
  chatSettings: {
    autoReplyEnabled: { type: Boolean, default: false },
    autoReplyMessage: String,
    businessHours: {
      enabled: { type: Boolean, default: false },
      timezone: { type: String, default: 'Asia/Kolkata' },
      startTime: { type: String, default: '09:00' },
      endTime: { type: String, default: '18:00' },
      offlineMessage: String
    },
    quickReplies: [{
      name: String,
      text: String,
      type: { type: String, enum: ['text', 'template'], default: 'text' }
    }],
    labels: [String],
    csatEnabled: { type: Boolean, default: false }
  },
  
  status: { 
    type: String, 
    enum: ['active', 'suspended', 'inactive'], 
    default: 'active' 
  },
  
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('Tenant', TenantSchema);