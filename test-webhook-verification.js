const axios = require('axios');

async function testVerification() {
  try {
    const ngrokUrl = 'https://nondeprecatorily-unburnt-francisco.ngrok-free.dev';
    const webhookPath = '/api/whatsapp/webhook';
    
    // Test 1: Correct token
    console.log('\n🔍 Test 1: Correct token');
    const url1 = `${ngrokUrl}${webhookPath}?hub.mode=subscribe&hub.verify_token=whatsapp_test_token_2024&hub.challenge=TEST_CHALLENGE_123`;
    
    try {
      const response1 = await axios.get(url1);
      console.log('✅ Status:', response1.status);
      console.log('✅ Response:', response1.data);
      console.log('✅ Response type:', typeof response1.data);
      console.log('✅ Response length:', response1.data.length);
    } catch (error) {
      console.log('❌ Error:', error.response?.status, error.response?.data);
    }
    
    // Test 2: Wrong token
    console.log('\n🔍 Test 2: Wrong token');
    const url2 = `${ngrokUrl}${webhookPath}?hub.mode=subscribe&hub.verify_token=wrong_token&hub.challenge=TEST_CHALLENGE_456`;
    
    try {
      const response2 = await axios.get(url2);
      console.log('Response:', response2.status, response2.data);
    } catch (error) {
      console.log('✅ Expected error:', error.response?.status);
    }
    
    // Test 3: No token
    console.log('\n🔍 Test 3: No token');
    const url3 = `${ngrokUrl}${webhookPath}?hub.mode=subscribe&hub.challenge=TEST_CHALLENGE_789`;
    
    try {
      const response3 = await axios.get(url3);
      console.log('Response:', response3.status, response3.data);
    } catch (error) {
      console.log('✅ Expected error:', error.response?.status);
    }
    
  } catch (error) {
    console.error('Test failed:', error.message);
  }
}

testVerification();