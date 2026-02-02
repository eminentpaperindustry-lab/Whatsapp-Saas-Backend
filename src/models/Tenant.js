// src/models/Tenant.js
const mongoose = require('mongoose');

const TenantSchema = new mongoose.Schema({
  name: { type: String, required: true },
  contact_email: String,
  metadata: { type: Object, default: {} }
}, { timestamps: true });

module.exports = mongoose.model('Tenant', TenantSchema);
