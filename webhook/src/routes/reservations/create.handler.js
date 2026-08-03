
const { hasura } = require('../../services/hasura');

const createReservationHandler = async (req, res) => {
  const guestId = req.user?.uid;
  const { apartment_id, check_in_date, check_out_date, total_amount, asset_code } = req.body;

  // 1 — Validate required fields
  if (!guestId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!apartment_id || !check_in_date || !check_out_date || !total_amount) {
    return res.status(400).json({
      error: 'Missing required fields: apartment_id, check_in_date, check_out_date, total_amount'
    });
  }

  if (new Date(check_out_date) <= new Date(check_in_date)) {
    return res.status(400).json({
      error: 'check_out_date must be after check_in_date'
    });
  }

  if (total_amount <= 0) {
    return res.status(400).json({
      error: 'total_amount must be greater than zero'
    });
  }

  // 2 — Insert reservation via Hasura GraphQL
  const mutation = `
    mutation CreateReservation($object: reservations_insert_input!) {
      insert_reservations_one(object: $object) {
        id
        apartment_id
        guest_id
        status
        check_in_date
        check_out_date
        total_amount
        asset_code
        escrow_id
        created_at
      }
    }
  `;

  const data = await hasura(mutation, {
    object: {
      apartment_id,
      guest_id: guestId,
      check_in_date,
      check_out_date,
      total_amount,
      asset_code: asset_code || 'USDC',
      status: 'pending',
      tenant_id: 'safetrust',
    }
  });

  if (data.errors) {
    console.error('[reservations/create] Hasura error:', data.errors);
    return res.status(500).json({ error: 'Failed to create reservation', details: data.errors });
  }

  console.log(`[reservations/create] Reservation created — id: ${data.data.insert_reservations_one.id}`);
  return res.status(201).json({ reservation: data.data.insert_reservations_one });
};

module.exports = { createReservationHandler };