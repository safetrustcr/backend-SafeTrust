#!/usr/bin/env node

/**
 * Test script for Firebase webhook endpoints
 * Usage: node test-firebase-webhooks.js [baseUrl]
 */

const crypto = require('crypto');
const https = require('https');
const http = require('http');

const BASE_URL = process.argv[2] || 'http://localhost:3000';
const WEBHOOK_SECRET = process.env.FIREBASE_WEBHOOK_SECRET || 'test-secret';

/**
 * Generate HMAC signature for webhook payload
 */
function generateSignature(payload, secret) {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payload, 'utf8');
  return 'sha256=' + hmac.digest('hex');
}

/**
 * Make HTTP request
 */
function makeRequest(url, options, data) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.request(url, options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: body
        });
      });
    });
    
    req.on('error', reject);
    
    if (data) {
      req.write(data);
    }
    
    req.end();
  });
}

/**
 * Test webhook endpoint
 */
async function testWebhook(endpoint, payload, testName) {
  console.log(`\n🧪 Testing ${testName}...`);
  
  const payloadString = JSON.stringify(payload);
  const signature = generateSignature(payloadString, WEBHOOK_SECRET);
  
  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payloadString),
      'X-Firebase-Signature': signature
    }
  };
  
  try {
    const response = await makeRequest(`${BASE_URL}/webhooks/firebase/${endpoint}`, options, payloadString);
    
    console.log(`   Status: ${response.statusCode}`);
    console.log(`   Response: ${response.body}`);
    
    if (response.statusCode >= 200 && response.statusCode < 300) {
      console.log(`   ✅ ${testName} passed`);
    } else {
      console.log(`   ❌ ${testName} failed`);
    }
    
  } catch (error) {
    console.log(`   ❌ ${testName} error: ${error.message}`);
  }
}

/**
 * Test health endpoint
 */
async function testHealth() {
  console.log('\n🏥 Testing health endpoint...');
  
  try {
    const response = await makeRequest(`${BASE_URL}/webhooks/firebase/health`);
    console.log(`   Status: ${response.statusCode}`);
    console.log(`   Response: ${response.body}`);
    
    if (response.statusCode === 200) {
      console.log('   ✅ Health check passed');
    } else {
      console.log('   ❌ Health check failed');
    }
    
  } catch (error) {
    console.log(`   ❌ Health check error: ${error.message}`);
  }
}

/**
 * Test rate limiting
 */
async function testRateLimit() {
  console.log('\n🚦 Testing rate limiting...');
  
  const payload = {
    data: {
      uid: 'rate-limit-test',
      email: 'ratelimit@example.com'
    }
  };
  
  const payloadString = JSON.stringify(payload);
  const signature = generateSignature(payloadString, WEBHOOK_SECRET);
  
  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payloadString),
      'X-Firebase-Signature': signature
    }
  };
  
  // Send multiple requests quickly
  const promises = [];
  for (let i = 0; i < 5; i++) {
    promises.push(makeRequest(`${BASE_URL}/webhooks/firebase/user-created`, options, payloadString));
  }
  
  try {
    const responses = await Promise.all(promises);
    const rateLimited = responses.some(r => r.statusCode === 429);
    
    if (rateLimited) {
      console.log('   ✅ Rate limiting working');
    } else {
      console.log('   ⚠️  Rate limiting not triggered (may be normal)');
    }
    
  } catch (error) {
    console.log(`   ❌ Rate limit test error: ${error.message}`);
  }
}

/**
 * Main test function
 */
async function runTests() {
  console.log('🚀 Starting Firebase webhook tests...');
  console.log(`   Base URL: ${BASE_URL}`);
  console.log(`   Webhook Secret: ${WEBHOOK_SECRET ? 'Set' : 'Not set'}`);
  
  // Test health endpoint
  await testHealth();
  
  // Test user creation
  await testWebhook('user-created', {
    data: {
      uid: 'test-user-123',
      email: 'test@example.com',
      displayName: 'Test User',
      phoneNumber: '+1234567890',
      photoURL: 'https://example.com/photo.jpg',
      metadata: {
        creationTime: new Date().toISOString(),
        lastSignInTime: new Date().toISOString()
      }
    }
  }, 'User Creation');
  
  // Test user update
  await testWebhook('user-updated', {
    data: {
      uid: 'test-user-123',
      email: 'updated@example.com',
      displayName: 'Updated User',
      phoneNumber: '+1987654321',
      photoURL: 'https://example.com/new-photo.jpg'
    }
  }, 'User Update');
  
  // Test user deletion
  await testWebhook('user-deleted', {
    data: {
      uid: 'test-user-123'
    }
  }, 'User Deletion');
  
  // Test invalid signature
  console.log('\n🔒 Testing invalid signature...');
  const invalidPayload = JSON.stringify({
    data: { uid: 'test-invalid', email: 'invalid@example.com' }
  });
  
  try {
    const response = await makeRequest(`${BASE_URL}/webhooks/firebase/user-created`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(invalidPayload),
        'X-Firebase-Signature': 'sha256=invalid-signature'
      }
    }, invalidPayload);
    
    console.log(`   Status: ${response.statusCode}`);
    if (response.statusCode === 401) {
      console.log('   ✅ Invalid signature correctly rejected');
    } else {
      console.log('   ❌ Invalid signature not rejected');
    }
    
  } catch (error) {
    console.log(`   ❌ Invalid signature test error: ${error.message}`);
  }
  
  // Test rate limiting
  await testRateLimit();
  
  console.log('\n✨ Tests completed!');
}

// Run tests if this script is executed directly
if (require.main === module) {
  runTests().catch(console.error);
}

module.exports = {
  testWebhook,
  testHealth,
  generateSignature
};




