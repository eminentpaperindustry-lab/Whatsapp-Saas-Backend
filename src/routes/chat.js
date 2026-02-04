const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const multer = require("multer");
const fs = require("fs");
const path = require("path");

const MessageLog = require("../models/MessageLog");
const ChatSession = require("../models/ChatSession");
const Contact = require("../models/Contact");
const requireAuth = require("../middleware/auth");
const { 
  sendText, 
  sendImage, 
  sendVideo, 
  sendDocument,
  sendTemplate,
  sendChatMessage 
} = require("../services/whatsapp");

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = 'uploads/chat';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'video/mp4', 'video/mpeg', 'video/quicktime',
      'audio/mpeg', 'audio/mp3', 'audio/wav',
      'application/pdf', 'text/plain',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only images, videos, audio, and documents are allowed.'));
    }
  }
});

// ===============================
// HELPER FUNCTIONS
// ===============================

// Update chat session
async function updateChatSession(tenantId, phone, messageData) {
  try {
    const cleanedPhone = phone.replace("+", "").trim();
    
    // Find or create contact
    let contact = await Contact.findOne({ 
      tenantId, 
      phone: cleanedPhone 
    });
    
    if (!contact) {
      contact = await Contact.create({
        tenantId,
        phone: cleanedPhone,
        name: `Contact ${cleanedPhone}`,
        hasWhatsApp: true,
        lastInteraction: new Date(),
        createdAt: new Date()
      });
    } else {
      contact.lastInteraction = new Date();
      contact.hasWhatsApp = true;
      await contact.save();
    }

    // Prepare update data
    const updateData = {
      tenantId,
      phone: cleanedPhone,
      contactId: contact._id,
      lastMessage: messageData.body?.substring(0, 200) || messageData.type || '[Media]',
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

    // Update or create chat session
    const session = await ChatSession.findOneAndUpdate(
      { tenantId, phone: cleanedPhone },
      updateData,
      { 
        upsert: true, 
        new: true,
        setDefaultsOnInsert: true 
      }
    );

    return { session, contact };
  } catch (error) {
    console.error("Error updating chat session:", error);
    return null;
  }
}

// ===============================
// 1. GET ALL CHAT SESSIONS
// ===============================
router.get("/sessions", requireAuth, async (req, res) => {
  try {
    const tenantId = req.user?.tenantId || req.tenantId || process.env.DEFAULT_TENANT_ID;
    const { 
      page = 1, 
      limit = 50, 
      search = '', 
      filter = 'all',
      archived = 'false',
      sortBy = 'updatedAt',
      sortOrder = 'desc' 
    } = req.query;

    if (!tenantId) {
      return res.status(400).json({ 
        success: false, 
        error: "Tenant ID is required" 
      });
    }

    // Build query
    let query = { tenantId };
    
    // Search
    if (search && search.trim() !== '') {
      query.phone = { $regex: search.trim(), $options: 'i' };
    }
    
    // Filter
    if (filter === 'unread') {
      query.unreadCount = { $gt: 0 };
    } else if (filter === 'replied') {
      query.hasReplied = true;
    } else if (filter === 'not_replied') {
      query.hasReplied = false;
    }
    
    // Archived
    if (archived === 'true') {
      query.isArchived = true;
    } else {
      query.isArchived = false;
    }

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sort = { [sortBy]: sortOrder === 'asc' ? 1 : -1 };

    // Get sessions
    const sessions = await ChatSession.find(query)
      .populate('contactId', 'name phone tags')
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    // Get counts
    const totalSessions = await ChatSession.countDocuments(query);
    const unreadSessions = await ChatSession.countDocuments({ ...query, unreadCount: { $gt: 0 } });
    const repliedSessions = await ChatSession.countDocuments({ ...query, hasReplied: true });

    // Get unread count for each session
    const sessionsWithCounts = await Promise.all(sessions.map(async (session) => {
      const unreadCount = await MessageLog.countDocuments({
        tenantId,
        $or: [
          { from: session.phone, direction: 'inbound' },
          { to: session.phone, direction: 'outbound' }
        ],
        status: { $in: ['sent', 'delivered', 'read'] }
      });
      
      return {
        ...session,
        actualUnreadCount: unreadCount
      };
    }));

    res.json({
      success: true,
      sessions: sessionsWithCounts,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalSessions,
        pages: Math.ceil(totalSessions / parseInt(limit))
      },
      stats: {
        total: totalSessions,
        unread: unreadSessions,
        replied: repliedSessions,
        notReplied: totalSessions - repliedSessions,
        archived: await ChatSession.countDocuments({ tenantId, isArchived: true })
      }
    });

  } catch (error) {
    console.error("Get sessions error:", error);
    res.status(500).json({ 
      success: false, 
      error: "Failed to fetch chat sessions" 
    });
  }
});

