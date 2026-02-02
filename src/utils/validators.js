const mime = require('mime-types');

function validatePhone(phone) {
  return /^\+[1-9]\d{1,14}$/.test(phone);
}

function validateTextMessage(text) {
  if (!text) return false;
  return text.length <= 4096;
}

function validateTemplatePlaceholders(body) {
  if (!body) return true;
  const placeholders = body.match(/{{\d+}}/g);
  return !placeholders || placeholders.length <= 10;
}

function isHttpsUrl(url) {
  return /^https:\/\//.test(url);
}

// ===============================
// CAMPAIGN SPECIFIC VALIDATORS
// ===============================

function isValidCampaignType(type) {
  const validTypes = ['daily', 'weekly', 'monthly', 'fixed', 'content_based'];
  return validTypes.includes(type);
}

function isValidTime(time) {
  const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
  return timeRegex.test(time);
}

function isValidDayOfWeek(day) {
  return day >= 0 && day <= 6;
}

function isValidDayOfMonth(day) {
  return day >= 1 && day <= 31;
}

function isValidCampaignStatus(status) {
  const validStatuses = ['active', 'paused', 'completed', 'draft'];
  return validStatuses.includes(status);
}

function isValidStepCondition(condition) {
  const validConditions = ['always', 'if_replied', 'if_not_replied'];
  return validConditions.includes(condition);
}

function isValidMediaType(type) {
  const validTypes = ['text', 'media', 'template'];
  return validTypes.includes(type);
}

function isValidRepeatCount(count) {
  return Number.isInteger(count) && count >= 0;
}

function isValidDelayDays(days) {
  return Number.isInteger(days) && days >= 0 && days <= 365;
}

function isValidSectionId(sectionId) {
  if (!sectionId) return true; // Section is optional
  return typeof sectionId === 'string' && sectionId.length > 0;
}

// Helper function for campaign validation
function validateCampaignData(data) {
  const errors = [];
  
  if (!data.name || data.name.trim().length === 0) {
    errors.push('Campaign name is required');
  }
  
  if (data.campaignType && !isValidCampaignType(data.campaignType)) {
    errors.push('Invalid campaign type');
  }
  
  if (data.campaignType === 'daily' && data.dailyTime && !isValidTime(data.dailyTime)) {
    errors.push('Invalid daily time format (HH:MM)');
  }
  
  if (data.campaignType === 'weekly') {
    if (data.weeklyTime && !isValidTime(data.weeklyTime)) {
      errors.push('Invalid weekly time format (HH:MM)');
    }
    if (data.weeklyDays && Array.isArray(data.weeklyDays)) {
      data.weeklyDays.forEach(day => {
        if (!isValidDayOfWeek(day)) {
          errors.push(`Invalid day of week: ${day}`);
        }
      });
    }
  }
  
  if (data.campaignType === 'monthly') {
    if (data.monthlyTime && !isValidTime(data.monthlyTime)) {
      errors.push('Invalid monthly time format (HH:MM)');
    }
    if (data.monthlyDates && Array.isArray(data.monthlyDates)) {
      data.monthlyDates.forEach(date => {
        if (!isValidDayOfMonth(date)) {
          errors.push(`Invalid day of month: ${date}`);
        }
      });
    }
  }
  
  if (data.repeatCount !== undefined && !isValidRepeatCount(data.repeatCount)) {
    errors.push('Invalid repeat count');
  }
  
  return errors;
}

// Helper function for step validation
function validateCampaignStepData(data) {
  const errors = [];
  
  if (!data.sequence || data.sequence < 1) {
    errors.push('Sequence number must be at least 1');
  }
  
  if (!data.type || !isValidMediaType(data.type)) {
    errors.push('Invalid step type');
  }
  
  if (data.type === 'text' && (!data.body || data.body.trim().length === 0)) {
    errors.push('Text body is required for text steps');
  }
  
  if (data.type === 'media' && (!data.mediaUrl || !isHttpsUrl(data.mediaUrl))) {
    errors.push('Valid HTTPS media URL is required for media steps');
  }
  
  if (data.type === 'template' && !data.templateName) {
    errors.push('Template name is required for template steps');
  }
  
  if (data.dayOfWeek !== undefined && !isValidDayOfWeek(data.dayOfWeek)) {
    errors.push('Invalid day of week');
  }
  
  if (data.dayOfMonth !== undefined && !isValidDayOfMonth(data.dayOfMonth)) {
    errors.push('Invalid day of month');
  }
  
  if (data.delayDays !== undefined && !isValidDelayDays(data.delayDays)) {
    errors.push('Invalid delay days');
  }
  
  if (data.condition && !isValidStepCondition(data.condition)) {
    errors.push('Invalid step condition');
  }
  
  return errors;
}

module.exports = { 
  validatePhone, 
  validateTextMessage, 
  validateTemplatePlaceholders, 
  isHttpsUrl,
  isValidCampaignType,
  isValidTime,
  isValidDayOfWeek,
  isValidDayOfMonth,
  isValidCampaignStatus,
  isValidStepCondition,
  isValidMediaType,
  isValidRepeatCount,
  isValidDelayDays,
  isValidSectionId,
  validateCampaignData,
  validateCampaignStepData
};