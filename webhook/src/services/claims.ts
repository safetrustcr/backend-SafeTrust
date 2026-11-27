import { getAuth } from "firebase-admin/auth";
import { listUserRoles } from "../repositories/user.repository";

const PRECEDENCE = ["admin", "host", "guest"];

export async function syncClaims(uid: string, userRoles?: string[]): Promise<void> {
  const roles = userRoles ?? await listUserRoles(uid, true);

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
  const roles = userRoles ?? await listUserRoles(uid);

  return PRECEDENCE.find((role) => roles.includes(role)) || "guest";
}
