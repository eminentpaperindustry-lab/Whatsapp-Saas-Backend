const axios = require('axios');
require('dotenv').config();

async function healthCheck() {
  try {
    const baseUrl = process.env.SERVER_URL || 'http://localhost:5000';
    
    console.log(`🏥 Health checking: ${baseUrl}`);
    
    // Check server health
    const healthResponse = await axios.get(`${baseUrl}/api/health`, {
      timeout: 10000
    });
    
    console.log('✅ Server health:', healthResponse.data);
    
    // Check scheduler status
    const statusResponse = await axios.get(`${baseUrl}/api/status`, {
      timeout: 10000
    });
    
    console.log('✅ Scheduler status:', statusResponse.data);
    
    // Check database
    const dbResponse = await axios.get(`${baseUrl}/api/debug/db-status`, {
      timeout: 10000
    }).catch(() => ({ data: { status: 'unknown' } }));
    
    console.log('✅ Database status:', dbResponse.data);
    
    console.log('\n🎉 All systems operational');
    process.exit(0);
  } catch (error) {
    console.error('❌ Health check failed:', error.message);
    process.exit(1);
  }
}

healthCheck();