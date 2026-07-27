const db = require('../../services/db');

/** @type {string | undefined} */
let cachedUsersIdDataType;

/**
 * @returns {Promise<string | undefined>}
 */
async function getUsersIdColumnType() {
  if (cachedUsersIdDataType) {
    return cachedUsersIdDataType;
  }

  const result = await db.query(
    `SELECT data_type
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'users'
       AND column_name = 'id'`
  );

  cachedUsersIdDataType = result.rows[0]?.data_type;
  return cachedUsersIdDataType;
}

const syncUserHandler = async (req, res) => {
  const { uid, email } = req.user;

  try {
    const idColumnType = await getUsersIdColumnType();
    let query;
    let values;

    if (idColumnType === 'uuid') {
      // hotel_industry: UUID surrogate key; firebase_uid is the auth identifier
      query = `
        INSERT INTO public.users (firebase_uid, email)
        VALUES ($1, $2)
        ON CONFLICT (firebase_uid) WHERE firebase_uid IS NOT NULL
        DO UPDATE SET email = EXCLUDED.email, updated_at = NOW()
        RETURNING id, firebase_uid, email, updated_at
      `;
      values = [uid, email];
    } else {
      // safetrust: Firebase UID stored as primary key (TEXT)
      query = `
        INSERT INTO public.users (id, firebase_uid, email, last_seen)
        VALUES ($1, $1, $2, NOW())
        ON CONFLICT (id)
        DO UPDATE SET last_seen = NOW(), email = EXCLUDED.email, firebase_uid = EXCLUDED.firebase_uid
        RETURNING id, firebase_uid, email, last_seen
      `;
      values = [uid, email];
    }

    const result = await db.query(query, values);
    const user = result.rows[0];

    console.log(`[sync-user] ✅ user synced — uid: ${user.firebase_uid}`);

    res.status(200).json({
      user: {
        id: user.id,
        email: user.email,
        last_seen: user.last_seen ?? user.updated_at,
      },
    });
  } catch (error) {
    console.error('[sync-user] ❌ error:', error.message);
    res.status(500).json({ error: 'Database error' });
  }
};

module.exports = { syncUserHandler };
