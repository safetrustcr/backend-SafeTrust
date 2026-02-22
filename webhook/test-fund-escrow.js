const jwt = require('jsonwebtoken');
const request = require('supertest');
const nock = require('nock');
require('dotenv').config();

// Ensure JWT_SECRET and API Config is set for the test
const JWT_SECRET = process.env.JWT_SECRET || 'mysecret';
process.env.JWT_SECRET = JWT_SECRET;
process.env.TRUSTLESS_WORK_API_KEY = 'test-key';
process.env.TRUSTLESS_WORK_API_URL = 'http://mock-api.com';
process.env.REDIS_ENABLED = 'false';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgrespassword@localhost:5433/safetrust_db';
process.env.HASURA_GRAPHQL_ADMIN_SECRET = process.env.HASURA_GRAPHQL_ADMIN_SECRET || 'myadminsecretkey';

// Import the Express app AFTER setting env variables
const app = require('./index');

const { query } = require('./utils/database');

// Mock specific user token
const token = jwt.sign({
    sub: 'user-123',
    'https://hasura.io/jwt/claims': {
        'x-hasura-allowed-roles': ['user'],
        'x-hasura-default-role': 'user',
        'x-hasura-user-id': 'user-123'
    }
}, JWT_SECRET, { expiresIn: '5m' });

async function testFundEscrow() {
    console.log('Testing Fund Escrow Endpoint with Mocked External API...');

    // Reset DB State to be idempotent
    await query("UPDATE escrow_transactions SET status = 'active' WHERE contract_id = 'contract-123'");
    console.log('🔄 Reset DB state to active for contract-123.');

    // 1. Intercept the Trustless Work API call using Nock
    const trustlessUrl = process.env.TRUSTLESS_WORK_API_URL;
    nock(trustlessUrl)
        .post('/escrow/single-release/fund-escrow')
        .reply(200, {
            contractId: 'contract-123',
            unsignedXdr: 'AAAA_MOCKED_UNSIGNED_XDR_DATA_AAAA'
        });

    // 2. Prepare the payload
    const payload = {
        contractId: 'contract-123', // This must match the mock DB row
        senderAddress: 'G...',
        amount: '100'
    };

    try {
        // 3. Send request via Supertest
        const response = await request(app)
            .post('/api/escrow/fund')
            .set('Authorization', `Bearer ${token}`)
            .send(payload);

        console.log(`Status: ${response.status}`);
        console.log('Response:', response.body);

        if (response.status === 200) {
            console.log('✅ Test Passed: Successfully mocked external API and received 200 OK');
        } else {
            console.error('❌ Test Failed: Received unexpected status code');
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

testFundEscrow();
