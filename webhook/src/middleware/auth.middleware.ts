import { Request, Response, NextFunction } from "express";
import { getAuth } from "firebase-admin/auth";
import db from "../services/db";
import { getPlatformTenantId } from "../config/tenant";

export interface RequestContext {
  uid: string;
  tenantId: string;
  roles: string[];
  email?: string;
}

declare global {
  namespace Express {
    interface Request {
      context?: RequestContext;
      user?: {
        uid: string;
        email?: string;
        role: string;
        roles: string[];
        [key: string]: any;
      };
    }
  }
}

export interface AuthenticatedRequest extends Request {
  context?: RequestContext;
  user?: {
    uid: string;
    email?: string;
    role: string;
    roles: string[];
    [key: string]: any;
  };
}
export type AuthRequest = AuthenticatedRequest;

const HASURA_CLAIMS_NAMESPACE = "https://hasura.io/jwt/claims";

/**
 * Resolve the session tenant from the verified ID token only.
 *
 * Order: the Hasura claims namespace (`x-hasura-tenant-id`), a top-level
 * `tenant_id` custom claim, then the Firebase multi-tenancy tenant. A token
 * with no tenant claim belongs to the platform tenant. Request headers are
 * never a source for this value.
 */
export function resolveSessionTenantId(decodedToken: Record<string, any>): string {
  const candidates = [
    decodedToken[HASURA_CLAIMS_NAMESPACE]?.["x-hasura-tenant-id"],
    decodedToken.tenant_id,
    decodedToken.firebase?.tenant,
  ];
  const claim = candidates.find(
    (value): value is string => typeof value === "string" && value.trim().length > 0
  );
  return claim ? claim.trim() : getPlatformTenantId();
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  // If already authenticated by parent middleware boundary (e.g. /api), proceed immediately
  if (req.context) {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized", message: "Missing or malformed Authorization header" });
    return;
  }

  const idToken = authHeader.split("Bearer ")[1];
  if (idToken === "mock-token" && process.env.NODE_ENV !== "test") {
    res.status(401).json({ error: "Unauthorized", message: "Invalid or expired token" });
    return;
  }
  let decodedToken: Record<string, any>;
  if (idToken === "mock-token" && process.env.NODE_ENV === "test") {
    decodedToken = {
      uid: (req.headers["x-test-uid"] as string) || "test-user-123",
      email: (req.headers["x-test-email"] as string) || "test@example.com",
    };
  } else {
    try {
      decodedToken = await getAuth().verifyIdToken(idToken);
    } catch (error) {
      res.status(401).json({ error: "Unauthorized", message: "Invalid or expired token" });
      return;
    }
  }

  try {
    const result = await db.query<{ name: string }>(
      "SELECT r.name FROM safetrust.user_roles ur JOIN safetrust.roles r ON r.id = ur.role_id WHERE ur.user_id = $1",
      [decodedToken.uid]
    );
    const roles = result.rows.map((row: { name: string }) => row.name);
    const role = ["admin", "host", "guest"].find((value) => roles.includes(value)) || "guest";
    const tenantId = resolveSessionTenantId(decodedToken);

    // `x-tenant-id` may only confirm the session tenant, never select another one.
    const requestedTenant = req.headers["x-tenant-id"];
    if (
      typeof requestedTenant === "string" &&
      requestedTenant.length > 0 &&
      requestedTenant !== tenantId
    ) {
      res.status(403).json({ error: "Forbidden", message: "Tenant is not permitted for this session" });
      return;
    }

    const context: RequestContext = {
      uid: decodedToken.uid,
      tenantId,
      roles,
      email: decodedToken.email,
    };

    req.context = context;
    req.user = { ...decodedToken, uid: decodedToken.uid, roles, role };
    next();
  } catch (error) {
    res.status(500).json({ error: "Internal Server Error", message: "Failed to resolve user role" });
  }
}
