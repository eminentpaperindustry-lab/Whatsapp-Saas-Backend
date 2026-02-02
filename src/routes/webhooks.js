const express = require("express");
const router = express.Router();
const crypto = require("crypto");

// Import models
const MessageLog = require("../models/MessageLog");
const CampaignProgress = require("../models/CampaignProgress");
const ChatSession = require("../models/ChatSession");
const Contact = require("../models/Contact");

// ===============================
// Tenant finder
// ===============================
async function findTenantByWaPhoneId(waPhoneId) {
  try {
    if (String(waPhoneId) === String(process.env.META_WA_PHONE_ID)) {
      return {
        tenantId: process.env.DEFAULT_TENANT_ID || "default",
        businessPhone: process.env.BUSINESS_PHONE_NUMBER || "918920101739",
        phoneId: waPhoneId
      };
    }
    
    return {
      tenantId: process.env.DEFAULT_TENANT_ID || "default",
      businessPhone: process.env.BUSINESS_PHONE_NUMBER || "918920101739",
      phoneId: waPhoneId
    };
  } catch (error) {
    console.error("Error finding tenant:", error);
    return null;
  }
}

// ===============================
// Signature verification
// ===============================
function verifySignature(rawBody, signatureHeader) {
  try {
    if (!rawBody) {
      console.warn("❌ No raw body for signature verification");
      return false;
    }

    // Dev mode - skip verification if no secret
    if (!process.env.META_APP_SECRET) {
      console.log("⚠️  Dev mode: Skipping signature verification");
      return true;
    }

    if (!signatureHeader) {
      console.warn("❌ No signature header");
      return false;
    }
    
    const parts = signatureHeader.split("=");
    if (parts.length !== 2) {
      console.warn("❌ Invalid signature format");
      return false;
    }

    const sigHash = parts[1];
    const expected = crypto
      .createHmac("sha256", process.env.META_APP_SECRET)
      .update(rawBody)
      .digest("hex");

    const isValid = crypto.timingSafeEqual(
      Buffer.from(sigHash, "hex"),
      Buffer.from(expected, "hex")
    );
    
    if (!isValid) {
      console.warn("❌ Signature verification failed");
    }
    
    return isValid;
  } catch (e) {
    console.error("Signature verification error:", e.message);
    return false;
  }
}

