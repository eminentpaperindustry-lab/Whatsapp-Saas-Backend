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
  currentDay: {
    type: Number,
    default: 1
  },
  
  // Track which steps have been sent for current day
  currentDaySteps: [{
    stepId: { type: mongoose.Schema.Types.ObjectId, ref: 'CampaignStep' },
    sequence: Number,
    stepTime: String,
    scheduledAt: Date,  // When it was scheduled
    sentAt: Date,       // When it was actually sent
    status: {           // ADD ENUM for better control
      type: String, 
      enum: ['scheduled', 'sent', 'failed', 'missed', 'skipped'],
      default: 'scheduled'
    },
    messageId: String,  // WhatsApp message ID for tracking
    error: String       // If failed, store error message
  }],
  
  // All completed steps (for history)
  completedSteps: [{
    day: Number,
    stepId: { type: mongoose.Schema.Types.ObjectId, ref: 'CampaignStep' },
    sequence: Number,
    stepTime: String,
    scheduledAt: Date,   // When it was scheduled to send
    sentAt: Date,        // When it was actually sent
    status: {            // ADD ENUM for better control
      type: String,
      enum: ['sent', 'failed', 'missed', 'skipped'],
      default: 'sent'
    },
    messageId: String,   // WhatsApp message ID
    error: String,       // Error if failed
    retryCount: {        // Track retry attempts
      type: Number,
      default: 0
    }
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
    enum: ['active', 'completed', 'paused', 'failed', 'stopped'],
    default: 'active'
  },
  
  // Progress statistics
  totalSteps: {          // Total steps in campaign
    type: Number,
    default: 0
  },
  completedStepCount: {  // How many steps completed
    type: Number,
    default: 0
  },
  failedStepCount: {     // How many steps failed
    type: Number,
    default: 0
  },
  missedStepCount: {     // How many steps missed (NEW)
    type: Number,
    default: 0
  },
  
  // Timing info
  startedAt: {
    type: Date,
    default: Date.now
  },
  completedAt: Date,
  estimatedCompletionDate: Date, // When campaign should complete
  
  // For duplicate prevention
  lastMessageSentAt: Date,       // When last message was sent
  duplicateCheckHash: String,    // Hash to prevent duplicates
  
  // Metadata
  notes: String,
  tags: [String]
}, { 
  timestamps: true 
});

// Index for faster queries
campaignProgressSchema.index({ campaignId: 1, contactId: 1 }, { unique: true });
campaignProgressSchema.index({ tenantId: 1, status: 1 });
campaignProgressSchema.index({ campaignId: 1, status: 1 });
campaignProgressSchema.index({ lastInteraction: -1 });
campaignProgressSchema.index({ 'completedSteps.sentAt': -1 });
campaignProgressSchema.index({ 'completedSteps.status': 1 });

// Method to check if a step was already sent
campaignProgressSchema.methods.hasStepBeenSent = function(stepId, stepSequence, day) {
  // Check in currentDaySteps
  const inCurrentDay = this.currentDaySteps.some(step => 
    (step.stepId && step.stepId.toString() === stepId.toString()) ||
    (step.sequence === stepSequence && step.day === day)
  );
  
  if (inCurrentDay) return true;
  
  // Check in completedSteps
  const inCompleted = this.completedSteps.some(step => 
    (step.stepId && step.stepId.toString() === stepId.toString()) ||
    (step.sequence === stepSequence && step.day === day)
  );
  
  return inCompleted;
};

// Method to add a completed step
campaignProgressSchema.methods.addCompletedStep = function(stepData) {
  this.completedSteps.push(stepData);
  this.completedStepCount = this.completedSteps.filter(s => s.status === 'sent').length;
  this.failedStepCount = this.completedSteps.filter(s => s.status === 'failed').length;
  this.missedStepCount = this.completedSteps.filter(s => s.status === 'missed').length;
  this.lastInteraction = new Date();
  this.lastMessageSentAt = new Date();
  
  return this.save();
};

// Method to mark a step as missed
campaignProgressSchema.methods.markStepAsMissed = function(stepId, stepSequence, day, stepTime) {
  const missedStep = {
    day: day,
    stepId: stepId,
    sequence: stepSequence,
    stepTime: stepTime,
    scheduledAt: new Date(), // When it should have been sent
    status: 'missed',
    missedAt: new Date()
  };
  
  this.completedSteps.push(missedStep);
  this.missedStepCount++;
  this.lastInteraction = new Date();
  
  return this.save();
};

// Method to check if campaign is completed
campaignProgressSchema.methods.isCampaignCompleted = function(totalCampaignSteps) {
  const sentSteps = this.completedSteps.filter(s => s.status === 'sent').length;
  return sentSteps >= totalCampaignSteps || this.status === 'completed';
};

// Method to get progress percentage
campaignProgressSchema.methods.getProgressPercentage = function(totalCampaignSteps) {
  if (totalCampaignSteps === 0) return 0;
  const sentSteps = this.completedSteps.filter(s => s.status === 'sent').length;
  return Math.round((sentSteps / totalCampaignSteps) * 100);
};

// Pre-save middleware to update completion
campaignProgressSchema.pre('save', function(next) {
  // Update status if all steps are done
  if (this.totalSteps > 0 && this.completedStepCount >= this.totalSteps) {
    this.status = 'completed';
    this.completedAt = new Date();
  }
  
  // Update current day based on completed steps
  if (this.completedSteps.length > 0) {
    const maxCompletedDay = Math.max(...this.completedSteps
      .filter(s => s.status === 'sent')
      .map(s => s.day));
    
    if (maxCompletedDay > this.currentDay) {
      this.currentDay = maxCompletedDay + 1;
    }
  }
  
  next();
});

module.exports = mongoose.model('CampaignProgress', campaignProgressSchema);