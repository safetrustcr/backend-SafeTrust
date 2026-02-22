const jwt = require('jsonwebtoken');
require('dotenv').config();

const API_URL = 'http://localhost:3001/api/escrow/fund';
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) { console.error('JWT_SECRET must be set'); process.exit(1); }
// Mock specific user
const token = jwt.sign({
    sub: 'user-123',
    'https://hasura.io/jwt/claims': {
        'x-hasura-allowed-roles': ['user'],
        'x-hasura-default-role': 'user',
        'x-hasura-user-id': 'user-123'
    }
}, JWT_SECRET, { expiresIn: '5m' });

async function testFundEscrow() {
    console.log('Testing Fund Escrow Endpoint...');

    // Example payload
    const payload = {
        contractId: 'contract-123', // Ensure this exists in your DB or mock checks
        senderAddress: 'G...',
        amount: '100'
    };

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(payload)
        });

        console.log(`Status: ${response.status}`);
        const data = await response.json();
        console.log('Response:', data);
    } catch (error) {
        console.error('Error:', error);
    }
}

testFundEscrow();
