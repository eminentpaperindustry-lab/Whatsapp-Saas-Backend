const mongoose = require('mongoose');

// ============================================
// SUB-SCHEMAS
// ============================================

const ButtonSchema = new mongoose.Schema({
  type: { 
    type: String, 
    enum: ['URL', 'PHONE_NUMBER', 'QUICK_REPLY'], 
    required: true 
  },
  text: { 
    type: String, 
    required: true,
    trim: true
  },
  url: { 
    type: String,
    trim: true
  },
  phone: { 
    type: String,
    trim: true
  },
  payload: { 
    type: String,
    trim: true
  },
  example: [{ type: String }] // For Meta API
});

const HeaderSchema = new mongoose.Schema({
  format: { 
    type: String, 
    enum: ['TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT', 'LOCATION', 'NONE'], 
    default: 'NONE' 
  },
  text: { 
    type: String,
    trim: true
  },
  mediaUrl: { 
    type: String,
    trim: true
  },
  example: { 
    type: String,
    trim: true
  },
  thumbnailUrl: {
    type: String,
    trim: true
  },
  filename: {
    type: String
  },
  mimeType: {
    type: String
  },
  caption: {
    type: String,
    trim: true
  }
});

const VariableSchema = new mongoose.Schema({
  type: { 
    type: String, 
    enum: ['header', 'body', 'button_url', 'footer', 'document', 'video', 'image'] 
  },
  number: { 
    type: Number, 
    required: true 
  },
  placeholder: { 
    type: String, 
    required: true 
  },
  description: { 
    type: String,
    trim: true
  },
  example: { 
    type: String,
    trim: true
  },
  required: { 
    type: Boolean, 
    default: false 
  }
});

const ComponentSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['HEADER', 'BODY', 'FOOTER', 'BUTTONS']
  },
  format: {
    type: String,
    enum: ['TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT', 'LOCATION', 'NONE']
  },
  text: {
    type: String
  },
  buttons: [ButtonSchema],
  example: {
    type: mongoose.Schema.Types.Mixed
  }
}, { _id: false });

// ============================================
// MAIN TEMPLATE SCHEMA
// ============================================

