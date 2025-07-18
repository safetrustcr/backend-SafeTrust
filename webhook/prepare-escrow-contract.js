const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.PG_DATABASE_URL || 'postgres://postgres:postgrespassword@postgres:5432/postgres',
});

router.post('/prepare-escrow-contract', async (req, res) => {
  try {
    // Hasura Actions nest input under input.input
    const input = req.body.input.input || req.body.input;

    // Construct the payload as per TrustlessWork API
    const payload = {
      signer: input.signer,
      engagementId: input.engagementId,
      title: input.title,
      description: input.description,
      roles: input.roles,
      amount: input.amount,
      platformFee: input.platformFee,
      milestones: input.milestones,
      trustline: input.trustline,
      receiverMemo: input.receiverMemo,
    };

    // Insert into escrow_transactions
    const result = await pool.query(
      `INSERT INTO escrow_transactions 
        (contract_id, signer_address, escrow_status, transaction_type, escrow_payload)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, contract_id AS engagementId, escrow_payload`,
      [
        input.engagementId, // contract_id
        input.signer,       // signer_address
        'PENDING',          // escrow_status
        'CREATE_ESCROW',    // transaction_type
        payload,            // escrow_payload (JSONB)
      ]
    );

    const row = result.rows[0];
    res.json({
      id: row.id,
      engagementId: input.engagementId, // always correct for Hasura
      escrow_payload: row.escrow_payload
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to prepare escrow contract' });
  }
});

module.exports = router; 