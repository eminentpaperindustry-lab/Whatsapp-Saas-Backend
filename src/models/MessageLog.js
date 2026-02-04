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
  
  // ADD THESE FIELDS FOR DUPLICATE PREVENTION
  stepTime: { type: String },
  stepSequence: { type: Number },
  stepDay: { type: Number },
  sentAt: { type: Date },
  
  timestamp: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

messageLogSchema.index({ campaignId: 1, contactId: 1, stepSequence: 1, createdAt: 1 });
messageLogSchema.index({ createdAt: 1 });
messageLogSchema.index({ status: 1 });

module.exports = mongoose.model('MessageLog', messageLogSchema);