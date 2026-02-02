const MessageLog = require('../models/MessageLog');
const { sendWhatsApp } = require('./twilio'); // implement twilio util

module.exports = async function sendDripMessage({ tenantId, campaignId, campaignName, step, contact }){
  try{
    const body = step.type === 'text' ? step.body || step.content : undefined;
    const mediaUrl = step.type === 'media' || step.type==='image' || step.type==='video' ? (step.mediaUrl || step.content) : undefined;
    const res = await sendWhatsApp(contact.phone, body, mediaUrl); // implement twilio send
    const log = await MessageLog.create({ tenantId, campaignId, campaignStepId: step._id, contactId: contact._id, provider:'twilio', providerMessageId: res.sid, status:'sent', sentAt: new Date() });
    return log;
  }catch(err){
    await MessageLog.create({ tenantId, campaignId, campaignStepId: step._id, contactId: contact._id, status:'failed', error: err.message });
    return null;
  }
}
