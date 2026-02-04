require("dotenv").config();

// Force Indian timezone for consistent scheduling
process.env.TZ = 'Asia/Kolkata';

console.log('\n' + '='.repeat(60));
console.log('🚀 WHATSAPP CAMPAIGN SERVER - AUTONOMOUS MODE');
console.log('='.repeat(60));
console.log(`🕐 Server Timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
console.log(`📅 Server Time: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
console.log('='.repeat(60));

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const morgan = require("morgan");
const helmet = require("helmet");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const mongoose = require("mongoose");
const path = require("path");
const fs = require("fs");

// Import autonomous services
const campaignScheduler = require('./services/campaignScheduler');
const campaignProcessor = require('./services/campaignProcessor');
const logger = require('./utils/logger');

const app = express();
const server = http.createServer(app);

// =======================
// SECURITY & MIDDLEWARE
// =======================
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true
}));

app.use(compression());
app.use(morgan("combined", { stream: logger.stream }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Limit each IP to 1000 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

// =======================
// SOCKET.IO
// =======================
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true
  },
  pingTimeout: 60000,
  pingInterval: 25000
});

app.set("io", io);

io.on("connection", (socket) => {
  logger.info(`Socket connected: ${socket.id}`);
  
  socket.on("joinTenant", (tenantId) => {
    if (!tenantId) return;
    socket.join(`tenant_${tenantId}`);
    logger.info(`Socket ${socket.id} joined tenant_${tenantId}`);
  });
  
  socket.on("campaignUpdate", (data) => {
    io.emit('campaignUpdate', data);
  });
  
  socket.on("disconnect", () => {
    logger.info(`Socket disconnected: ${socket.id}`);
  });
});

// =======================
// DATABASE CONNECTION
// =======================
const connectDB = async () => {
  try {
    const mongoURI = process.env.MONGO_URI;
    if (!mongoURI) {
      throw new Error("MONGO_URI not found in environment variables");
    }
    
    await mongoose.connect(mongoURI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      maxPoolSize: 50,
      minPoolSize: 10,
      retryWrites: true,
      w: 'majority'
    });
    
    logger.info("✅ Connected to MongoDB Atlas");
    return true;
  } catch (err) {
    logger.error(`❌ MongoDB connection error: ${err.message}`);
    return false;
  }
};

// =======================
// WEBHOOK ROUTES
// =======================
app.get("/webhook/meta", (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  
  const verifyToken = process.env.META_WA_VERIFY_TOKEN || 'test_token';
  
  if (mode && token) {
    if (mode === 'subscribe' && token === verifyToken) {
      logger.info('✅ Webhook verified');
      res.status(200).send(challenge);
    } else {
      logger.warn('❌ Webhook verification failed');
      res.sendStatus(403);
    }
  } else {
    logger.warn('⚠️ Missing webhook verification parameters');
    res.sendStatus(400);
  }
});

app.post("/webhook/meta", 
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      const body = JSON.parse(req.body.toString());
      logger.debug('📩 Meta webhook received', { body: JSON.stringify(body) });
      
      if (body.entry && body.entry[0] && body.entry[0].changes) {
        const changes = body.entry[0].changes[0];
        
        if (changes.field === 'messages') {
          const value = changes.value;
          
          if (value.messages && value.messages[0]) {
            const message = value.messages[0];
            const from = message.from;
            const messageText = message.text?.body || 'Media/Other message';
            
            logger.info(`📱 WhatsApp Message from ${from}: ${messageText}`);
            
            // Emit to Socket.IO
            io.emit('whatsapp_message', {
              from: from,
              text: messageText,
              timestamp: new Date().toISOString()
            });
          }
        }
      }
      
      res.status(200).send('EVENT_RECEIVED');
    } catch (error) {
      logger.error('❌ Webhook error:', error);
      res.status(500).send('ERROR');
    }
  }
);

// =======================
// API ROUTES
// =======================
app.use("/api/auth", require("./routes/auth"));
app.use("/api/users", require("./routes/users"));
app.use("/api/contacts", require("./routes/contacts"));
app.use("/api/templates", require("./routes/templates"));
app.use("/api/campaigns", require("./routes/campaigns"));
app.use("/api/media", require("./routes/media"));
app.use("/api/analytics", require("./routes/analytics"));
app.use("/api/sections", require("./routes/sections"));
app.use("/api/whatsapp", require("./routes/whatsappRoutes"));
app.use("/api/debug", require("./routes/debug"));

// =======================
// HEALTH & MONITORING
// =======================
app.get("/api/health", (req, res) => {
  const health = {
    status: "healthy",
    timestamp: new Date().toISOString(),
    serverTime: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
    timezone: 'Asia/Kolkata',
    environment: process.env.NODE_ENV || 'development',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    database: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
    scheduler: campaignScheduler.isInitialized ? "active" : "initializing"
  };
  
  res.json(health);
});