// ===============================
// 2. GET SINGLE CHAT SESSION
// ===============================
router.get("/sessions/:phone", requireAuth, async (req, res) => {
  try {
    const tenantId = req.user?.tenantId || req.tenantId || process.env.DEFAULT_TENANT_ID;
    const phone = req.params.phone.replace("+", "").trim();

    if (!tenantId) {
      return res.status(400).json({ 
        success: false, 
        error: "Tenant ID is required" 
      });
    }

    // Get chat session
    const session = await ChatSession.findOne({ tenantId, phone })
      .populate('contactId')
      .lean();

    if (!session) {
      return res.json({
        success: true,
        session: null,
        messages: [],
        contact: null
      });
    }

    // Get messages (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const messages = await MessageLog.find({
      tenantId,
      $or: [
        { from: phone, to: { $ne: null } },
        { to: phone, from: { $ne: null } }
      ],
      timestamp: { $gte: sevenDaysAgo }
    })
    .sort({ timestamp: 1 })
    .limit(200)
    .lean();

    // Mark as read
    if (session.unreadCount > 0) {
      await ChatSession.updateOne(
        { tenantId, phone },
        { $set: { unreadCount: 0 } }
      );
    }

    // Get contact campaigns
    const CampaignProgress = require('../models/CampaignProgress');
    const campaigns = await CampaignProgress.find({
      tenantId,
      contactId: session.contactId
    })
    .populate('campaignId', 'name type status')
    .limit(5)
    .lean();

    res.json({
      success: true,
      session: {
        ...session,
        unreadCount: 0
      },
      messages,
      contact: session.contactId,
      campaigns: campaigns || []
    });

  } catch (error) {
    console.error("Get session error:", error);
    res.status(500).json({ 
      success: false, 
      error: "Failed to fetch chat session" 
    });
  }
});

