// models/CampaignStep.js
const mongoose = require('mongoose');

const campaignStepSchema = new mongoose.Schema({
  campaignId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Campaign',
    required: true
  },
  sequence: {
    type: Number,
    required: true,
    min: 1
  },
  day: { // NEW: For fixed campaigns - Day number (1, 2, 3...)
    type: Number,
    default: 1
  },
  type: {
    type: String,
    enum: ['text', 'media', 'template'],
    required: true
  },
  body: {
    type: String,
    default: ''
  },
  templateName: {
    type: String,
    default: null
  },
  language: {
    type: String,
    default: null
  },
  mediaUrl: {
    type: String,
    default: ''
  },
  caption: {
    type: String,
    default: ''
  },
  stepTime: { // CHANGED: delayDays removed, stepTime added
    type: String,
    default: '09:00'
  },
  dayOfWeek: {
    type: Number,
    min: 0,
    max: 6,
    default: null
  },
  dayOfMonth: {
    type: Number,
    min: 1,
    max: 31,
    default: null
  },
  condition: {
    type: String,
    enum: ['always', 'if_replied', 'if_not_replied'],
    default: 'always'
  },
  placeholders: [{
    type: String
  }],
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

// Compound unique index for campaignId, day and sequence
campaignStepSchema.index({ campaignId: 1, day: 1, sequence: 1 }, { unique: true });

module.exports = mongoose.model('CampaignStep', campaignStepSchema);