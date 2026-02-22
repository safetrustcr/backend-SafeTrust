/**
 * Test script for Escrow Status API endpoint
 * 
 * Usage:
 *   node test-escrow-status.js <contract_id> <firebase_token>
 * 
 * Example:
 *   node test-escrow-status.js abc123 eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...
 */

const axios = require('axios');

// Configuration
const BASE_URL = process.env.WEBHOOK_URL || 'http://localhost:3001';
const CONTRACT_ID = process.argv[2];
const FIREBASE_TOKEN = process.argv[3];

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function testEscrowStatus() {
  log('\n=== Escrow Status API Test ===\n', 'cyan');

  // Validate inputs
  if (!CONTRACT_ID) {
    log('❌ Error: Contract ID is required', 'red');
    log('Usage: node test-escrow-status.js <contract_id> <firebase_token>', 'yellow');
    process.exit(1);
  }

  if (!FIREBASE_TOKEN) {
    log('❌ Error: Firebase token is required', 'red');
    log('Usage: node test-escrow-status.js <contract_id> <firebase_token>', 'yellow');
    process.exit(1);
  }

  log(`Testing endpoint: ${BASE_URL}/api/escrow/status/${CONTRACT_ID}`, 'blue');
  log(`Token: ${FIREBASE_TOKEN.substring(0, 20)}...`, 'blue');
  log('');

  try {
    const startTime = Date.now();

    const response = await axios.get(
      `${BASE_URL}/api/escrow/status/${CONTRACT_ID}`,
      {
        headers: {
          'Authorization': `Bearer ${FIREBASE_TOKEN}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );

    const duration = Date.now() - startTime;

    log('✅ Request successful!', 'green');
    log(`⏱️  Response time: ${duration}ms`, 'cyan');
    log('');

    // Display response data
    log('=== Response Data ===', 'cyan');
    log(JSON.stringify(response.data, null, 2), 'reset');
    log('');

    // Analyze response
    log('=== Analysis ===', 'cyan');
    const { data } = response.data;

    if (data.local) {
      log(`✅ Local data available`, 'green');
      log(`   Status: ${data.local.status}`, 'blue');
      log(`   Amount: ${data.local.amount}`, 'blue');
      log(`   Created: ${data.local.created_at}`, 'blue');
    } else {
      log(`❌ Local data not available`, 'red');
    }

    if (data.external) {
      log(`✅ External data available`, 'green');
      log(`   Status: ${data.external.status}`, 'blue');
      log(`   Blockchain Status: ${data.external.blockchain_status}`, 'blue');
    } else {
      log(`⚠️  External data not available`, 'yellow');
      if (data.external_error) {
        log(`   Error: ${data.external_error.message}`, 'red');
      }
    }

    if (data.parties && data.parties.length > 0) {
      log(`✅ Parties: ${data.parties.length}`, 'green');
      data.parties.forEach((party, index) => {
        log(`   ${index + 1}. ${party.name} (${party.role})`, 'blue');
      });
    }

    if (data.milestones && data.milestones.length > 0) {
      log(`✅ Milestones: ${data.milestones.length}`, 'green');
      const approved = data.milestones.filter(m => m.status === 'approved').length;
      log(`   Approved: ${approved}/${data.milestones.length}`, 'blue');
    }

    if (data.sync_status) {
      log(`\n=== Sync Status ===`, 'cyan');
      log(`   Local Available: ${data.sync_status.local_available ? '✅' : '❌'}`, 
          data.sync_status.local_available ? 'green' : 'red');
      log(`   External Available: ${data.sync_status.external_available ? '✅' : '❌'}`, 
          data.sync_status.external_available ? 'green' : 'red');
      log(`   Synced: ${data.sync_status.synced ? '✅' : '⚠️'}`, 
          data.sync_status.synced ? 'green' : 'yellow');
    }

    log('\n✅ Test completed successfully!', 'green');

  } catch (error) {
    log('\n❌ Request failed!', 'red');
    
    if (error.response) {
      log(`Status: ${error.response.status}`, 'red');
      log(`Message: ${error.response.data?.message || 'Unknown error'}`, 'red');
      log(`Code: ${error.response.data?.code || 'N/A'}`, 'red');
      
      if (error.response.data?.error) {
        log(`\nError Details:`, 'yellow');
        log(error.response.data.error, 'red');
      }
      
      log('\nFull Response:', 'yellow');
      log(JSON.stringify(error.response.data, null, 2), 'reset');
    } else if (error.request) {
      log('No response received from server', 'red');
      log('Check if the server is running and accessible', 'yellow');
    } else {
      log(`Error: ${error.message}`, 'red');
    }

    process.exit(1);
  }
}

// Run test
testEscrowStatus();
