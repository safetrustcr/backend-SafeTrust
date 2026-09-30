import { getAuth } from "firebase-admin/auth";
import { pool } from "../lib/db";

const PRECEDENCE = ["admin", "host", "guest"];

export async function syncClaims(uid: string): Promise<void> {
  const client = await pool.connect();
  try {
    const res = await client.query(
      "SELECT role FROM public.user_roles WHERE user_id = $1 ORDER BY role DESC",
      [uid]
    );
    const roles = res.rows.map((row) => row.role);
    const highestRole = PRECEDENCE.find((role) => roles.includes(role)) || "guest";

    await getAuth().setCustomUserClaims(uid, {
      "https://hasura.io/jwt/claims": {
        "x-hasura-default-role": highestRole,
        "x-hasura-allowed-roles": roles,
        "x-hasura-user-id": uid,
      },
    });
  } finally {
    client.release();
  }
}

export async function getHighestRole(uid: string): Promise<string> {
  const client = await pool.connect();
  try {
    const res = await client.query(
      "SELECT role FROM public.user_roles WHERE user_id = $1",
      [uid]
    );
    const roles = res.rows.map((row) => row.role);
    return PRECEDENCE.find((role) => roles.includes(role)) || "guest";
  } finally {
    client.release();
  }
}
