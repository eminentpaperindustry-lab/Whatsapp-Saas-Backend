const mongoose = require('mongoose');

const ChatSessionSchema = new mongoose.Schema({
  tenantId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Tenant', 
    required: true 
  },
  contactId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Contact' 
  },
  phone: {
    type: String,
    required: true
  },
  lastMessage: String,
  lastMessageType: String,
  lastDirection: String,
  lastStatus: String,
  unreadCount: { 
    type: Number, 
    default: 0 
  },
  hasReplied: { 
    type: Boolean, 
    default: false 
  },
  lastInteraction: {
    type: Date,
    default: Date.now
  },
  messageCount: { 
    type: Number, 
    default: 0 
  },
  campaignIds: [{ 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Campaign' 
  }],
  tags: [String],
  notes: String,
  isArchived: { 
    type: Boolean, 
    default: false 
  },
  priority: { 
    type: String, 
    enum: ['low', 'medium', 'high', 'urgent'], 
    default: 'medium' 
  },
  assignedTo: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User' 
  },
  labels: [String],
  source: { 
    type: String, 
    enum: ['campaign', 'manual', 'inbound', 'api', 'import'], 
    default: 'inbound' 
  },
  lastCampaignId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Campaign' 
  },
  lastTemplateName: String,
  sentiment: { 
    type: String, 
    enum: ['positive', 'neutral', 'negative', 'unknown'], 
    default: 'unknown' 
  },
  autoReplySent: { 
    type: Boolean, 
    default: false 
  },
  followUpNeeded: { 
    type: Boolean, 
    default: false 
  },
  followUpDate: Date,
  csatScore: { type: Number, min: 1, max: 5 },
  csatComment: String,
  optedOut: { type: Boolean, default: false },
  optOutReason: String,
  optOutAt: Date,
  isSpam: { type: Boolean, default: false },
  spamScore: { type: Number, default: 0 },
  spamReportedAt: Date,
  avgResponseTime: Number,
  lastResponseTime: Number,
  summary: String,
  customFields: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: {}
  },
  createdAt: { 
    type: Date, 
    default: Date.now 
  },
  updatedAt: { 
    type: Date, 
    default: Date.now 
  }
}, {
  timestamps: true
});

// Indexes
ChatSessionSchema.index({ tenantId: 1, phone: 1 }, { unique: true });
ChatSessionSchema.index({ tenantId: 1, updatedAt: -1 });
ChatSessionSchema.index({ tenantId: 1, lastInteraction: -1 });
ChatSessionSchema.index({ tenantId: 1, unreadCount: -1 });
ChatSessionSchema.index({ tenantId: 1, hasReplied: 1 });
ChatSessionSchema.index({ tenantId: 1, isArchived: 1 });
ChatSessionSchema.index({ tenantId: 1, assignedTo: 1 });
ChatSessionSchema.index({ tenantId: 1, priority: 1 });
ChatSessionSchema.index({ tenantId: 1, labels: 1 });
ChatSessionSchema.index({ tenantId: 1, optedOut: 1 });
ChatSessionSchema.index({ tenantId: 1, isSpam: 1 });

// Pre-save middleware
ChatSessionSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model("ChatSession", ChatSessionSchema);