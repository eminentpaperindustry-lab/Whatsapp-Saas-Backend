// models/CampaignProgress.js
const mongoose = require('mongoose');

const campaignProgressSchema = new mongoose.Schema({
  campaignId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Campaign', 
    required: true 
  },
  contactId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Contact', 
    required: true 
  },
  tenantId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Tenant', 
    required: true 
  },
  
  // For fixed campaigns - track day-wise progress
  currentDay: { // NEW: Current day for this contact
    type: Number,
    default: 1
  },
  
  // Track which steps have been sent for current day
  currentDaySteps: [{
    stepId: { type: mongoose.Schema.Types.ObjectId, ref: 'CampaignStep' },
    sequence: Number,
    stepTime: String,
    sentAt: Date,
    status: String
  }],
  
  // All completed steps (for history)
  completedSteps: [{
    day: Number,
    stepId: { type: mongoose.Schema.Types.ObjectId, ref: 'CampaignStep' },
    sequence: Number,
    stepTime: String,
    sentAt: Date,
    status: String
  }],
  
  // Last interaction
  lastInteraction: Date,
  hasReplied: {
    type: Boolean,
    default: false
  },
  
  // Campaign status for this contact
  status: {
    type: String,
    enum: ['active', 'completed', 'paused', 'failed'],
    default: 'active'
  },
  
  // Metadata
  startedAt: {
    type: Date,
    default: Date.now
  },
  completedAt: Date
}, { 
  timestamps: true 
});

// Index for faster queries
campaignProgressSchema.index({ campaignId: 1, contactId: 1 }, { unique: true });
campaignProgressSchema.index({ tenantId: 1, status: 1 });
campaignProgressSchema.index({ campaignId: 1, status: 1 });

module.exports = mongoose.model('CampaignProgress', campaignProgressSchema);