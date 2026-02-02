// src/models/User.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const UserSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['admin','user'], default: 'user' },
  resetToken: String,
  resetTokenExpiry: Date
}, { timestamps: true });

UserSchema.methods.setPassword = async function(password) {
  const salt = await bcrypt.genSalt(12);
  this.passwordHash = await bcrypt.hash(password, salt);
};
UserSchema.methods.validatePassword = async function(password) {
  return bcrypt.compare(password, this.passwordHash);
};
UserSchema.methods.createResetToken = function() {
  const token = crypto.randomBytes(32).toString('hex');
  this.resetToken = token;
  this.resetTokenExpiry = Date.now() + 60*60*1000; // 1 hour
  return token;
};

module.exports = mongoose.model('User', UserSchema);