// ===============================
// Update Chat Session Helper
// ===============================
async function updateChatSession(tenantId, phone, messageData) {
  try {
    if (!tenantId || !phone) {
      console.warn("Missing tenantId or phone for chat session update");
      return null;
    }

    const updateData = {
      lastMessage: messageData.message || '',
      lastMessageType: messageData.type || 'text',
      lastDirection: messageData.direction,
      lastStatus: messageData.status || 'received',
      lastInteraction: new Date(),
      updatedAt: new Date(),
      $inc: { messageCount: 1 }
    };

    // If inbound message, increase unread count and mark as replied
    if (messageData.direction === 'inbound') {
      updateData.$inc.unreadCount = 1;
      updateData.hasReplied = true;
    } else {
      // For outbound, reset unread count
      updateData.unreadCount = 0;
    }

    // Try to find contact
    let contact = await Contact.findOne({ tenantId, phone }).lean();
    if (contact) {
      updateData.contactId = contact._id;
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

    // Update contact if exists
    await Contact.findOneAndUpdate(
      { tenantId, phone },
      { 
        $set: { 
          lastInteraction: new Date(),
          hasWhatsApp: true,
          lastMessage: messageData.message || '',
          lastMessageType: messageData.type || 'text',
          lastMessageDirection: messageData.direction,
          lastMessageStatus: messageData.status || 'received'
        } 
      },
      { upsert: true }
    );

    console.log(`✅ Chat session updated for ${phone}`);
    return session;
  } catch (error) {
    console.error("❌ Error updating chat session:", error);
    return null;
  }
}

// ===============================
// Update Campaign Progress for Replies
// ===============================
async function updateCampaignProgressForReply(tenantId, contactPhone) {
  try {
    // Find contact by phone
    const contact = await Contact.findOne({
      tenantId,
      phone: contactPhone
    });

    if (!contact) {
      console.log(`Contact not found for phone: ${contactPhone}`);
      
      // Create contact if not exists
      const newContact = await Contact.create({
        tenantId,
        phone: contactPhone,
        hasWhatsApp: true,
        lastInteraction: new Date(),
        createdAt: new Date()
      });
      
      console.log(`✅ Created new contact for ${contactPhone}`);
      return;
    }

    // Update all active campaigns for this contact
    const result = await CampaignProgress.updateMany(
      {
        tenantId,
        contactId: contact._id,
        status: { $in: ['active', 'pending'] },
        hasReplied: false
      },
      {
        $set: {
          hasReplied: true,
          lastInteraction: new Date(),
          repliedAt: new Date(),
          status: 'replied'
        },
        $push: {
          interactions: {
            type: 'reply',
            timestamp: new Date()
          }
        }
      }
    );

    if (result.modifiedCount > 0) {
      console.log(`✅ Updated ${result.modifiedCount} campaign(s) for contact: ${contactPhone}`);
    }

  } catch (error) {
    console.error("❌ Error updating campaign progress:", error);
  }
}

// ===============================
// Process Inbound Message
// ===============================
async function processInboundMessage(msg, tenantId, businessPhone, value) {
  try {
    if (!msg?.from || !msg?.id) {
      console.warn("❌ Invalid message: missing from or id");
      return null;
    }

    // Skip ephemeral, system, reaction messages
    if (["ephemeral", "system", "reaction"].includes(msg.type)) {
      console.log(`⏭️  Skipping ${msg.type} message`);
      return null;
    }

    let messageContent = "";
    let mediaUrl = "";
    
    switch (msg.type) {
      case "text":
        messageContent = msg.text?.body || "";
        break;
      case "image":
        messageContent = msg.image?.caption || `[IMAGE]`;
        mediaUrl = msg.image?.id || "";
        break;
      case "video":
        messageContent = msg.video?.caption || `[VIDEO]`;
        mediaUrl = msg.video?.id || "";
        break;
      case "audio":
        messageContent = `[AUDIO - ${Math.round(msg.audio?._seconds || 0)}s]`;
        mediaUrl = msg.audio?.id || "";
        break;
      case "document":
        messageContent = msg.document?.caption || `[DOCUMENT: ${msg.document?.filename || 'file'}]`;
        mediaUrl = msg.document?.id || "";
        break;
      case "location":
        messageContent = `📍 Location: ${msg.location?.latitude}, ${msg.location?.longitude}`;
        break;
      case "contacts":
        messageContent = `[CONTACTS: ${msg.contacts?.length || 0} contact(s)]`;
        break;
      case "button":
        messageContent = msg.button?.text || `[BUTTON: ${msg.button?.payload || 'clicked'}]`;
        break;
      case "interactive":
        if (msg.interactive?.type === "button_reply") {
          messageContent = `[BUTTON REPLY: ${msg.interactive?.button_reply?.title || 'clicked'}]`;
        } else if (msg.interactive?.type === "list_reply") {
          messageContent = `[LIST REPLY: ${msg.interactive?.list_reply?.title || 'selected'}]`;
        } else {
          messageContent = `[INTERACTIVE: ${msg.interactive?.type || 'unknown'}]`;
        }
        break;
      default:
        messageContent = `[${msg.type?.toUpperCase() || 'UNKNOWN'}]`;
    }

    // Prevent duplicates
    const exists = await MessageLog.findOne({
      provider: "meta",
      provider_message_id: msg.id,
    }).lean();
    
    if (exists) {
      console.log(`⏭️  Duplicate message ${msg.id}, skipping`);
      return null;
    }

    const timestamp = msg.timestamp ? 
      new Date(Number(msg.timestamp) * 1000) : new Date();

    // Prepare payload for MessageLog
    const messagePayload = {
      provider: "meta",
      provider_message_id: msg.id,
      tenantId,
      from: msg.from,
      to: businessPhone,
      direction: "inbound",
      type: msg.type || "text",
      status: "received",
      message: messageContent,
      payload: msg,
      timestamp: timestamp,
    };

    // Add media URL if available
    if (mediaUrl) {
      messagePayload.mediaUrl = mediaUrl;
    }

    // Save to MessageLog
    const savedMessage = await MessageLog.create(messagePayload);

    // Update Chat Session
    await updateChatSession(tenantId, msg.from, {
      message: messageContent,
      type: msg.type || 'text',
      direction: 'inbound',
      status: 'received',
      payload: msg
    });

    // Update campaign progress if contact replied
    await updateCampaignProgressForReply(tenantId, msg.from);

    console.log(`✅ Inbound message saved from ${msg.from}: ${messageContent.substring(0, 50)}...`);
    
    return savedMessage;

  } catch (error) {
    console.error("❌ Error processing inbound message:", error);
    return null;
  }
}

// ===============================
// Process Status Update
// ===============================
async function processStatusUpdate(st, io) {
  try {
    const messageId = st?.id;
    const newStatus = st?.status;
    const recipientId = st?.recipient_id;
    
    if (!messageId || !newStatus) {
      console.warn("❌ Invalid status update: missing id or status");
      return null;
    }

    // Find the message
    const message = await MessageLog.findOne({
      provider: "meta",
      provider_message_id: messageId,
      direction: "outbound"
    });

    if (!message) {
      console.log(`⚠️  Message not found for status update: ${messageId}`);
      return null;
    }

    // Update message status
    const updatedMessage = await MessageLog.findOneAndUpdate(
      { provider: "meta", provider_message_id: messageId, direction: "outbound" },
      { 
        $set: { 
          status: newStatus, 
          updatedAt: new Date(),
          payload: st 
        } 
      },
      { new: true }
    );

    // Update Chat Session status
    if (message.to && message.tenantId) {
      await ChatSession.findOneAndUpdate(
        { tenantId: message.tenantId, phone: message.to },
        { 
          $set: { 
            lastStatus: newStatus,
            updatedAt: new Date()
          } 
        }
      );
    }

    console.log(`✅ Status updated for ${messageId}: ${newStatus}`);
    
    // Emit socket event
    if (io && updatedMessage && updatedMessage.tenantId) {
      io.to(`tenant_${updatedMessage.tenantId}`).emit("message:status_updated", updatedMessage);
      
      // Also emit session update
      if (message.to) {
        io.to(`tenant_${updatedMessage.tenantId}`).emit("session:updated", {
          phone: message.to,
          lastStatus: newStatus,
          updatedAt: new Date()
        });
      }
    }

    return updatedMessage;

  } catch (error) {
    console.error("❌ Error processing status update:", error);
    return null;
  }
}

// ===============================
// GET webhook verification
// ===============================
const verifyGET = (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  console.log("🔍 Webhook verification attempt:", {
    mode,
    token,
    challengeLength: challenge?.length,
    expectedToken: process.env.META_WEBHOOK_VERIFY_TOKEN
  });

  if (mode === "subscribe" && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
    console.log("✅ Webhook Verified Successfully!");
    return res.status(200).send(challenge);
  }
  
  console.warn("❌ Webhook verification failed");
  return res.status(403).send("Verification failed");
};

// ===============================
// POST webhook receiver (MAIN FUNCTION)
// ===============================
const handlePOST = async (req, res) => {
  const io = req.app.get("io");
  let rawBody = null;
  
  try {
    // Get raw body and signature
    rawBody = req.rawBody;
    const sig = req.headers["x-hub-signature-256"];

    // Send immediate response to Meta
    res.sendStatus(200);

    // Verify signature
    if (!verifySignature(rawBody, sig)) {
      console.warn("❌ Invalid webhook signature, skipping processing");
      return;
    }

    // Parse the event
    let event;
    try {
      event = JSON.parse(rawBody.toString("utf8"));
    } catch (e) {
      console.error("❌ Failed to parse webhook JSON:", e.message);
      return;
    }

    console.log("📨 Webhook received:", {
      object: event.object,
      entryCount: event.entry?.length || 0
    });

    // Process each entry
    const entries = Array.isArray(event.entry) ? event.entry : [];
    
    for (const entry of entries) {
      const changes = Array.isArray(entry.changes) ? entry.changes : [];
      
      for (const ch of changes) {
        const value = ch.value || {};
        const waPhoneId = value?.metadata?.phone_number_id;
        const field = ch.field;

        console.log(`🔄 Processing field: ${field}, phone_id: ${waPhoneId}`);

        // Skip if not messages field
        if (field !== "messages") {
          console.log(`⏭️  Skipping non-messages field: ${field}`);
          continue;
        }

        // Tenant lookup
        let tenantInfo = null;
        if (waPhoneId) {
          tenantInfo = await findTenantByWaPhoneId(waPhoneId);
          if (!tenantInfo) {
            console.warn(`⚠️ Tenant not found for WA phone_number_id: ${waPhoneId}`);
            continue;
          }
        } else {
          console.warn("⚠️ No phone_number_id in webhook");
          continue;
        }

        const tenantId = tenantInfo.tenantId;
        const businessPhone = tenantInfo.businessPhone;

        console.log(`🏢 Tenant: ${tenantId}, Business: ${businessPhone}`);

        // ------------------------
        // A) Incoming messages
        // ------------------------
        if (Array.isArray(value.messages)) {
          console.log(`📥 Processing ${value.messages.length} incoming message(s)`);
          
          for (const msg of value.messages) {
            const savedMessage = await processInboundMessage(msg, tenantId, businessPhone, value);
            
            // Emit socket event if message was saved
            if (savedMessage && io) {
              io.to(`tenant_${tenantId}`).emit("message:new", savedMessage);
              
              // Also emit session update
              io.to(`tenant_${tenantId}`).emit("session:updated", {
                phone: msg.from,
                lastMessage: savedMessage.message,
                lastDirection: 'inbound',
                lastStatus: 'received',
                lastInteraction: new Date(),
                updatedAt: new Date(),
                unreadCount: 1,
                hasReplied: true
              });
            }
          }
        }

        // ------------------------
        // B) Status updates
        // ------------------------
        if (Array.isArray(value.statuses)) {
          console.log(`📊 Processing ${value.statuses.length} status update(s)`);
          
          for (const st of value.statuses) {
            await processStatusUpdate(st, io);
          }
        }

        // ------------------------
        // C) Message errors
        // ------------------------
        if (Array.isArray(value.errors)) {
          console.warn(`❌ ${value.errors.length} error(s) in webhook:`);
          
          for (const err of value.errors) {
            console.error("Webhook error:", {
              code: err.code,
              title: err.error_data?.details,
              message: err.message
            });
            
            // Update message status to failed if we have the message ID
            if (err.error_data?.details?.includes("message-id")) {
              const messageIdMatch = err.error_data.details.match(/message-id:([^,]+)/);
              if (messageIdMatch && messageIdMatch[1]) {
                const failedMessageId = messageIdMatch[1].trim();
                
                await MessageLog.findOneAndUpdate(
                  { provider_message_id: failedMessageId },
                  { $set: { status: 'failed', error: err.message } }
                );
                
                console.log(`✅ Marked message ${failedMessageId} as failed`);
              }
            }
          }
        }
      }
    }

    console.log("✅ Webhook processing completed successfully");

  } catch (err) {
    console.error("❌ Webhook processing error:", err.message);
    console.error(err.stack);
    
    // Try to send 200 even on error (Meta expects it)
    try { 
      if (!res.headersSent) {
        res.sendStatus(200); 
      }
    } catch (e) {
      console.error("Failed to send error response:", e);
    }
  }
};

// ===============================
// Utility Functions
// ===============================

/**
 * Get all webhook events for debugging
 */
const getWebhookLogs = async (req, res) => {
  try {
    const { limit = 100, tenantId } = req.query;
    
    const query = {};
    if (tenantId) {
      query.tenantId = tenantId;
    }
    
    const logs = await MessageLog.find(query)
      .sort({ timestamp: -1 })
      .limit(parseInt(limit))
      .lean();
    
    const stats = {
      total: await MessageLog.countDocuments(query),
      inbound: await MessageLog.countDocuments({ ...query, direction: 'inbound' }),
      outbound: await MessageLog.countDocuments({ ...query, direction: 'outbound' }),
      byStatus: await MessageLog.aggregate([
        { $match: query },
        { $group: { _id: "$status", count: { $sum: 1 } } }
      ]),
      byType: await MessageLog.aggregate([
        { $match: query },
        { $group: { _id: "$type", count: { $sum: 1 } } }
      ])
    };
    
    res.json({
      success: true,
      logs,
      stats,
      count: logs.length
    });
    
  } catch (error) {
    console.error("Error getting webhook logs:", error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
};

/**
 * Resend failed messages
 */
const retryFailedMessages = async (req, res) => {
  try {
    const { tenantId, messageIds } = req.body;
    
    if (!tenantId) {
      return res.status(400).json({ 
        success: false, 
        error: "tenantId is required" 
      });
    }
    
    const query = {
      tenantId,
      status: 'failed',
      direction: 'outbound'
    };
    
    if (messageIds && Array.isArray(messageIds)) {
      query._id = { $in: messageIds };
    }
    
    const failedMessages = await MessageLog.find(query).lean();
    
    // Here you would implement your retry logic
    // For now, just mark them as pending
    const result = await MessageLog.updateMany(
      query,
      { $set: { status: 'pending', retryCount: { $inc: 1 } } }
    );
    
    res.json({
      success: true,
      message: `${result.modifiedCount} messages marked for retry`,
      modifiedCount: result.modifiedCount,
      failedMessages: failedMessages.length
    });
    
  } catch (error) {
    console.error("Error retrying failed messages:", error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
};

/**
 * Webhook test endpoint (for debugging)
 */
const testWebhook = async (req, res) => {
  try {
    const testPayload = {
      entry: [{
        changes: [{
          value: {
            metadata: {
              phone_number_id: process.env.META_WA_PHONE_ID
            },
            messages: [{
              from: "919876543210", // Test phone number
              id: "test_" + Date.now(),
              timestamp: Math.floor(Date.now() / 1000),
              type: "text",
              text: { body: "This is a test message from webhook debug" }
            }]
          },
          field: "messages"
        }]
      }]
    };
    
    // Simulate webhook processing
    req.rawBody = Buffer.from(JSON.stringify(testPayload));
    req.headers = { "x-hub-signature-256": "test_signature" };
    
    const io = req.app.get("io");
    
    // Bypass signature verification for test
    const originalVerify = verifySignature;
    verifySignature = () => true;
    
    await handlePOST(req, res);
    
    // Restore original function
    verifySignature = originalVerify;
    
    res.json({
      success: true,
      message: "Test webhook processed",
      testPayload
    });
    
  } catch (error) {
    console.error("Test webhook error:", error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
};

// ===============================
// ROUTES
// ===============================

// Webhook endpoints
router.get("/meta", verifyGET);
router.post("/meta", 
  express.raw({ type: "application/json" }),
  (req, res, next) => {
    req.rawBody = req.body;
    next();
  },
  handlePOST
);

// Debug endpoints
router.get("/logs", getWebhookLogs);
router.post("/retry-failed", retryFailedMessages);
router.post("/test", testWebhook);

// Export helper functions for use in other files
module.exports = {
  router,
  verifyGET,
  handlePOST,
  updateChatSession,
  updateCampaignProgressForReply,
  processInboundMessage,
  processStatusUpdate,
  getWebhookLogs,
  retryFailedMessages,
  testWebhook
};