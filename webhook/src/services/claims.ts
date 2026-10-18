import { getAuth } from "firebase-admin/auth";
import { pool } from "./db";

const PRECEDENCE = ["admin", "host", "guest"];

export async function syncClaims(uid: string): Promise<void> {
  const client = await pool.connect();
  try {
    const res = await client.query(
      "SELECT r.name AS role FROM safetrust.user_roles ur JOIN safetrust.roles r ON r.id = ur.role_id WHERE ur.user_id = $1 ORDER BY r.name DESC",
      [uid]
    );
    const roles = res.rows.map((row: any) => row.role);
    const highestRole = PRECEDENCE.find((role) => roles.includes(role)) || "guest";
    const allowedRoles = roles.includes("guest") ? roles : [...roles, "guest"];

    await getAuth().setCustomUserClaims(uid, {
      "https://hasura.io/jwt/claims": {
        "x-hasura-default-role": highestRole,
        "x-hasura-allowed-roles": allowedRoles,
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
      "SELECT r.name AS role FROM safetrust.user_roles ur JOIN safetrust.roles r ON r.id = ur.role_id WHERE ur.user_id = $1",
      [uid]
    );
    const roles = res.rows.map((row: any) => row.role);
    return PRECEDENCE.find((role) => roles.includes(role)) || "guest";
  } finally {
    client.release();
  }
}
