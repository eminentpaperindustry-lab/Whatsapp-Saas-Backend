// src/models/Contact.js
const mongoose = require('mongoose');

const ContactSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  name: { type: String, required: true },
  phone: { type: String, required: true },
  tags: [String],
  metadata: { type: Object, default: {} },
  section: { type: mongoose.Schema.Types.ObjectId, ref: 'Section', required: true }
}, { timestamps: true });

ContactSchema.index({ tenantId: 1, phone: 1 }, { unique: true });

module.exports = mongoose.model('Contact', ContactSchema);
