// src/check-dependencies.js
const fs = require('fs');
const path = require('path');

console.log('🔍 Checking Project Dependencies');
console.log('================================\n');

const projectRoot = path.join(__dirname, '..');
const srcRoot = __dirname;

// Check required files
const requiredFiles = [
  { path: 'services/campaignScheduler.js', desc: 'Campaign Scheduler' },
  { path: 'models/CampaignProgress.js', desc: 'Campaign Progress Model' },
  { path: 'services/whatsapp.js', desc: 'WhatsApp Service' },
  { path: 'models/Campaign.js', desc: 'Campaign Model' },
  { path: 'models/CampaignStep.js', desc: 'Campaign Step Model' },
  { path: '../.env', desc: 'Environment File' }
];

let allFilesExist = true;

requiredFiles.forEach(file => {
  const fullPath = file.path.startsWith('..') 
    ? path.join(projectRoot, file.path.replace('../', ''))
    : path.join(srcRoot, file.path);
  
  const exists = fs.existsSync(fullPath);
  
  console.log(`${exists ? '✅' : '❌'} ${file.desc}: ${exists ? 'Found' : 'MISSING'}`);
  
  if (!exists) {
    allFilesExist = false;
    console.log(`   Path: ${fullPath}`);
    
    // Create if it's a critical file
    if (file.path === 'services/campaignScheduler.js') {
      console.log('   💡 Will create this file...');
    }
  }
});

// Check node_modules
console.log('\n📦 Checking npm dependencies...');
const nodeModulesPath = path.join(projectRoot, 'node_modules');
const packageJsonPath = path.join(projectRoot, 'package.json');

if (fs.existsSync(packageJsonPath)) {
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const requiredDeps = ['node-cron', 'express', 'mongoose'];
  
  requiredDeps.forEach(dep => {
    const hasDep = packageJson.dependencies && packageJson.dependencies[dep] ||
                   packageJson.devDependencies && packageJson.devDependencies[dep];
    
    console.log(`${hasDep ? '✅' : '❌'} ${dep}: ${hasDep ? 'In package.json' : 'NOT in package.json'}`);
    
    if (!hasDep && dep === 'node-cron') {
      console.log('   💡 Run: npm install node-cron');
    }
  });
} else {
  console.log('❌ package.json not found!');
}

console.log('\n🎯 Summary:');
if (allFilesExist) {
  console.log('✅ All required files found!');
  console.log('✨ You can now run: node src/server.js');
} else {
  console.log('⚠️  Some files are missing.');
  console.log('\n💡 Run this command to create missing files:');
  console.log('cd C:\\Users\\SIS\\Desktop\\whatsapp-saas\\backend');
  console.log('node src/fix-missing-files.js');
}