// // src/models/Contact.js
// const mongoose = require('mongoose');

// const ContactSchema = new mongoose.Schema({
//   tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
//   name: { type: String, required: true },
//   phone: { type: String, required: true },
//   tags: [String],
//   metadata: { type: Object, default: {} },
//   section: { type: mongoose.Schema.Types.ObjectId, ref: 'Section', required: true }
// }, { timestamps: true });

// ContactSchema.index({ tenantId: 1, phone: 1 }, { unique: true });

// module.exports = mongoose.model('Contact', ContactSchema);


const mongoose = require('mongoose');

const ContactSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  name: { type: String, required: true },
  phone: { type: String, required: true },
  email: { type: String },
  tags: [String],
  metadata: { type: Object, default: {} },
  section: { type: mongoose.Schema.Types.ObjectId, ref: 'Section' },
  
  // Chat specific fields
  hasWhatsApp: { type: Boolean, default: false },
  lastInteraction: Date,
  lastMessage: String,
  lastMessageType: String,
  lastMessageDirection: String,
  lastMessageStatus: String,
  messageCount: { type: Number, default: 0 },
  chatSessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatSession' },
  
  // Opt-in/Opt-out
  optedIn: { type: Boolean, default: true },
  optedInAt: Date,
  optedOutAt: Date,
  optOutReason: String,
  
  // Custom fields
  customFields: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: {}
  },
  
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

ContactSchema.index({ tenantId: 1, phone: 1 }, { unique: true });
ContactSchema.index({ tenantId: 1, tags: 1 });
ContactSchema.index({ tenantId: 1, lastInteraction: -1 });
ContactSchema.index({ tenantId: 1, hasWhatsApp: 1 });
ContactSchema.index({ tenantId: 1, optedIn: 1 });

module.exports = mongoose.model('Contact', ContactSchema);