// ===============================
// 3. SEND MESSAGE (TEXT/MEDIA/TEMPLATE)
// ===============================
router.post("/sessions/:phone/messages", 
  requireAuth, 
  upload.single("media"),
  async (req, res) => {
    try {
      const tenantId = req.user?.tenantId || req.tenantId || process.env.DEFAULT_TENANT_ID;
      const phone = req.params.phone.replace("+", "").trim();
      const { 
        message = '', 
        type = 'text', 
        templateName,
        templateLanguage = 'en_US',
        templateVariables 
      } = req.body;

      const mediaFile = req.file;

      if (!tenantId) {
        return res.status(400).json({ 
          success: false, 
          error: "Tenant ID is required" 
        });
      }

      if (!message && !mediaFile && !templateName) {
        return res.status(400).json({ 
          success: false, 
          error: "Message text, media file, or template is required" 
        });
      }

      let whatsappResponse;
      let messageType = type;
      let providerMessageId = null;

      // Determine message type and send
      if (templateName) {
        // Send template message
        whatsappResponse = await sendTemplate({
          to: `91${phone}`,
          templateName,
          language: templateLanguage,
          dynamicParams: templateVariables ? JSON.parse(templateVariables) : []
        });
        messageType = 'template';
        providerMessageId = whatsappResponse?.messages?.[0]?.id;

      } else if (mediaFile) {
        // For production: Upload to cloud storage
        // For local testing, save locally
        const mediaUrl = `${req.protocol}://${req.get('host')}/uploads/chat/${mediaFile.filename}`;
        
        const mimeType = mediaFile.mimetype;
        if (mimeType.startsWith('image/')) {
          whatsappResponse = await sendImage({
            to: `91${phone}`,
            imageUrl: mediaUrl,
            caption: message
          });
          messageType = 'image';
        } else if (mimeType.startsWith('video/')) {
          whatsappResponse = await sendVideo({
            to: `91${phone}`,
            videoUrl: mediaUrl,
            caption: message
          });
          messageType = 'video';
        } else if (mimeType.startsWith('audio/')) {
          whatsappResponse = await sendChatMessage({
            to: `91${phone}`,
            body: message,
            type: 'audio',
            mediaUrl: mediaUrl
          });
          messageType = 'audio';
        } else {
          whatsappResponse = await sendDocument({
            to: `91${phone}`,
            documentUrl: mediaUrl,
            filename: mediaFile.originalname,
            caption: message
          });
          messageType = 'document';
        }
        providerMessageId = whatsappResponse?.messages?.[0]?.id;

      } else {
        // Send text message
        whatsappResponse = await sendText({
          to: `91${phone}`,
          body: message
        });
        messageType = 'text';
        providerMessageId = whatsappResponse?.messages?.[0]?.id;
      }

      // Save message log
      const messageLog = await MessageLog.create({
        tenantId,
        from: process.env.BUSINESS_PHONE_NUMBER || "business",
        to: phone,
        body: message || (templateName ? `Template: ${templateName}` : '[Media]'),
        type: messageType,
        direction: "outbound",
        status: "sent",
        provider: "meta",
        provider_message_id: providerMessageId,
        templateName: templateName || null,
        language: templateLanguage || null,
        mediaUrl: mediaFile ? `/uploads/chat/${mediaFile.filename}` : null,
        timestamp: new Date(),
        sentAt: new Date(),
        payload: whatsappResponse
      });

      // Update chat session
      await updateChatSession(tenantId, phone, {
        body: message || (templateName ? `Template: ${templateName}` : '[Media]'),
        type: messageType,
        direction: 'outbound',
        status: 'sent'
      });

      // Socket emit
      const io = req.app.get("io");
      if (io) {
        io.to(`tenant_${tenantId}`).emit("message:new", messageLog);
        io.to(`tenant_${tenantId}`).emit("session:updated", {
          phone,
          lastMessage: message || (templateName ? `Template: ${templateName}` : '[Media]'),
          lastDirection: 'outbound',
          lastStatus: 'sent',
          updatedAt: new Date()
        });
      }

      res.json({
        success: true,
        message: "Message sent successfully",
        data: messageLog,
        whatsappResponse
      });

    } catch (error) {
      console.error("Send message error:", error);
      
      // Save failed message
      if (req.tenantId && req.params.phone) {
        await MessageLog.create({
          tenantId: req.tenantId,
          from: process.env.BUSINESS_PHONE_NUMBER || "business",
          to: req.params.phone.replace("+", "").trim(),
          body: req.body.message || '',
          type: req.body.type || 'text',
          direction: 'outbound',
          status: 'failed',
          provider: 'meta',
          error: error.message,
          timestamp: new Date(),
          payload: error.response?.data
        });
      }

      res.status(500).json({
        success: false,
        error: error.response?.data?.error?.message || error.message
      });
    }
  }
);

// ===============================
// 4. GET MESSAGE HISTORY
// ===============================
router.get("/sessions/:phone/messages", requireAuth, async (req, res) => {
  try {
    const tenantId = req.user?.tenantId || req.tenantId || process.env.DEFAULT_TENANT_ID;
    const phone = req.params.phone.replace("+", "").trim();
    const { 
      limit = 100, 
      offset = 0,
      startDate,
      endDate,
      type,
      direction 
    } = req.query;

    if (!tenantId) {
      return res.status(400).json({ 
        success: false, 
        error: "Tenant ID is required" 
      });
    }

    // Build query
    const query = {
      tenantId,
      $or: [
        { from: phone, to: { $ne: null } },
        { to: phone, from: { $ne: null } }
      ]
    };

    // Date filter
    if (startDate || endDate) {
      query.timestamp = {};
      if (startDate) query.timestamp.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.timestamp.$lte = end;
      }
    }

    // Type filter
    if (type && type !== 'all') {
      query.type = type;
    }

    // Direction filter
    if (direction && direction !== 'all') {
      query.direction = direction;
    }

    // Get messages
    const messages = await MessageLog.find(query)
      .sort({ timestamp: -1 })
      .skip(parseInt(offset))
      .limit(parseInt(limit))
      .lean();

    const totalMessages = await MessageLog.countDocuments(query);

    res.json({
      success: true,
      messages: messages.reverse(),
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        total: totalMessages,
        hasMore: (parseInt(offset) + messages.length) < totalMessages
      }
    });

  } catch (error) {
    console.error("Get messages error:", error);
    res.status(500).json({ 
      success: false, 
      error: "Failed to fetch messages" 
    });
  }
});

