const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const multer = require("multer");

const MessageLog = require("../models/MessageLog");
const ChatSession = require("../models/ChatSession"); // ✅ Updated name
const Contact = require("../models/Contact");
const requireAuth = require("../middleware/auth");
const { sendText, sendMedia } = require("../services/whatsapp");

const upload = multer({ storage: multer.memoryStorage() });

// ===============================
// HELPER: Update Chat Session
// ===============================
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

    // If inbound message, increase unread count
    if (messageData.direction === 'inbound') {
      updateData.$inc.unreadCount = 1;
      updateData.hasReplied = true;
    } else {
      // For outbound, reset unread count
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

    // Update contact if exists
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

// ===============================
// 1) GET ALL CHAT SESSIONS
// ===============================
router.get("/sessions", requireAuth, async (req, res) => {
  try {
    const tenantId = req.user?.tenantId || req.tenantId;
    const { 
      search, 
      filter, 
      archived, 
      page = 1, 
      limit = 50 
    } = req.query;
    
    if (!tenantId) {
      return res.status(401).json({ error: "Missing tenantId" });
    }

    // Build query
    let query = { tenantId };
    
    if (search && search.trim() !== '') {
      query.phone = { $regex: search.trim(), $options: 'i' };
    }
    
    if (filter === 'unread') {
      query.unreadCount = { $gt: 0 };
    }
    
    if (filter === 'replied') {
      query.hasReplied = true;
    }
    
    if (filter === 'not_replied') {
      query.hasReplied = false;
    }
    
    if (archived === 'true') {
      query.isArchived = true;
    } else {
      query.isArchived = false;
    }

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Get sessions with pagination
    const sessions = await ChatSession.find(query)
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    // Get total counts
    const totalSessions = await ChatSession.countDocuments({ 
      tenantId, 
      isArchived: false 
    });
    
    const unreadSessions = await ChatSession.countDocuments({ 
      tenantId, 
      unreadCount: { $gt: 0 },
      isArchived: false 
    });
    
    const repliedSessions = await ChatSession.countDocuments({ 
      tenantId, 
      hasReplied: true,
      isArchived: false 
    });

    res.json({
      sessions,
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
        notReplied: totalSessions - repliedSessions
      }
    });
  } catch (err) {
    console.error("❌ Chat sessions error:", err);
    res.status(500).json({ error: "Failed to fetch chat sessions" });
  }
});

// ===============================
// 2) GET SINGLE CHAT SESSION
// ===============================
router.get("/sessions/:phone", requireAuth, async (req, res) => {
  try {
    const tenantId = req.user?.tenantId || req.tenantId;
    const phone = req.params.phone;

    if (!tenantId) {
      return res.status(401).json({ error: "Missing tenantId" });
    }

    // Get chat session
    const session = await ChatSession.findOne({
      tenantId,
      phone
    }).lean();

    if (!session) {
      return res.status(404).json({ 
        error: "Chat session not found",
        session: null,
        messages: [],
        contact: null
      });
    }

    // Get messages
    const messages = await MessageLog.find({
      tenantId,
      $or: [{ from: phone }, { to: phone }],
    })
      .sort({ timestamp: 1 })
      .limit(500)
      .lean();

    // Mark as read
    await ChatSession.updateOne(
      { tenantId, phone },
      { $set: { unreadCount: 0 } }
    );

    // Get contact details if exists
    const contact = await Contact.findOne({
      tenantId,
      phone
    }).lean();

    res.json({
      session: {
        ...session,
        unreadCount: 0
      },
      messages,
      contact
    });
  } catch (err) {
    console.error("❌ Chat session error:", err);
    res.status(500).json({ error: "Failed to fetch chat session" });
  }
});

// ===============================
// 3) SEND MESSAGE
// ===============================
router.post(
  "/sessions/:phone/messages",
  requireAuth,
  upload.single("media"),
  async (req, res) => {
    try {
      const tenantId = req.user?.tenantId || req.tenantId;
      const phone = req.params.phone;
      const message = req.body?.message?.trim() || "";
      const media = req.file;

      if (!tenantId) {
        return res.status(401).json({ error: "Missing tenantId" });
      }

      if (!message && !media) {
        return res.status(400).json({
          error: "Text or media is required",
        });
      }

      let response;
      let type = "text";

      // Clean phone number
      const cleanedPhone = phone.replace("+", "").trim();

      // Send message
      if (media) {
        type = media.mimetype.startsWith("image")
          ? "image"
          : media.mimetype.startsWith("video")
          ? "video"
          : "file";

        response = await sendMedia({
          to: cleanedPhone,
          buffer: media.buffer,
          mimetype: media.mimetype,
          caption: message || "",
        });
      } else {
        response = await sendText({
          to: cleanedPhone,
          body: message,
        });
      }

      // Save message log
      const log = await MessageLog.create({
        tenantId,
        from: process.env.BUSINESS_PHONE_NUMBER || "business",
        to: phone,
        message,
        type,
        direction: "outbound",
        status: "sent",
        provider: "meta",
        provider_message_id: response?.messages?.[0]?.id || null,
        payload: response,
        timestamp: new Date(),
      });

      // Update chat session
      await updateChatSession(tenantId, phone, {
        message,
        type,
        direction: 'outbound',
        status: 'sent'
      });

      // Socket emit
      const io = req.app.get("io");
      if (io) {
        io.to(`tenant_${tenantId}`).emit("message:new", log);
        io.to(`tenant_${tenantId}`).emit("session:updated", {
          phone,
          lastMessage: message,
          lastDirection: 'outbound',
          lastStatus: 'sent',
          updatedAt: new Date()
        });
      }

      res.json({ 
        success: true, 
        message: log,
        messageId: response?.messages?.[0]?.id 
      });
    } catch (err) {
      console.error("❌ Send message error:", err.response?.data || err);
      res.status(500).json({ 
        error: "Failed to send message",
        details: err.response?.data?.error?.message || err.message 
      });
    }
  }
);

