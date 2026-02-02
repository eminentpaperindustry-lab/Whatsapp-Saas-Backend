// src/models/Section.js
const mongoose = require('mongoose');

const SectionSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  name: { type: String, required: true },
}, { timestamps: true });

SectionSchema.index({ tenantId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('Section', SectionSchema);