// ===============================
// 5. UPDATE CHAT SESSION
// ===============================
router.patch("/sessions/:phone", requireAuth, async (req, res) => {
  try {
    const tenantId = req.user?.tenantId || req.tenantId || process.env.DEFAULT_TENANT_ID;
    const phone = req.params.phone.replace("+", "").trim();
    const updateData = req.body;

    if (!tenantId) {
      return res.status(400).json({ 
        success: false, 
        error: "Tenant ID is required" 
      });
    }

    const session = await ChatSession.findOneAndUpdate(
      { tenantId, phone },
      { $set: updateData },
      { new: true }
    ).populate('contactId');

    if (!session) {
      return res.status(404).json({ 
        success: false, 
        error: "Chat session not found" 
      });
    }

    // Socket emit
    const io = req.app.get("io");
    if (io) {
      io.to(`tenant_${tenantId}`).emit("session:updated", session);
    }

    res.json({
      success: true,
      message: "Session updated successfully",
      session
    });

  } catch (error) {
    console.error("Update session error:", error);
    res.status(500).json({ 
      success: false, 
      error: "Failed to update chat session" 
    });
  }
});

// ===============================
// 6. DELETE CHAT SESSION
// ===============================
router.delete("/sessions/:phone", requireAuth, async (req, res) => {
  try {
    const tenantId = req.user?.tenantId || req.tenantId || process.env.DEFAULT_TENANT_ID;
    const phone = req.params.phone.replace("+", "").trim();

    if (!tenantId) {
      return res.status(400).json({ 
        success: false, 
        error: "Tenant ID is required" 
      });
    }

    const session = await ChatSession.findOneAndDelete({ tenantId, phone });

    if (!session) {
      return res.status(404).json({ 
        success: false, 
        error: "Chat session not found" 
      });
    }

    // Socket emit
    const io = req.app.get("io");
    if (io) {
      io.to(`tenant_${tenantId}`).emit("session:deleted", { phone });
    }

    res.json({
      success: true,
      message: "Chat session deleted successfully"
    });

  } catch (error) {
    console.error("Delete session error:", error);
    res.status(500).json({ 
      success: false, 
      error: "Failed to delete chat session" 
    });
  }
});

// ===============================
// 7. MARK ALL AS READ
// ===============================
router.post("/sessions/mark-all-read", requireAuth, async (req, res) => {
  try {
    const tenantId = req.user?.tenantId || req.tenantId || process.env.DEFAULT_TENANT_ID;

    if (!tenantId) {
      return res.status(400).json({ 
        success: false, 
        error: "Tenant ID is required" 
      });
    }

    const result = await ChatSession.updateMany(
      { tenantId, unreadCount: { $gt: 0 } },
      { $set: { unreadCount: 0 } }
    );

    // Socket emit
    const io = req.app.get("io");
    if (io) {
      io.to(`tenant_${tenantId}`).emit("sessions:marked_read", {
        modifiedCount: result.modifiedCount
      });
    }

    res.json({
      success: true,
      message: `Marked ${result.modifiedCount} sessions as read`,
      modifiedCount: result.modifiedCount
    });

  } catch (error) {
    console.error("Mark all read error:", error);
    res.status(500).json({ 
      success: false, 
      error: "Failed to mark sessions as read" 
    });
  }
});

// ===============================
// 8. BULK ACTIONS
// ===============================
router.post("/sessions/bulk/action", requireAuth, async (req, res) => {
  try {
    const tenantId = req.user?.tenantId || req.tenantId || process.env.DEFAULT_TENANT_ID;
    const { action, phones = [] } = req.body;

    if (!tenantId) {
      return res.status(400).json({ 
        success: false, 
        error: "Tenant ID is required" 
      });
    }

    if (!action || !Array.isArray(phones) || phones.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: "Action and phones array are required" 
      });
    }

    let updateQuery = {};
    
    switch (action) {
      case 'archive':
        updateQuery = { isArchived: true };
        break;
      case 'unarchive':
        updateQuery = { isArchived: false };
        break;
      case 'mark_read':
        updateQuery = { unreadCount: 0 };
        break;
      case 'mark_unread':
        updateQuery = { unreadCount: 1 };
        break;
      default:
        return res.status(400).json({ 
          success: false, 
          error: "Invalid action" 
        });
    }

    const result = await ChatSession.updateMany(
      { tenantId, phone: { $in: phones } },
      { $set: updateQuery }
    );

    // Socket emit
    const io = req.app.get("io");
    if (io) {
      phones.forEach(phone => {
        io.to(`tenant_${tenantId}`).emit("session:updated", {
          phone,
          ...updateQuery,
          updatedAt: new Date()
        });
      });
    }

    res.json({
      success: true,
      message: `${result.modifiedCount} sessions updated`,
      modifiedCount: result.modifiedCount
    });

  } catch (error) {
    console.error("Bulk action error:", error);
    res.status(500).json({ 
      success: false, 
      error: "Failed to perform bulk action" 
    });
  }
});

