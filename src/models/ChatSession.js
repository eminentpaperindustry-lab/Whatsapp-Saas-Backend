const mongoose = require("mongoose");

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
  lastDirection: String, // inbound/outbound
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

// Indexes for fast querying
ChatSessionSchema.index({ tenantId: 1, phone: 1 }, { unique: true });
ChatSessionSchema.index({ tenantId: 1, updatedAt: -1 });
ChatSessionSchema.index({ tenantId: 1, lastInteraction: -1 });
ChatSessionSchema.index({ tenantId: 1, unreadCount: -1 });
ChatSessionSchema.index({ tenantId: 1, hasReplied: 1 });

// Pre-save middleware to update updatedAt
ChatSessionSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model("ChatSession", ChatSessionSchema);