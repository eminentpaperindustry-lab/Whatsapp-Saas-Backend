const twilio = require('twilio');
const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);

async function sendWhatsApp(toE164, body, mediaUrl){
  const msg = { from: process.env.TWILIO_WHATSAPP_FROM, to: `whatsapp:${toE164}`, body: body || undefined };
  if(mediaUrl) msg.mediaUrl = [mediaUrl];
  return client.messages.create(msg);
}
module.exports = { sendWhatsApp };
