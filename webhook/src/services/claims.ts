import { getAuth } from "firebase-admin/auth";
import { pool } from "./db";

const PRECEDENCE = ["admin", "host", "guest"];

export async function syncClaims(uid: string, userRoles?: string[]): Promise<void> {
  let roles = userRoles;

  if (!roles) {
    const client = await pool.connect();
    try {
      const res = await client.query(
        "SELECT r.name AS role FROM safetrust.user_roles ur JOIN safetrust.roles r ON r.id = ur.role_id WHERE ur.user_id = $1 ORDER BY r.name DESC",
        [uid]
      );
      roles = res.rows.map((row: any) => row.role);
    } finally {
      client.release();
    }
  }

  const highestRole = PRECEDENCE.find((role) => roles.includes(role)) || "guest";
  const allowedRoles = roles.includes("guest") ? roles : [...roles, "guest"];

  await getAuth().setCustomUserClaims(uid, {
    "https://hasura.io/jwt/claims": {
      "x-hasura-default-role": highestRole,
      "x-hasura-allowed-roles": allowedRoles,
      "x-hasura-user-id": uid,
    },
  });
}

export async function getHighestRole(uid: string, userRoles?: string[]): Promise<string> {
  let roles = userRoles;

  if (!roles) {
    const client = await pool.connect();
    try {
      const res = await client.query(
        "SELECT r.name AS role FROM safetrust.user_roles ur JOIN safetrust.roles r ON r.id = ur.role_id WHERE ur.user_id = $1",
        [uid]
      );
      roles = res.rows.map((row: any) => row.role);
    } finally {
      client.release();
    }
  }

  return PRECEDENCE.find((role) => roles.includes(role)) || "guest";
}