// ===============================
// 4) UPDATE CHAT SESSION (archive, tags, notes)
// ===============================
router.patch("/sessions/:phone", requireAuth, async (req, res) => {
  try {
    const tenantId = req.user?.tenantId || req.tenantId;
    const phone = req.params.phone;
    const updateData = req.body;

    if (!tenantId) {
      return res.status(401).json({ error: "Missing tenantId" });
    }

    const session = await ChatSession.findOneAndUpdate(
      { tenantId, phone },
      { $set: updateData },
      { new: true }
    );

    if (!session) {
      return res.status(404).json({ error: "Chat session not found" });
    }

    // Socket emit
    const io = req.app.get("io");
    if (io) {
      io.to(`tenant_${tenantId}`).emit("session:updated", session);
    }

    res.json({ 
      success: true, 
      session 
    });
  } catch (err) {
    console.error("❌ Update session error:", err);
    res.status(500).json({ error: "Failed to update chat session" });
  }
});

// ===============================
// 5) DELETE CHAT SESSION
// ===============================
router.delete("/sessions/:phone", requireAuth, async (req, res) => {
  try {
    const tenantId = req.user?.tenantId || req.tenantId;
    const phone = req.params.phone;

    if (!tenantId) {
      return res.status(401).json({ error: "Missing tenantId" });
    }

    const session = await ChatSession.findOneAndDelete({
      tenantId,
      phone
    });

    if (!session) {
      return res.status(404).json({ error: "Chat session not found" });
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
  } catch (err) {
    console.error("❌ Delete session error:", err);
    res.status(500).json({ error: "Failed to delete chat session" });
  }
});

// ===============================
// 6) BULK ACTIONS
// ===============================
router.post("/sessions/bulk/action", requireAuth, async (req, res) => {
  try {
    const tenantId = req.user?.tenantId || req.tenantId;
    const { action, phones = [] } = req.body;

    if (!tenantId) {
      return res.status(401).json({ error: "Missing tenantId" });
    }

    if (!action || !Array.isArray(phones) || phones.length === 0) {
      return res.status(400).json({ 
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
        return res.status(400).json({ error: "Invalid action" });
    }

    const result = await ChatSession.updateMany(
      { 
        tenantId, 
        phone: { $in: phones } 
      },
      { $set: updateQuery }
    );

    // Socket emit for each session
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
  } catch (err) {
    console.error("❌ Bulk action error:", err);
    res.status(500).json({ error: "Failed to perform bulk action" });
  }
});

// ===============================
// 7) GET CHAT STATISTICS
// ===============================
router.get("/stats/summary", requireAuth, async (req, res) => {
  try {
    const tenantId = req.user?.tenantId || req.tenantId;
    const { startDate, endDate } = req.query;

    if (!tenantId) {
      return res.status(401).json({ error: "Missing tenantId" });
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

    // Hourly activity (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const hourlyStats = await MessageLog.aggregate([
      {
        $match: {
          tenantId: new mongoose.Types.ObjectId(tenantId),
          timestamp: { $gte: sevenDaysAgo }
        }
      },
      {
        $group: {
          _id: {
            hour: { $hour: "$timestamp" },
            dayOfWeek: { $dayOfWeek: "$timestamp" }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { "_id.dayOfWeek": 1, "_id.hour": 1 } }
    ]);

    res.json({
      summary: sessionStats[0] || {
        totalSessions: 0,
        totalMessages: 0,
        totalUnread: 0,
        repliedCount: 0,
        notRepliedCount: 0
      },
      dailyMessages: messageStats,
      hourlyActivity: hourlyStats,
      timeframe: {
        startDate: startDate || thirtyDaysAgo.toISOString(),
        endDate: endDate || new Date().toISOString()
      }
    });
  } catch (err) {
    console.error("❌ Stats error:", err);
    res.status(500).json({ error: "Failed to fetch statistics" });
  }
});

// ===============================
// 8) SEARCH MESSAGES
// ===============================
router.get("/search/messages", requireAuth, async (req, res) => {
  try {
    const tenantId = req.user?.tenantId || req.tenantId;
    const { query, phone, limit = 50 } = req.query;

    if (!tenantId) {
      return res.status(401).json({ error: "Missing tenantId" });
    }

    if (!query || query.trim() === '') {
      return res.status(400).json({ error: "Search query is required" });
    }

    let matchQuery = {
      tenantId,
      message: { $regex: query.trim(), $options: 'i' }
    };

    if (phone && phone.trim() !== '') {
      matchQuery.$or = [
        { from: phone.trim() },
        { to: phone.trim() }
      ];
    }

    const messages = await MessageLog.find(matchQuery)
      .sort({ timestamp: -1 })
      .limit(parseInt(limit))
      .lean();

    res.json({
      success: true,
      count: messages.length,
      messages
    });
  } catch (err) {
    console.error("❌ Search messages error:", err);
    res.status(500).json({ error: "Failed to search messages" });
  }
});

module.exports = router;