app.get("/api/status", async (req, res) => {
  try {
    const Campaign = require('./models/Campaign');
    
    const activeCampaigns = await Campaign.countDocuments({ status: 'active' });
    const totalCampaigns = await Campaign.countDocuments();
    
    const status = {
      ...campaignScheduler.getStatus(),
      activeCampaigns,
      totalCampaigns,
      serverTime: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      processor: campaignProcessor.getStatus()
    };
    
    res.json(status);
  } catch (error) {
    logger.error('Status check error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/debug/db-status", async (req, res) => {
  try {
    const dbStats = await mongoose.connection.db.stats();
    const collections = await mongoose.connection.db.listCollections().toArray();
    
    res.json({
      ok: dbStats.ok,
      collections: collections.length,
      objects: dbStats.objects,
      avgObjSize: dbStats.avgObjSize,
      dataSize: dbStats.dataSize,
      storageSize: dbStats.storageSize,
      indexes: dbStats.indexes,
      indexSize: dbStats.indexSize
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =======================
// ERROR HANDLING
// =======================
app.use((req, res, next) => {
  res.status(404).json({ error: "Route not found" });
});

app.use((err, req, res, next) => {
  logger.error('Server error:', err);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' ? 'Server error' : err.message,
    stack: process.env.NODE_ENV === 'production' ? undefined : err.stack
  });
});

// =======================
// SERVER INITIALIZATION
// =======================
const initializeServer = async () => {
  logger.info('🚀 Initializing autonomous campaign server...');
  
  // Connect to database
  let dbConnected = false;
  let attempts = 0;
  const maxAttempts = 10;
  
  while (!dbConnected && attempts < maxAttempts) {
    attempts++;
    logger.info(`Attempt ${attempts}/${maxAttempts} to connect to database...`);
    dbConnected = await connectDB();
    
    if (!dbConnected) {
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
  
  if (!dbConnected) {
    logger.error('❌ Failed to connect to database after multiple attempts');
    process.exit(1);
  }
  
  // Initialize autonomous services
  try {
    // Initialize campaign processor
    await campaignProcessor.init();
    logger.info('✅ Campaign processor initialized');
    
    // Initialize campaign scheduler (autonomous mode)
    await campaignScheduler.init();
    logger.info('✅ Campaign scheduler initialized in autonomous mode');
    
    // Schedule daily maintenance
    require('node-cron').schedule('0 3 * * *', async () => {
      logger.info('🧹 Running daily maintenance...');
      await campaignProcessor.cleanupOldData();
    }, {
      scheduled: true,
      timezone: "Asia/Kolkata"
    });
    
    // Schedule hourly health check
    require('node-cron').schedule('0 * * * *', () => {
      logger.info('🏥 Hourly health check - System operational');
    }, {
      scheduled: true,
      timezone: "Asia/Kolkata"
    });
    
    logger.info('\n' + '='.repeat(60));
    logger.info('✅ AUTONOMOUS SERVER INITIALIZED SUCCESSFULLY');
    logger.info('📡 Now running in 24/7 autonomous mode');
    logger.info('⏰ Messages will send automatically at scheduled times');
    logger.info('💤 No portal login required');
    logger.info('🔄 Server restart safe - No duplicate messages');
    logger.info('='.repeat(60) + '\n');
    
  } catch (error) {
    logger.error('❌ Failed to initialize services:', error);
    process.exit(1);
  }
};

// =======================
// START SERVER
// =======================
const PORT = process.env.PORT || 5000;

server.listen(PORT, async () => {
  logger.info(`✅ Server listening on port ${PORT}`);
  logger.info(`🌐 Local URL: http://localhost:${PORT}`);
  logger.info(`🏥 Health check: http://localhost:${PORT}/api/health`);
  logger.info(`📊 Status: http://localhost:${PORT}/api/status`);
  
  // Initialize everything
  await initializeServer();
});

// =======================
// GRACEFUL SHUTDOWN
// =======================
const gracefulShutdown = async (signal) => {
  logger.info(`\n🛑 ${signal} received. Shutting down gracefully...`);
  
  // Clean up scheduler
  await campaignScheduler.cleanup();
  logger.info('✅ Campaign scheduler cleaned up');
  
  // Close database connection
  await mongoose.connection.close();
  logger.info('✅ Database connection closed');
  
  // Close server
  server.close(() => {
    logger.info('✅ Server closed');
    process.exit(0);
  });
  
  // Force shutdown after 10 seconds
  setTimeout(() => {
    logger.error('❌ Forcing shutdown after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('❌ Uncaught Exception:', error);
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

module.exports = { app, server };