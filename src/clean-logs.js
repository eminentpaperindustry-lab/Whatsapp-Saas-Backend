const mongoose = require('mongoose');
require('dotenv').config();

async function cleanLogs() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');
    
    const MessageLog = require('./models/MessageLog');
    
    // Delete logs older than 90 days
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    
    const result = await MessageLog.deleteMany({
      createdAt: { $lt: ninetyDaysAgo },
      status: 'sent'
    });
    
    console.log(`🧹 Deleted ${result.deletedCount} old message logs`);
    
    // Keep only recent failed logs (30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    
    const failedResult = await MessageLog.deleteMany({
      createdAt: { $lt: thirtyDaysAgo },
      status: 'failed'
    });
    
    console.log(`🗑️ Deleted ${failedResult.deletedCount} old failed logs`);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Clean error:', error);
    process.exit(1);
  }
}

cleanLogs();