const express = require('express');
const router = express.Router();
const axios = require('axios');

// Direct test endpoint - no auth required
router.get('/debug-templates', async (req, res) => {
    try {
        const TOKEN = process.env.META_WA_TOKEN;
        const WABA_ID = process.env.META_WA_BUSINESS_ID;
        const GRAPH_VERSION = process.env.META_WA_GRAPH_VERSION || 'v17.0';
        
        console.log('🔍 Debug Template Fetch:');
        console.log('  TOKEN present:', !!TOKEN);
        console.log('  WABA_ID:', WABA_ID);
        
        if (!TOKEN || !WABA_ID) {
            return res.json({
                success: false,
                error: 'Missing environment variables',
                token: !!TOKEN,
                wabaId: !!WABA_ID
            });
        }
        
        // Test 1: Get account info
        console.log('\n1. Testing Account Info...');
        const accountUrl = `https://graph.facebook.com/${GRAPH_VERSION}/${WABA_ID}`;
        
        let accountInfo;
        try {
            const accountRes = await axios.get(accountUrl, {
                headers: { 'Authorization': `Bearer ${TOKEN}` }
            });
            accountInfo = accountRes.data;
            console.log('   ✅ Account Info:', JSON.stringify(accountInfo, null, 2));
        } catch (accountError) {
            console.log('   ❌ Account Error:', accountError.response?.data || accountError.message);
            accountInfo = { error: accountError.message };
        }
        
        // Test 2: Get templates
        console.log('\n2. Testing Templates...');
        const templatesUrl = `https://graph.facebook.com/${GRAPH_VERSION}/${WABA_ID}/message_templates`;
        
        let templatesData;
        try {
            const templatesRes = await axios.get(templatesUrl, {
                headers: { 'Authorization': `Bearer ${TOKEN}` },
                params: { 
                    fields: 'name,language,status,category',
                    limit: 50
                }
            });
            templatesData = templatesRes.data;
            console.log('   ✅ Templates found:', templatesData.data?.length || 0);
            
            if (templatesData.data && templatesData.data.length > 0) {
                console.log('\n   📋 All Templates:');
                templatesData.data.forEach((template, index) => {
                    console.log(`   ${index + 1}. ${template.name} [${template.language}] - ${template.status}`);
                });
            }
        } catch (templatesError) {
            console.log('   ❌ Templates Error:', templatesError.response?.data || templatesError.message);
            templatesData = { error: templatesError.message };
        }
        
        // Test 3: Try with different endpoint format
        console.log('\n3. Testing with different endpoint...');
        let alternativeData;
        try {
            const altUrl = `https://graph.facebook.com/${GRAPH_VERSION}/me/message_templates`;
            const altRes = await axios.get(altUrl, {
                headers: { 'Authorization': `Bearer ${TOKEN}` },
                params: { fields: 'name,status' }
            });
            alternativeData = altRes.data;
            console.log('   ✅ Alternative endpoint templates:', alternativeData.data?.length || 0);
        } catch (altError) {
            console.log('   ❌ Alternative endpoint error:', altError.message);
            alternativeData = { error: altError.message };
        }
        
        res.json({
            success: true,
            accountInfo: accountInfo,
            templates: templatesData,
            alternative: alternativeData,
            env: {
                hasToken: !!TOKEN,
                hasWabaId: !!WABA_ID,
                tokenLength: TOKEN?.length,
                wabaId: WABA_ID
            }
        });
        
    } catch (error) {
        console.error('Overall error:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            stack: error.stack
        });
    }
});

module.exports = router;