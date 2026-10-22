import { Response, NextFunction } from "express";
import { getAuth } from "firebase-admin/auth";
import db from "../services/db";
import { AuthError, ForbiddenError, InternalError } from "../utils/errors";
import { RequestWithContext } from "./logger";

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

export interface AuthenticatedRequest extends RequestWithContext {
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
    next(new AuthError("Missing or malformed Authorization header"));
    return;
  }

  const idToken = authHeader.split("Bearer ")[1];
  if (idToken === "mock-token" && process.env.NODE_ENV !== "test") {
    next(new AuthError("Invalid or expired token"));
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
      next(new AuthError("Invalid or expired token"));
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
    const tenantId = (req.headers["x-tenant-id"] as string) || "safetrust";

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
    req.logger?.error("failed to resolve user role", {
      event: "auth_role_lookup_failed",
      error: error instanceof Error ? error.message : String(error),
    });
    next(new InternalError("Failed to resolve user role"));
  }
}

export function roleChecker(allowedRoles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    const userRole = req.user?.role || "guest";
    if (allowedRoles.includes(userRole)) {
      next();
    } else {
      next(new ForbiddenError());
    }
  };
}