// ===============================
// 9. SEARCH MESSAGES
// ===============================
router.get("/search/messages", requireAuth, async (req, res) => {
  try {
    const tenantId = req.user?.tenantId || req.tenantId || process.env.DEFAULT_TENANT_ID;
    const { query, phone, limit = 50 } = req.query;

    if (!tenantId) {
      return res.status(400).json({ 
        success: false, 
        error: "Tenant ID is required" 
      });
    }

    if (!query || query.trim() === '') {
      return res.status(400).json({ 
        success: false, 
        error: "Search query is required" 
      });
    }

    let searchQuery = {
      tenantId,
      $or: [
        { body: { $regex: query.trim(), $options: 'i' } },
        { from: { $regex: query.trim(), $options: 'i' } },
        { to: { $regex: query.trim(), $options: 'i' } }
      ]
    };

    if (phone && phone.trim() !== '') {
      searchQuery.$or = [
        { from: phone.trim() },
        { to: phone.trim() }
      ];
    }

    const messages = await MessageLog.find(searchQuery)
      .sort({ timestamp: -1 })
      .limit(parseInt(limit))
      .lean();

    res.json({
      success: true,
      messages,
      count: messages.length
    });

  } catch (error) {
    console.error("Search messages error:", error);
    res.status(500).json({ 
      success: false, 
      error: "Failed to search messages" 
    });
  }
});

// ===============================
// 10. CHAT STATISTICS
// ===============================
router.get("/stats/summary", requireAuth, async (req, res) => {
  try {
    const tenantId = req.user?.tenantId || req.tenantId || process.env.DEFAULT_TENANT_ID;
    const { startDate, endDate } = req.query;

    if (!tenantId) {
      return res.status(400).json({ 
        success: false, 
        error: "Tenant ID is required" 
      });
    }

    let dateFilter = {};
    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      
      dateFilter = {
        lastInteraction: {
          $gte: start,
          $lte: end
        }
      };
    }

    // Session statistics
    const sessionStats = await ChatSession.aggregate([
      {
        $match: {
          tenantId: new mongoose.Types.ObjectId(tenantId),
          isArchived: false,
          ...dateFilter
        }
      },
      {
        $group: {
          _id: null,
          totalSessions: { $sum: 1 },
          totalMessages: { $sum: "$messageCount" },
          totalUnread: { $sum: "$unreadCount" },
          repliedCount: {
            $sum: { $cond: ["$hasReplied", 1, 0] }
          }
        }
      }
    ]);

    // Message statistics (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const messageStats = await MessageLog.aggregate([
      {
        $match: {
          tenantId: new mongoose.Types.ObjectId(tenantId),
          timestamp: { $gte: thirtyDaysAgo }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { 
              format: "%Y-%m-%d", 
              date: "$timestamp" 
            }
          },
          inbound: {
            $sum: { $cond: [{ $eq: ["$direction", "inbound"] }, 1, 0] }
          },
          outbound: {
            $sum: { $cond: [{ $eq: ["$direction", "outbound"] }, 1, 0] }
          },
          total: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } },
      { $limit: 30 }
    ]);

    // Response time statistics
    const responseStats = await MessageLog.aggregate([
      {
        $match: {
          tenantId: new mongoose.Types.ObjectId(tenantId),
          direction: "inbound",
          timestamp: { $gte: thirtyDaysAgo }
        }
      },
      {
        $lookup: {
          from: "messagelogs",
          let: { fromPhone: "$from", inboundTime: "$timestamp" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$to", "$$fromPhone"] },
                    { $eq: ["$direction", "outbound"] },
                    { $gt: ["$timestamp", "$$inboundTime"] }
                  ]
                }
              }
            },
            { $sort: { timestamp: 1 } },
            { $limit: 1 }
          ],
          as: "response"
        }
      },
      {
        $addFields: {
          responseTime: {
            $cond: [
              { $gt: [{ $size: "$response" }, 0] },
              {
                $divide: [
                  { $subtract: ["$response.timestamp", "$timestamp"] },
                  60000 // Convert to minutes
                ]
              },
              null
            ]
          }
        }
      },
      {
        $group: {
          _id: null,
          avgResponseTime: { $avg: "$responseTime" },
          minResponseTime: { $min: "$responseTime" },
          maxResponseTime: { $max: "$responseTime" },
          totalInbound: { $sum: 1 },
          respondedCount: {
            $sum: {
              $cond: [{ $gt: [{ $size: "$response" }, 0] }, 1, 0]
            }
          }
        }
      }
    ]);

    res.json({
      success: true,
      summary: sessionStats[0] || {
        totalSessions: 0,
        totalMessages: 0,
        totalUnread: 0,
        repliedCount: 0,
        notRepliedCount: 0
      },
      dailyMessages: messageStats,
      responseStats: responseStats[0] || {
        avgResponseTime: 0,
        minResponseTime: 0,
        maxResponseTime: 0,
        totalInbound: 0,
        respondedCount: 0
      },
      timeframe: {
        startDate: startDate || thirtyDaysAgo.toISOString(),
        endDate: endDate || new Date().toISOString()
      }
    });

  } catch (error) {
    console.error("Chat stats error:", error);
    res.status(500).json({ 
      success: false, 
      error: "Failed to fetch chat statistics" 
    });
  }
});

