// src/models/Template.js
const mongoose = require('mongoose');

const ButtonSchema = new mongoose.Schema({
  type: { type: String, enum: ['url', 'call', 'quick_reply'], required: true },
  text: { type: String, required: true },
  payload: { type: String, default: '' } // URL, phone number or quick reply text
});

const TemplateSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  name: { type: String, required: true },
  type: { type: String, enum: ['text','image','video','template'], default: 'text' },
  body: String,
  mediaUrl: String,
  header: {
    type: {
      format: { type: String, enum: ['TEXT','IMAGE','VIDEO','NONE'], default: 'NONE' },
      text: String,
      link: String
    },
    default: { format: 'NONE' }
  },
  buttons: { type: [ButtonSchema], default: [] },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

module.exports = mongoose.model('Template', TemplateSchema);
