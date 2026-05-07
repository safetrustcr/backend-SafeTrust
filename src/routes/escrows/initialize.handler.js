const { getPool } = require('../../lib/db');
const { trustlessWork } = require('../../lib/trustlesswork');

async function initializeEscrowHandler(req, res) {
  const { uid } = req.user;
  const {
    bookingId, roomId, hotelId, guestId,
    amount, platformFee, escrowType = 'multi-release',
    engagementId, title, description,
    roles, milestones, trustline,
  } = req.body;

  // Validate required fields
  if (!engagementId || !amount || !roles || !milestones || !trustline) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // 1. Call TrustlessWork deployer
    const twResponse = await trustlessWork.post('/deployer/multi-release', {
      signer: uid,
      engagementId,
      title,
      description,
      roles,
      amount,
      platformFee,
      milestones,
      trustline,
    });

    const { unsignedTransaction } = twResponse.data;

    // 2. Persist to canonical table
    const pool = getPool();
    const result = await pool.query(
      `INSERT INTO public.trustless_work_escrows
         (contract_id, booking_id, room_id, hotel_id, guest_id,
          escrow_type, status, amount, tenant_id)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, 'safetrust')
       RETURNING id, contract_id`,
      [engagementId, bookingId, roomId, hotelId, guestId, escrowType, amount]
    );

    const escrow = result.rows[0];
    console.log(`[escrows/initialize] ✅ contractId=${engagementId} persisted`);

    return res.status(201).json({
      escrow: {
        id: escrow.id,
        contractId: escrow.contract_id,
        unsignedTransaction,
      },
    });
  } catch (error) {
    console.error('[escrows/initialize] ❌', error.message);
    return res.status(500).json({ error: 'Failed to initialize escrow' });
  }
}

module.exports = { initializeEscrowHandler };
