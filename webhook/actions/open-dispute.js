const { query } = require('../utils/database');
const { logger } = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

const TRUSTLESS_WORK_API_URL = process.env.TRUSTLESS_WORK_API_URL || 'https://dev.api.trustlesswork.com';

/**
 * Endpoint for opening a dispute for property damage claims
 * Route: POST /api/escrow/dispute
 * 
 * Requirements:
 * - Validate contractId and senderAddress
 * - Verify only property owner can dispute
 * - Call Trustless Work API (Simulated)
 * - Update status to 'disputed'
 * - Return contractId and unsigned XDR
 */
async function openDispute(req, res) {
  const { input, session_variables } = req.body;
  const { contractId, senderAddress } = input;
  const userId = session_variables['x-hasura-user-id'];

  // Input validation – return 400 for missing required fields
  if (!contractId || typeof contractId !== 'string' || contractId.trim() === '') {
    return res.status(400).json({ success: false, message: 'contractId is required' });
  }
  if (!senderAddress || typeof senderAddress !== 'string' || senderAddress.trim() === '') {
    return res.status(400).json({ success: false, message: 'senderAddress is required' });
  }

  try {
    logger.info('Opening dispute for property damage', { contractId, senderAddress, userId });

    // 1. Fetch escrow and verify ownership
    // We join escrow_transactions -> bid_requests -> apartments to find the owner
    const escrowResult = await query(`
      SELECT 
        et.id as escrow_id,
        et.status,
        a.owner_id,
        uw.wallet_address as owner_wallet
      FROM escrow_transactions et
      JOIN bid_requests br ON et.bid_request_id = br.id
      JOIN apartments a ON br.apartment_id = a.id
      LEFT JOIN user_wallets uw ON a.owner_id = uw.user_id AND uw.is_primary = true
      WHERE et.contract_id = $1
    `, [contractId]);

    if (escrowResult.rows.length === 0) {
      logger.warn('Escrow not found', { contractId });
      return res.status(404).json({ success: false, message: 'Escrow not found' });
    }

    const escrow = escrowResult.rows[0];

    // 2. Validate Authorization
    // Check if the senderAddress is the owner's wallet or if the user is the owner
    const isOwner = escrow.owner_id === userId;
    const isOwnerWallet = senderAddress.toLowerCase() === escrow.owner_wallet?.toLowerCase();

    if (!isOwner && !isOwnerWallet && session_variables['x-hasura-role'] !== 'admin') {
      logger.warn('Unauthorized dispute attempt', { userId, contractId });
      return res.status(403).json({
        success: false,
        message: 'Only the property owner can open a dispute for property damage'
      });
    }

    // 3. Call Trustless Work API to create a dispute
    let unsignedXdr;
    try {
      const twResponse = await fetch(`${TRUSTLESS_WORK_API_URL}/escrow/dispute-escrow`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.TRUSTLESS_WORK_API_KEY || ''}`,
        },
        body: JSON.stringify({ contractId, senderAddress }),
      });

      if (!twResponse.ok) {
        const errBody = await twResponse.text();
        logger.error('Trustless Work API error', { status: twResponse.status, body: errBody, contractId });
        return res.status(502).json({ success: false, message: 'Failed to create dispute with Trustless Work API' });
      }

      const twData = await twResponse.json();
      unsignedXdr = twData.unsignedXdr || twData.unsigned_xdr || twData.xdr;

      if (!unsignedXdr) {
        logger.error('Trustless Work API returned no XDR', { twData, contractId });
        return res.status(502).json({ success: false, message: 'Trustless Work API returned no XDR' });
      }
    } catch (apiErr) {
      logger.error('Error calling Trustless Work API', { error: apiErr.message, contractId });
      return res.status(502).json({ success: false, message: 'Could not reach Trustless Work API' });
    }

    // 4. Update escrow status to 'disputed' in DB
    await query(`
      UPDATE escrow_transactions 
      SET status = 'disputed', updated_at = NOW() 
      WHERE contract_id = $1
    `, [contractId]);

    // 5. Create XDR transaction record for the user to sign
    const xdrId = uuidv4();
    await query(`
      INSERT INTO escrow_xdr_transactions (
        id, 
        escrow_transaction_id, 
        xdr_type, 
        unsigned_xdr, 
        status, 
        signing_address, 
        created_at, 
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
    `, [
      xdrId,
      escrow.escrow_id,
      'OPEN_DISPUTE',
      unsignedXdr,
      'PENDING',
      senderAddress
    ]);

    // 6. Log API call interaction
    await query(`
      INSERT INTO escrow_api_calls (
        id,
        escrow_transaction_id,
        api_name,
        request_payload,
        response_status,
        response_body,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
    `, [
      uuidv4(),
      escrow.escrow_id,
      'trustless_work_create_dispute',
      JSON.stringify({ contractId, senderAddress }),
      200,
      JSON.stringify({ unsignedXdr })
    ]);

    logger.info('Dispute opened successfully', { contractId, xdrId });

    return res.json({
      contractId: contractId,
      unsignedXdr: unsignedXdr
    });

  } catch (error) {
    logger.error(`Open Dispute Error: ${error.message}`, { stack: error.stack });
    return res.status(500).json({
      success: false,
      message: 'Failed to open dispute',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

module.exports = openDispute;
