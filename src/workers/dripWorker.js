require('dotenv').config();
const mongoose = require('mongoose');
const Campaign = require('../models/Campaign');
const Contact = require('../models/Contact');
const sendDripMessage = require('../utils/sendDripMessage');

async function main(){
  await mongoose.connect(process.env.MONGO_URI);
  const campaigns = await Campaign.find({});
  const today = new Date().toDateString();
  for(const c of campaigns){
    for(const s of c.steps){
      const created = c.createdAt || c.created_at || (c._id.getTimestamp && c._id.getTimestamp());
      const target = new Date(created);
      target.setDate(target.getDate() + (s.delayDays || 0));
      if(target.toDateString() === today){
        const contacts = await Contact.find({ tenantId: c.tenantId });
        for(const contact of contacts){
          await sendDripMessage({ tenantId:c.tenantId, campaignId:c._id, campaignName:c.name, step:s, contact });
        }
      }
    }
  }
  process.exit(0);
}

main().catch(err=>{ console.error(err); process.exit(1); });
