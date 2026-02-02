// server.js
require("dotenv").config();
process.env.TZ = 'Asia/Kolkata';
console.log('🕐 Server Timezone:', Intl.DateTimeFormat().resolvedOptions().timeZone);
console.log('📅 Server Time:', new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }));
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const morgan = require("morgan");
const helmet = require("helmet");
const path = require("path");
const fs = require("fs");

// MongoDB connection
const connectDB = require("./config/db");

// Routes
const authRoutes = require("./routes/auth");
const usersRoutes = require("./routes/users");
const contactsRoutes = require("./routes/contacts");
const templatesRoutes = require("./routes/templates");
const campaignsRoutes = require("./routes/campaigns");
const mediaRoutes = require("./routes/media");
const webhooksRoutes = require("./routes/webhooks");
const analyticsRoutes = require("./routes/analytics");
const chatRoutes = require("./routes/chat");
const sectionsRouter = require('./routes/sections');

// Campaign Scheduler (IMPORTANT: Add this line)
// const campaignScheduler = require('./services/campaignScheduler');

const app = express();
const server = http.createServer(app);

// =======================
// SOCKET.IO
// =======================
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

app.set("io", io);

io.on("connection", (socket) => {
  console.log("✅ Socket connected:", socket.id);

  socket.on("joinTenant", (tenantId) => {
    if (!tenantId) return;
    socket.join(`tenant_${tenantId}`);
    console.log(`✅ Socket ${socket.id} joined tenant_${tenantId}`);
  });

  socket.on("disconnect", () => {
    console.log("❌ Socket disconnected:", socket.id);
  });
});

// =======================
// MIDDLEWARES
// =======================
app.use(helmet());
app.use(cors());
app.use(morgan("dev"));
app.use(express.json());

// Ensure uploads folder exists
const uploadsDir = path.join(__dirname, "uploads");
fs.mkdirSync(uploadsDir, { recursive: true });

// =======================
// CONNECT DATABASE
// =======================
connectDB(process.env.MONGO_URI);

// =======================
// WEBHOOK ROUTES
// =======================

// GET webhook (Meta verification)
app.get("/api/webhooks/meta", webhooksRoutes.verifyGET);

// POST webhook (Meta messages)
app.post(
  "/api/webhooks/meta",
  express.raw({ type: "application/json" }),
  (req, res, next) => {
    req.rawBody = req.body;
    next();
  },
  webhooksRoutes.handlePOST
);

// =======================
// OTHER ROUTES
// =======================
app.use("/api/auth", authRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/contacts", contactsRoutes);
app.use("/api/templates", templatesRoutes);
app.use("/api/campaigns", campaignsRoutes);
app.use("/api/media", mediaRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/chat", chatRoutes);
app.use('/api/sections', sectionsRouter);
app.use('/api/debug', require('./routes/test-templates'));

// =======================
// HEALTH CHECK
// =======================
app.get("/api/health", (req, res) => {
  res.json({ ok: true, message: "Server running" });
});

// =======================
// START SERVER
// =======================
const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    // Start the server
    server.listen(PORT, () => {
      console.log(`✅ Server running on port ${PORT}`);
    });

    // Initialize campaign scheduler after server starts
    setTimeout(async () => {
      try {
        await campaignScheduler.init();
        console.log("✅ Campaign Scheduler initialized successfully");
      } catch (error) {
        console.error("❌ Failed to initialize Campaign Scheduler:", error);
      }
    }, 3000); // Wait 3 seconds for server to fully start

  } catch (error) {
    console.error("❌ Failed to start server:", error);
    process.exit(1);
  }
};

// Start the server
startServer();

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  
  // Stop all scheduled campaigns
  console.log('Stopping campaign scheduler...');
  
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('SIGINT received. Shutting down gracefully...');
  
  // Stop all scheduled campaigns
  console.log('Stopping campaign scheduler...');
  
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});


// server.js या app.js में
const campaignScheduler = require('./services/campaignScheduler');

// Server start करते ही scheduler initialize करें
campaignScheduler.init();

// Debug endpoint add करें
app.get('/debug/scheduler', (req, res) => {
  campaignScheduler.listScheduledJobs();
  res.json({ message: 'Scheduler debug info logged to console' });
});

app.get('/debug/trigger-now/:campaignId', async (req, res) => {
  try {
    await campaignScheduler.executeCampaignStep(req.params.campaignId, req.query.stepId);
    res.json({ message: 'Manual trigger executed' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// const webhooksRoutes = require("./routes/webhooks");
app.use("/api/webhooks", webhooksRoutes.router);
// Export for testing
module.exports = { app, server };