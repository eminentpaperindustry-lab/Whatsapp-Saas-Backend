// src/final-test.js
const fs = require('fs');
const path = require('path');

console.log('🔍 FINAL ENVIRONMENT TEST');
console.log('=========================\n');

// Method 1: Direct file reading
const envPath = path.join(__dirname, '..', '.env');
console.log('Looking for .env at:', envPath);

if (!fs.existsSync(envPath)) {
  console.log('❌ .env file not found!');
  console.log('\n💡 Create .env file in backend folder with:');
  console.log('MONGO_URI=mongodb+srv://wa-drip-db:wadripdb@cluster0.zphvcqd.mongodb.net/');
  process.exit(1);
}

// Read and parse manually
console.log('\n📄 Reading .env file manually...');
const envContent = fs.readFileSync(envPath, 'utf8');
console.log('File size:', envContent.length, 'bytes');
console.log('First 200 chars:', envContent.substring(0, 200));

// Parse line by line
const envVars = {};
const lines = envContent.split(/\r?\n/); // Handle both \n and \r\n

console.log('\n🔧 Parsing lines...');
lines.forEach((line, index) => {
  const trimmed = line.trim();
  if (trimmed && !trimmed.startsWith('#')) {
    const equalsIndex = trimmed.indexOf('=');
    if (equalsIndex !== -1) {
      const key = trimmed.substring(0, equalsIndex).trim();
      const value = trimmed.substring(equalsIndex + 1).trim();
      envVars[key] = value;
      console.log(`Line ${index + 1}: ${key}=${value.substring(0, 30)}...`);
    }
  }
});

console.log('\n✅ Parsed Environment Variables:');
console.log('================================');
console.log('PORT:', envVars.PORT || '❌ Not found');
console.log('MONGO_URI:', envVars.MONGO_URI ? '✅ ' + envVars.MONGO_URI.substring(0, 50) + '...' : '❌ Not found');
console.log('JWT_SECRET:', envVars.JWT_SECRET ? '✅ Set' : '❌ Not found');
console.log('META_WA_TOKEN:', envVars.META_WA_TOKEN ? '✅ Set' : '❌ Not found');

// Set to process.env for dotenv
Object.assign(process.env, envVars);

// Now test with models
console.log('\n📦 Testing model loading...');
try {
  const Campaign = require('./models/Campaign');
  console.log('✅ Campaign model loaded successfully');
  
  // Check schema
  const fields = Object.keys(Campaign.schema.paths)
    .filter(k => !k.includes('_') && !k.includes('.'))
    .sort();
  
  console.log(`📋 Total fields in Campaign: ${fields.length}`);
  
  // Check for new campaign features
  const requiredFields = ['campaignType', 'status', 'dailyTime', 'weeklyTime', 'monthlyTime'];
  const missingFields = requiredFields.filter(field => !fields.includes(field));
  
  if (missingFields.length === 0) {
    console.log('✨ All new campaign fields are present!');
    console.log('✅ Database is ready for campaign features.');
  } else {
    console.log('⚠️ Missing fields:', missingFields);
    console.log('❌ Please update your Campaign model.');
  }
  
} catch (error) {
  console.error('❌ Error loading models:', error.message);
}

console.log('\n🎉 Test completed!');