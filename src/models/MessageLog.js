// const mongoose = require('mongoose');

// const messageLogSchema = new mongoose.Schema({
//   tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
//   campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign' },
//   contactId: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact' },
//   provider: { type: String, enum: ['meta', 'twilio'], default: 'meta' },
//   to: { type: String, required: true },
//   from: { type: String },
//   direction: { type: String, enum: ['inbound', 'outbound'], required: true },
//   type: { type: String, enum: ['text', 'image', 'video', 'document', 'audio', 'template', 'location', 'contacts', 'interactive', 'sticker', 'unknown'] },
//   body: { type: String },
//   mediaUrl: { type: String },
//   caption: { type: String },
//   templateName: { type: String },
//   language: { type: String },
//   status: { type: String, enum: ['sent', 'delivered', 'read', 'failed', 'pending'], default: 'sent' },
//   error: { type: String },
//   messageId: { type: String },
//   whatsappMessageId: { type: String },
  
//   // ADD THESE FIELDS FOR DUPLICATE PREVENTION
//   stepTime: { type: String },
//   stepSequence: { type: Number },
//   stepDay: { type: Number },
//   sentAt: { type: Date },
  
//   timestamp: { type: Date, default: Date.now },
//   createdAt: { type: Date, default: Date.now },
//   updatedAt: { type: Date, default: Date.now }
// });

// messageLogSchema.index({ campaignId: 1, contactId: 1, stepSequence: 1, createdAt: 1 });
// messageLogSchema.index({ createdAt: 1 });
// messageLogSchema.index({ status: 1 });

// module.exports = mongoose.model('MessageLog', messageLogSchema);

const mongoose = require('mongoose');

const messageLogSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign' },
  contactId: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact' },
  provider: { type: String, enum: ['meta', 'twilio'], default: 'meta' },
  to: { type: String, required: true },
  from: { type: String },
  direction: { type: String, enum: ['inbound', 'outbound'], required: true },
  type: { type: String, enum: ['text', 'image', 'video', 'document', 'audio', 'template', 'location', 'contacts', 'interactive', 'sticker', 'unknown'] },
  body: { type: String },
  mediaUrl: { type: String },
  caption: { type: String },
  templateName: { type: String },
  language: { type: String },
  status: { type: String, enum: ['sent', 'delivered', 'read', 'failed', 'pending'], default: 'sent' },
  error: { type: String },
  messageId: { type: String },
  whatsappMessageId: { type: String },
  provider_message_id: { type: String },
  
  // For campaign tracking
  stepTime: { type: String },
  stepSequence: { type: Number },
  stepDay: { type: Number },
  sentAt: { type: Date },
  
  // Metadata
  metadata: { type: Object, default: {} },
  payload: { type: Object, default: {} },
  
  timestamp: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Indexes
messageLogSchema.index({ tenantId: 1, timestamp: -1 });
messageLogSchema.index({ tenantId: 1, status: 1 });
messageLogSchema.index({ tenantId: 1, direction: 1 });
messageLogSchema.index({ tenantId: 1, to: 1, from: 1 });
messageLogSchema.index({ tenantId: 1, campaignId: 1, contactId: 1 });
messageLogSchema.index({ provider_message_id: 1 }, { unique: true, sparse: true });
messageLogSchema.index({ timestamp: 1 });
messageLogSchema.index({ 'payload.id': 1 });

module.exports = mongoose.model('MessageLog', messageLogSchema);