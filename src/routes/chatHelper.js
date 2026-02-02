const ChatSession = require("../models/ChatSession");
const Contact = require("../models/Contact");

async function updateChatSession(tenantId, phone, messageData) {
  try {
    const updateData = {
      lastMessage: messageData.message || '',
      lastMessageType: messageData.type || 'text',
      lastDirection: messageData.direction,
      lastStatus: messageData.status || 'sent',
      lastInteraction: new Date(),
      updatedAt: new Date(),
      $inc: { messageCount: 1 }
    };

    if (messageData.direction === 'inbound') {
      updateData.$inc.unreadCount = 1;
      updateData.hasReplied = true;
    } else {
      updateData.unreadCount = 0;
    }

    const session = await ChatSession.findOneAndUpdate(
      { tenantId, phone },
      updateData,
      { 
        upsert: true, 
        new: true,
        setDefaultsOnInsert: true 
      }
    );

    // Update contact
    await Contact.findOneAndUpdate(
      { tenantId, phone },
      { 
        $set: { 
          lastInteraction: new Date(),
          hasWhatsApp: true 
        } 
      },
      { upsert: true }
    );

    return session;
  } catch (error) {
    console.error("Error updating chat session:", error);
    return null;
  }
}

module.exports = {
  updateChatSession
};