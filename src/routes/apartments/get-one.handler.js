const { getPool } = require('../../lib/db');

function isUuid(value) {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function getApartmentHandler(req, res) {
  const { id } = req.params;

  if (!isUuid(id)) {
    return res.status(404).json({ error: 'Apartment not found' });
  }

  const QUERY = `
    SELECT
      a.*,
      u.email  AS owner_email,
      uw.wallet_address AS owner_wallet
    FROM public.apartments a
    LEFT JOIN public.users u        ON a.owner_id = u.id
    LEFT JOIN public.user_wallets uw
      ON uw.user_id = u.id AND uw.is_primary = true
    WHERE a.id = $1::uuid
    LIMIT 1
  `;

  try {
    const pool = getPool();
    const result = await pool.query(QUERY, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Apartment not found' });
    }

    const row = result.rows[0];
    const { owner_email, owner_wallet } = row;

    return res.status(200).json({
      apartment: {
        id: row.id,
        name: row.name ?? null,
        address: row.address ?? null,
        price_per_month: row.price ?? null,
        bedrooms: row.bedrooms ?? null,
        bathrooms: row.bathrooms ?? null,
        pet_friendly: row.pet_friendly ?? null,
        description: row.description ?? null,
        is_promoted: row.is_promoted ?? null,
        owner: {
          email: owner_email ?? null,
          walletAddress: owner_wallet ?? null,
        }
      }
    });
  } catch (error) {
    console.error('[apartments/get-one] ❌', error.message);
    return res.status(500).json({ error: 'Failed to fetch apartment' });
  }
}

module.exports = { getApartmentHandler };