const TemplateSchema = new mongoose.Schema({
  // Tenant/Organization
  tenantId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Tenant', 
    required: true,
    index: true
  },
  
  // Basic Information
  name: { 
    type: String, 
    required: true,
    trim: true,
    lowercase: true
  },
  displayName: {
    type: String,
    trim: true
  },
  language: { 
    type: String, 
    default: 'en_US',
    enum: [
      'en_US', 'en_GB', 'en', 'hi_IN', 'es_ES', 'fr_FR', 'de_DE', 
      'pt_BR', 'ar', 'bn', 'gu', 'kn', 'ml', 'mr', 'ta', 'te', 'ur',
      'id', 'it', 'ja', 'ko', 'ms', 'nl', 'pl', 'ru', 'sv', 'th', 'tr', 'vi',
      'zh_CN', 'zh_HK', 'zh_TW'
    ]
  },
  category: { 
    type: String, 
    enum: ['UTILITY', 'MARKETING', 'AUTHENTICATION', 'TRANSACTIONAL'],
    default: 'UTILITY'
  },
  subCategory: {
    type: String,
    trim: true
  },
  
  // Template Status
  status: { 
    type: String, 
    enum: ['DRAFT', 'PENDING', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED', 'DELETED'],
    default: 'DRAFT'
  },
  source: {
    type: String,
    enum: ['local', 'meta', 'imported'],
    default: 'local'
  },
  
  // Template Components (Meta Structure)
  components: [ComponentSchema],
  
  // Template Content (For Easy Access)
  header: { 
    type: HeaderSchema, 
    default: { format: 'NONE' } 
  },
  body: { 
    type: String, 
    required: true,
    trim: true
  },
  footer: { 
    type: String,
    trim: true
  },
  buttons: { 
    type: [ButtonSchema], 
    default: [] 
  },
  
  // Variables
  variables: [VariableSchema],
  
  // Meta API Fields
  fbTemplateId: { 
    type: String,
    index: true
  },
  metaBusinessId: {
    type: String
  },
  quality_score: { 
    type: String 
  },
  rejection_reason: { 
    type: String 
  },
  review_notes: {
    type: String
  },
  
  // Media Information
  mediaInfo: {
    url: String,
    filename: String,
    mimeType: String,
    fileSize: Number,
    width: Number,
    height: Number,
    duration: Number, // for video
    pageCount: Number // for documents
  },
  
  // Sample/Example
  example: { 
    type: mongoose.Schema.Types.Mixed 
  },
  
  // Security & Compliance
  isSecured: {
    type: Boolean,
    default: false
  },
  complianceInfo: {
    privacyPolicyUrl: String,
    termsUrl: String,
    isOptIn: Boolean,
    canUnsubscribe: Boolean
  },
  
  // Analytics
  usageCount: {
    type: Number,
    default: 0
  },
  lastUsed: {
    type: Date
  },
  successRate: {
    type: Number,
    default: 0
  },
  
  // Metadata
  createdBy: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User' 
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  // Versioning
  version: {
    type: Number,
    default: 1
  },
  previousVersion: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Template'
  },
  isLatest: {
    type: Boolean,
    default: true
  },
  
  // Audit Trail
  metaCreatedAt: Date,
  metaUpdatedAt: Date,
  submittedAt: Date,
  reviewedAt: Date,
  approvedAt: Date,
  rejectedAt: Date,
  
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// ============================================
// INDEXES
// ============================================
TemplateSchema.index({ tenantId: 1, name: 1, language: 1 }, { unique: true });
TemplateSchema.index({ tenantId: 1, status: 1 });
TemplateSchema.index({ tenantId: 1, category: 1 });
TemplateSchema.index({ tenantId: 1, source: 1 });
TemplateSchema.index({ fbTemplateId: 1 });
TemplateSchema.index({ createdAt: -1 });
TemplateSchema.index({ updatedAt: -1 });
TemplateSchema.index({ 'header.format': 1 });
TemplateSchema.index({ 'buttons.type': 1 });

// ============================================
// VIRTUALS
// ============================================

TemplateSchema.virtual('variableCount').get(function() {
  return this.variables ? this.variables.length : 0;
});

TemplateSchema.virtual('buttonCount').get(function() {
  return this.buttons ? this.buttons.length : 0;
});

TemplateSchema.virtual('isApproved').get(function() {
  return this.status === 'APPROVED';
});

TemplateSchema.virtual('isPending').get(function() {
  return this.status === 'PENDING' || this.status === 'IN_REVIEW';
});

TemplateSchema.virtual('canEdit').get(function() {
  return this.source === 'local' && !['APPROVED', 'DELETED'].includes(this.status);
});

TemplateSchema.virtual('canDelete').get(function() {
  return this.source === 'local' && this.status !== 'DELETED';
});

TemplateSchema.virtual('canSendTest').get(function() {
  return this.status === 'APPROVED' && this.fbTemplateId;
});

TemplateSchema.virtual('isOnMeta').get(function() {
  return !!this.fbTemplateId;
});

TemplateSchema.virtual('hasHeader').get(function() {
  return this.header && this.header.format !== 'NONE';
});

TemplateSchema.virtual('hasFooter').get(function() {
  return this.footer && this.footer.trim().length > 0;
});

TemplateSchema.virtual('hasMediaHeader').get(function() {
  return this.header && ['IMAGE', 'VIDEO', 'DOCUMENT', 'LOCATION'].includes(this.header.format);
});

TemplateSchema.virtual('hasTextHeader').get(function() {
  return this.header && this.header.format === 'TEXT';
});

TemplateSchema.virtual('formattedName').get(function() {
  return this.name.split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
});

TemplateSchema.virtual('createdDate').get(function() {
  return this.createdAt ? this.createdAt.toLocaleDateString() : 'N/A';
});

TemplateSchema.virtual('updatedDate').get(function() {
  return this.updatedAt ? this.updatedAt.toLocaleDateString() : 'N/A';
});

// ============================================
// METHODS
// ============================================

// Extract variables from template
TemplateSchema.methods.extractVariables = function() {
  const variables = [];
  const seen = new Set();
  
  // Extract from body
  if (this.body) {
    const bodyMatches = this.body.match(/{{(\d+)}}/g) || [];
    bodyMatches.forEach(match => {
      const varNum = match.match(/\d+/)[0];
      const key = `body_${varNum}`;
      
      if (!seen.has(key)) {
        variables.push({
          type: 'body',
          number: parseInt(varNum),
          placeholder: match,
          description: `Body variable ${varNum}`,
          required: true,
          example: `Sample Value ${varNum}`
        });
        seen.add(key);
      }
    });
  }
  
  // Extract from header text
  if (this.header?.format === 'TEXT' && this.header?.text) {
    const headerMatches = this.header.text.match(/{{(\d+)}}/g) || [];
    headerMatches.forEach(match => {
      const varNum = match.match(/\d+/)[0];
      const key = `header_${varNum}`;
      
      if (!seen.has(key)) {
        variables.push({
          type: 'header',
          number: parseInt(varNum),
          placeholder: match,
          description: `Header variable ${varNum}`,
          required: true,
          example: `Header Value ${varNum}`
        });
        seen.add(key);
      }
    });
  }
  
  // Extract from footer
  if (this.footer) {
    const footerMatches = this.footer.match(/{{(\d+)}}/g) || [];
    footerMatches.forEach(match => {
      const varNum = match.match(/\d+/)[0];
      const key = `footer_${varNum}`;
      
      if (!seen.has(key)) {
        variables.push({
          type: 'footer',
          number: parseInt(varNum),
          placeholder: match,
          description: `Footer variable ${varNum}`,
          required: false,
          example: `Footer Value ${varNum}`
        });
        seen.add(key);
      }
    });
  }
  
  // Extract from buttons
  if (this.buttons && this.buttons.length > 0) {
    this.buttons.forEach((button, idx) => {
      if (button.type === 'URL' && button.url) {
        const buttonMatches = button.url.match(/{{(\d+)}}/g) || [];
        buttonMatches.forEach(match => {
          const varNum = match.match(/\d+/)[0];
          const key = `button_${idx}_${varNum}`;
          
          if (!seen.has(key)) {
            variables.push({
              type: 'button_url',
              number: parseInt(varNum),
              placeholder: match,
              description: `Button ${idx + 1} URL variable ${varNum}`,
              required: true,
              example: `https://example.com/value${varNum}`
            });
            seen.add(key);
          }
        });
      }
    });
  }
  
  return variables.sort((a, b) => a.number - b.number);
};

// Get status color class
TemplateSchema.methods.getStatusColor = function() {
  const colors = {
    'DRAFT': 'bg-gray-100 text-gray-800',
    'PENDING': 'bg-yellow-100 text-yellow-800',
    'IN_REVIEW': 'bg-blue-100 text-blue-800',
    'APPROVED': 'bg-green-100 text-green-800',
    'REJECTED': 'bg-red-100 text-red-800',
    'PAUSED': 'bg-orange-100 text-orange-800',
    'DISABLED': 'bg-gray-100 text-gray-800',
    'DELETED': 'bg-gray-100 text-gray-800'
  };
  return colors[this.status] || 'bg-gray-100 text-gray-800';
};

// Get category color class
TemplateSchema.methods.getCategoryColor = function() {
  const colors = {
    'UTILITY': 'bg-blue-100 text-blue-800',
    'MARKETING': 'bg-purple-100 text-purple-800',
    'AUTHENTICATION': 'bg-orange-100 text-orange-800',
    'TRANSACTIONAL': 'bg-teal-100 text-teal-800'
  };
  return colors[this.category] || 'bg-gray-100 text-gray-800';
};

// Get source color class
TemplateSchema.methods.getSourceColor = function() {
  const colors = {
    'local': 'bg-green-100 text-green-800',
    'meta': 'bg-blue-100 text-blue-800',
    'imported': 'bg-purple-100 text-purple-800'
  };
  return colors[this.source] || 'bg-gray-100 text-gray-800';
};

// Prepare for Meta API
TemplateSchema.methods.prepareForMetaAPI = function() {
  const components = [];
  
  // Header Component
  if (this.header && this.header.format !== 'NONE') {
    const headerComponent = {
      type: 'HEADER',
      format: this.header.format
    };
    
    if (this.header.format === 'TEXT') {
      headerComponent.text = this.header.text;
      if (this.header.text) {
        headerComponent.example = {
          header_text: [this.header.text]
        };
      }
    } else {
      if (this.header.example || this.header.mediaUrl) {
        headerComponent.example = {
          header_handle: [this.header.example || this.header.mediaUrl]
        };
      }
    }
    
    components.push(headerComponent);
  }
  
  // Body Component
  if (this.body) {
    const bodyComponent = {
      type: 'BODY',
      text: this.body
    };
    
    const variableMatches = this.body.match(/{{(\d+)}}/g) || [];
    if (variableMatches.length > 0) {
      const examples = [];
      for (let i = 0; i < Math.min(variableMatches.length, 10); i++) {
        examples.push(`Sample Value ${i + 1}`);
      }
      bodyComponent.example = {
        body_text: [examples]
      };
    }
    
    components.push(bodyComponent);
  }
  
  // Footer Component
  if (this.footer && this.footer.trim()) {
    components.push({
      type: 'FOOTER',
      text: this.footer
    });
  }
  
  // Buttons Component
  if (this.buttons && this.buttons.length > 0) {
    const buttonsComponent = {
      type: 'BUTTONS'
    };
    
    const metaButtons = this.buttons.map(button => {
      const metaButton = {
        type: button.type,
        text: button.text
      };
      
      if (button.type === 'URL') {
        metaButton.url = button.url;
        if (button.url && button.url.includes('{{')) {
          metaButton.example = [button.url.replace(/{{(\d+)}}/g, 'example.com')];
        }
      } else if (button.type === 'PHONE_NUMBER') {
        metaButton.phone_number = button.phone;
      }
      // QUICK_REPLY doesn't need additional fields
      
      return metaButton;
    });
    
    buttonsComponent.buttons = metaButtons;
    components.push(buttonsComponent);
  }
  
  return {
    name: this.name.toLowerCase().replace(/\s+/g, '_'),
    language: this.language || 'en_US',
    category: this.category || 'UTILITY',
    components: components
  };
};

// Validate template for Meta
TemplateSchema.methods.validateForMeta = function() {
  const errors = [];
  
  // Name validation
  if (!this.name || !this.name.match(/^[a-z0-9_]+$/)) {
    errors.push('Template name must contain only lowercase letters, numbers, and underscores');
  }
  
  if (this.name.length < 1 || this.name.length > 512) {
    errors.push('Template name must be between 1 and 512 characters');
  }
  
  // Body validation
  if (!this.body || this.body.trim().length === 0) {
    errors.push('Body text is required');
  }
  
  if (this.body.length > 1024) {
    errors.push('Body text cannot exceed 1024 characters');
  }
  
  // Header validation
  if (this.header?.format === 'TEXT') {
    if (!this.header.text || this.header.text.trim().length === 0) {
      errors.push('Header text is required for TEXT format');
    }
    if (this.header.text.length > 60) {
      errors.push('Header text cannot exceed 60 characters');
    }
  }
  
  // Footer validation
  if (this.footer && this.footer.length > 60) {
    errors.push('Footer text cannot exceed 60 characters');
  }
  
  // Buttons validation
  if (this.buttons && this.buttons.length > 0) {
    if (this.buttons.length > 3) {
      errors.push('Maximum 3 buttons allowed');
    }
    
    this.buttons.forEach((button, index) => {
      if (!button.text || button.text.trim().length === 0) {
        errors.push(`Button ${index + 1}: Text is required`);
      }
      
      if (button.text.length > 25) {
        errors.push(`Button ${index + 1}: Text cannot exceed 25 characters`);
      }
      
      if (button.type === 'URL') {
        if (!button.url || button.url.trim().length === 0) {
          errors.push(`Button ${index + 1}: URL is required for URL button`);
        }
      }
      
      if (button.type === 'PHONE_NUMBER') {
        if (!button.phone || button.phone.trim().length === 0) {
          errors.push(`Button ${index + 1}: Phone number is required`);
        }
        const phoneRegex = /^\+[1-9]\d{1,14}$/;
        if (!phoneRegex.test(button.phone)) {
          errors.push(`Button ${index + 1}: Invalid phone number format (must be E.164: +1234567890)`);
        }
      }
    });
  }
  
  return errors;
};

// Create duplicate template
TemplateSchema.methods.duplicate = async function(newName) {
  const duplicate = this.toObject();
  delete duplicate._id;
  delete duplicate.fbTemplateId;
  delete duplicate.metaInfo;
  
  duplicate.name = newName;
  duplicate.status = 'DRAFT';
  duplicate.version = 1;
  duplicate.previousVersion = this._id;
  duplicate.createdAt = new Date();
  duplicate.updatedAt = new Date();
  
  return await this.constructor.create(duplicate);
};

// ============================================
// STATICS
// ============================================

// Get stats by tenant
TemplateSchema.statics.getStats = async function(tenantId) {
  const stats = await this.aggregate([
    { $match: { tenantId: new mongoose.Types.ObjectId(tenantId) } },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        draft: { $sum: { $cond: [{ $eq: ['$status', 'DRAFT'] }, 1, 0] } },
        pending: { $sum: { $cond: [{ $eq: ['$status', 'PENDING'] }, 1, 0] } },
        in_review: { $sum: { $cond: [{ $eq: ['$status', 'IN_REVIEW'] }, 1, 0] } },
        approved: { $sum: { $cond: [{ $eq: ['$status', 'APPROVED'] }, 1, 0] } },
        rejected: { $sum: { $cond: [{ $eq: ['$status', 'REJECTED'] }, 1, 0] } },
        paused: { $sum: { $cond: [{ $eq: ['$status', 'PAUSED'] }, 1, 0] } },
        disabled: { $sum: { $cond: [{ $eq: ['$status', 'DISABLED'] }, 1, 0] } },
        
        utility: { $sum: { $cond: [{ $eq: ['$category', 'UTILITY'] }, 1, 0] } },
        marketing: { $sum: { $cond: [{ $eq: ['$category', 'MARKETING'] }, 1, 0] } },
        authentication: { $sum: { $cond: [{ $eq: ['$category', 'AUTHENTICATION'] }, 1, 0] } },
        transactional: { $sum: { $cond: [{ $eq: ['$category', 'TRANSACTIONAL'] }, 1, 0] } },
        
        local: { $sum: { $cond: [{ $eq: ['$source', 'local'] }, 1, 0] } },
        meta: { $sum: { $cond: [{ $eq: ['$source', 'meta'] }, 1, 0] } },
        imported: { $sum: { $cond: [{ $eq: ['$source', 'imported'] }, 1, 0] } },
        
        withHeader: { $sum: { $cond: [{ $ne: ['$header.format', 'NONE'] }, 1, 0] } },
        withFooter: { $sum: { $cond: [{ $and: [{ $ne: ['$footer', null] }, { $ne: ['$footer', ''] }] }, 1, 0] } },
        withButtons: { $sum: { $cond: [{ $gt: [{ $size: { $ifNull: ['$buttons', []] } }, 0] }, 1, 0] } }
      }
    }
  ]);
  
  return stats[0] || {
    total: 0,
    draft: 0,
    pending: 0,
    in_review: 0,
    approved: 0,
    rejected: 0,
    paused: 0,
    disabled: 0,
    utility: 0,
    marketing: 0,
    authentication: 0,
    transactional: 0,
    local: 0,
    meta: 0,
    imported: 0,
    withHeader: 0,
    withFooter: 0,
    withButtons: 0
  };
};