// ===============================
// 11. EXPORT CHAT
// ===============================
router.get("/sessions/:phone/export", requireAuth, async (req, res) => {
  try {
    const tenantId = req.user?.tenantId || req.tenantId || process.env.DEFAULT_TENANT_ID;
    const phone = req.params.phone.replace("+", "").trim();
    const { format = 'json' } = req.query;

    if (!tenantId) {
      return res.status(400).json({ 
        success: false, 
        error: "Tenant ID is required" 
      });
    }

    // Get all messages
    const messages = await MessageLog.find({
      tenantId,
      $or: [
        { from: phone, to: { $ne: null } },
        { to: phone, from: { $ne: null } }
      ]
    })
    .sort({ timestamp: 1 })
    .lean();

    // Get session info
    const session = await ChatSession.findOne({
      tenantId,
      phone
    })
    .populate('contactId')
    .lean();

    if (format === 'csv') {
      // Convert to CSV
      const csvHeaders = ['Date', 'Time', 'Direction', 'Type', 'Message', 'Status'];
      const csvRows = messages.map(msg => [
        new Date(msg.timestamp).toLocaleDateString('en-IN'),
        new Date(msg.timestamp).toLocaleTimeString('en-IN'),
        msg.direction,
        msg.type,
        msg.body?.replace(/,/g, ';') || '',
        msg.status
      ]);

      const csvContent = [
        csvHeaders.join(','),
        ...csvRows.map(row => row.join(','))
      ].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=chat_${phone}_${Date.now()}.csv`);
      res.send(csvContent);

    } else {
      // Return JSON
      res.json({
        success: true,
        session: session || {},
        contact: session?.contactId || null,
        messages: messages,
        exportInfo: {
          exportedAt: new Date(),
          totalMessages: messages.length,
          dateRange: messages.length > 0 ? {
            start: messages[0].timestamp,
            end: messages[messages.length - 1].timestamp
          } : null
        }
      });
    }

  } catch (error) {
    console.error("Export error:", error);
    res.status(500).json({ 
      success: false, 
      error: "Failed to export chat" 
    });
  }
});

// ===============================
// 12. GET UNREAD COUNT
// ===============================
router.get("/stats/unread", requireAuth, async (req, res) => {
  try {
    const tenantId = req.user?.tenantId || req.tenantId || process.env.DEFAULT_TENANT_ID;

    if (!tenantId) {
      return res.status(400).json({ 
        success: false, 
        error: "Tenant ID is required" 
      });
    }

    const totalUnread = await ChatSession.aggregate([
      { $match: { tenantId: new mongoose.Types.ObjectId(tenantId), isArchived: false } },
      { $group: { _id: null, total: { $sum: "$unreadCount" } } }
    ]);

    const unreadSessions = await ChatSession.countDocuments({
      tenantId,
      unreadCount: { $gt: 0 },
      isArchived: false
    });

    res.json({
      success: true,
      totalUnread: totalUnread[0]?.total || 0,
      unreadSessions: unreadSessions,
      lastUpdated: new Date()
    });

  } catch (error) {
    console.error("Unread stats error:", error);
    res.status(500).json({ 
      success: false, 
      error: "Failed to get unread stats" 
    });
  }
});

module.exports = router;