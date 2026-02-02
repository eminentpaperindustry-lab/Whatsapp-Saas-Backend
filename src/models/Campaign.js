// models/Campaign.js
const mongoose = require('mongoose');

const campaignSchema = new mongoose.Schema({
  name: { 
    type: String, 
    required: true 
  },
  description: String,
  sectionIds: [{ 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Section' 
  }], // CHANGED: sectionId to sectionIds (array)
  tenantId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Tenant', 
    required: true 
  },
  createdBy: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  
  // Campaign Formats
  campaignType: {
    type: String,
    enum: ['daily', 'weekly', 'monthly', 'fixed', 'content_based'],
    default: 'fixed'
  },
  
  // Campaign status and control
  status: {
    type: String,
    enum: ['active', 'paused', 'completed', 'draft'],
    default: 'draft'
  },
  
  // For fixed campaigns - track current day for new contacts
  currentDayIndex: {
    type: Number,
    default: 1 // Start from Day 1
  },
  
  // For recurring campaigns - track last execution
  lastExecutionDate: Date,
  nextExecutionDate: Date,
  
  // Auto-trigger settings
  autoStart: {
    type: Boolean,
    default: false
  },
  
  // Content-based campaign settings
  contentType: {
    type: String,
    enum: ['text', 'template', 'media'],
    default: 'text'
  },
  contentId: String,
  
  // Common settings
  repeatCount: {
    type: Number,
    default: 0 // 0 means infinite
  },
  executedCount: {
    type: Number,
    default: 0
  },
  
  // Day field for fixed campaigns (total days available)
  totalDays: {
    type: Number,
    default: 1
  }
}, { 
  timestamps: true 
});

campaignSchema.index({ tenantId: 1, status: 1 });
campaignSchema.index({ campaignType: 1 });

module.exports = mongoose.model('Campaign', campaignSchema);