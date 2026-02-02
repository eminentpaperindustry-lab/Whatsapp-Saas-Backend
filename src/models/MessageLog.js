// src/models/MessageLog.js
// const mongoose = require('mongoose');

// const MessageLogSchema = new mongoose.Schema({
//   tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant' },
//   campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign' },
//   contactId: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact' },
//   provider: String, // 'meta'
//   provider_message_id: String,
//   to: String,
//   from: String,
//   direction: String, // inbound/outbound/status
//   type: String,
//   status: String,
//   payload: mongoose.Schema.Types.Mixed,
//   createdAt: { type: Date, default: Date.now }
// });

// module.exports = mongoose.model('MessageLog', MessageLogSchema);


const mongoose = require("mongoose");

const MessageLogSchema = new mongoose.Schema({
  provider: String,
  provider_message_id: String,
  tenantId: String,
  from: String,
  to: String,
  direction: { type: String, enum: ["inbound","outbound"] },
  type: String,
  status: String,
  message: String,
  payload: Object,
  timestamp: { type: Date, default: Date.now },
}, { timestamps: true });

module.exports = mongoose.model("MessageLog", MessageLogSchema);
