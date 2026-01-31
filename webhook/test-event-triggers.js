#!/usr/bin/env node

/**
 * Test script for Hasura event trigger endpoints
 * Usage: node test-event-triggers.js [baseUrl]
 */

const http = require('http');
const https = require('https');

const BASE_URL = process.argv[2] || 'http://localhost:3000';
const ADMIN_SECRET = process.env.HASURA_GRAPHQL_ADMIN_SECRET || 'myadminsecretkey';

/**
 * Make HTTP request
 */
function makeRequest(url, options, data) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    const client = isHttps ? https : http;

    const reqOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-hasura-admin-secret': ADMIN_SECRET,
        ...options.headers,
      },
    };

    const req = client.request(reqOptions, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = body ? JSON.parse(body) : {};
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: parsed,
          });
        } catch (e) {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: body,
          });
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

/**
 * Test an event trigger endpoint
 */
async function testEventTrigger(endpoint, payload, description) {
  console.log(`\n🧪 Testing: ${description}`);
  console.log(`   Endpoint: ${endpoint}`);

  try {
    const response = await makeRequest(`${BASE_URL}${endpoint}`, {
      method: 'POST',
    }, payload);

    if (response.statusCode >= 200 && response.statusCode < 300) {
      console.log(`   ✅ Success (${response.statusCode})`);
      if (response.body.message) {
        console.log(`   Message: ${response.body.message}`);
      }
      return true;
    } else {
      console.log(`   ⚠️  Status: ${response.statusCode}`);
      console.log(`   Response: ${JSON.stringify(response.body, null, 2)}`);
      return false;
    }
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    return false;
  }
}

/**
 * Test health endpoint
 */
async function testHealth() {
  console.log('\n🏥 Testing health endpoint...');
  try {
    const response = await makeRequest(`${BASE_URL}/health`, {
      method: 'GET',
    });

    if (response.statusCode === 200) {
      console.log('   ✅ Health check passed');
      return true;
    } else {
      console.log(`   ⚠️  Health check returned ${response.statusCode}`);
      return false;
    }
  } catch (error) {
    console.log(`   ❌ Health check failed: ${error.message}`);
    return false;
  }
}

/**
 * Main test function
 */
async function runTests() {
  console.log('🚀 Starting Hasura Event Trigger Tests');
  console.log(`   Base URL: ${BASE_URL}`);
  console.log(`   Admin Secret: ${ADMIN_SECRET ? 'Set' : 'Not set'}`);
  console.log('   Note: Some tests may fail if database is not connected');

  // Test health endpoint first
  const healthOk = await testHealth();
  if (!healthOk) {
    console.log('\n⚠️  Health check failed. Server may not be running.');
    console.log('   Start the server with: cd webhook && node index.js');
    return;
  }

  // Sample UUIDs for testing
  const testEscrowId = '123e4567-e89b-12d3-a456-426614174000';
  const testUserId = 'user-123';
  const testContractId = 'contract-123';
  const testMilestoneId = 'milestone-123';

  // Test 1: Escrow Created
  await testEventTrigger(
    '/events/escrow-created',
    {
      event: {
        session_variables: {},
        op: 'INSERT',
        data: {
          old: null,
          new: {
            id: testEscrowId,
            contract_id: testContractId,
            status: 'PENDING',
            amount: 500.00,
            created_at: new Date().toISOString(),
          },
        },
      },
      table: { name: 'escrow_transactions', schema: 'public' },
      trigger: { name: 'on_escrow_created' },
    },
    'Escrow Created Event'
  );

  // Test 2: User Funded
  await testEventTrigger(
    '/events/user-funded',
    {
      event: {
        session_variables: {},
        op: 'UPDATE',
        data: {
          old: { funding_status: 'PENDING' },
          new: {
            id: 'user-tx-123',
            escrow_transaction_id: testEscrowId,
            user_id: testUserId,
            funding_status: 'funded',
            funded_at: new Date().toISOString(),
          },
        },
      },
      table: { name: 'escrow_transaction_users', schema: 'public' },
      trigger: { name: 'on_user_funded' },
    },
    'User Funded Event'
  );

  // Test 3: All Funded
  await testEventTrigger(
    '/events/all-funded',
    {
      event: {
        session_variables: {},
        op: 'UPDATE',
        data: {
          old: { status: 'PENDING' },
          new: { id: testEscrowId, status: 'ACTIVE' },
        },
      },
      table: { name: 'escrow_transactions', schema: 'public' },
      trigger: { name: 'on_all_funded' },
    },
    'All Funded Event'
  );

  // Test 4: Condition Verified
  await testEventTrigger(
    '/events/condition-verified',
    {
      event: {
        session_variables: {},
        op: 'UPDATE',
        data: {
          old: { status: 'pending' },
          new: {
            id: testMilestoneId,
            escrow_id: testEscrowId,
            status: 'approved',
            approved_at: new Date().toISOString(),
            approved_by: 'admin-123',
            description: 'Test milestone',
          },
        },
      },
      table: { name: 'escrow_milestones', schema: 'public' },
      trigger: { name: 'on_condition_verified' },
    },
    'Condition Verified Event'
  );

  // Test 5: All Conditions Met
  await testEventTrigger(
    '/events/all-conditions-met',
    {
      event: {
        session_variables: {},
        op: 'UPDATE',
        data: {
          old: { status: 'ACTIVE' },
          new: { id: testEscrowId, status: 'ACTIVE' },
        },
      },
      table: { name: 'escrow_transactions', schema: 'public' },
      trigger: { name: 'on_all_conditions_met' },
    },
    'All Conditions Met Event'
  );

  // Test 6: Fund Released
  await testEventTrigger(
    '/events/fund-released',
    {
      event: {
        session_variables: {},
        op: 'UPDATE',
        data: {
          old: { status: 'ACTIVE' },
          new: {
            id: testEscrowId,
            status: 'released',
            completed_at: new Date().toISOString(),
            metadata: {
              release_tx_hash: '0x1234567890abcdef',
            },
          },
        },
      },
      table: { name: 'escrow_transactions', schema: 'public' },
      trigger: { name: 'on_fund_released' },
    },
    'Fund Released Event'
  );

  // Test 7: Refund Requested
  await testEventTrigger(
    '/events/refund-requested',
    {
      event: {
        session_variables: {},
        op: 'UPDATE',
        data: {
          old: { refund_status: null, cancellation_reason: null },
          new: {
            id: testEscrowId,
            refund_status: 'pending_review',
            cancellation_reason: 'Test refund request',
            cancelled_by: testUserId,
          },
        },
      },
      table: { name: 'escrow_transactions', schema: 'public' },
      trigger: { name: 'on_refund_requested' },
    },
    'Refund Requested Event'
  );

  console.log('\n✨ Tests completed!');
  console.log('\n📝 Summary:');
  console.log('   - All event trigger endpoints are configured');
  console.log('   - Check logs above for individual test results');
  console.log('   - Database connection errors are expected if DB is not running');
  console.log('   - Email sending will be skipped if SMTP is not configured');
}

// Run tests if this script is executed directly
if (require.main === module) {
  runTests().catch(console.error);
}

module.exports = { runTests, testEventTrigger, testHealth };