// Find templates needing sync
TemplateSchema.statics.findNeedingSync = function(tenantId, limit = 50) {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  
  return this.find({
    tenantId: new mongoose.Types.ObjectId(tenantId),
    fbTemplateId: { $ne: null },
    $or: [
      { lastSyncedAt: { $lt: oneHourAgo } },
      { lastSyncedAt: { $exists: false } }
    ],
    status: { $in: ['PENDING', 'IN_REVIEW', 'APPROVED'] }
  }).limit(limit);
};

// ============================================
// MIDDLEWARE
// ============================================

// Store original status before save
TemplateSchema.pre('save', function(next) {
  // Store original status for comparison
  if (this.isNew) {
    this._originalStatus = this.status;
  } else {
    this._originalStatus = this._originalStatus || this.status;
  }
  next();
});

// Pre-save: Extract variables and set display name
TemplateSchema.pre('save', function(next) {
  const previousStatus = this._originalStatus || this.status;
  
  if (this.isModified('body') || this.isModified('header') || this.isModified('footer') || this.isModified('buttons')) {
    this.variables = this.extractVariables();
  }
  
  // Set display name
  if (this.isModified('name')) {
    this.displayName = this.name.split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
  
  // Update timestamps for status changes
  if (this.isModified('status')) {
    const now = new Date();
    
    switch(this.status) {
      case 'PENDING':
      case 'IN_REVIEW':
        this.submittedAt = now;
        break;
      case 'APPROVED':
        this.approvedAt = now;
        break;
      case 'REJECTED':
        this.rejectedAt = now;
        break;
    }
    
    console.log(`📝 Template "${this.name}" status changed: ${previousStatus} → ${this.status}`);
  }
  
  next();
});

// Post-save: Log creation
TemplateSchema.post('save', function(doc) {
  console.log(`💾 Template saved: ${doc.name} - Status: ${doc.status}, Category: ${doc.category}, Variables: ${doc.variables.length}`);
});

// Post-remove: Log deletion
TemplateSchema.post('remove', function(doc) {
  console.log(`🗑️ Template deleted: ${doc.name} - Was on Meta: ${!!doc.fbTemplateId}`);
});

module.exports = mongoose.model('Template', TemplateSchema);