import { Request, Response, NextFunction } from "express";
import { getAuth } from "firebase-admin/auth";
import db from "../services/db";

export interface AuthenticatedRequest extends Request {
  user?: { uid: string; email?: string; role: string; [key: string]: any };
}
export type AuthRequest = AuthenticatedRequest;

function isNoDefaultAppError(error: unknown): boolean {
  if (!error) return false;
  const code = (typeof error === "object" && error !== null && "code" in error)
    ? (error as { code?: unknown }).code
    : undefined;
  if (code === "app/no-default-app") return true;
  const message = error instanceof Error ? error.message : String(error);
  return /no default app/i.test(message);
}

export async function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized", message: "Missing or malformed Authorization header" });
    return;
  }

  const idToken = authHeader.split("Bearer ")[1];
  if (!idToken) {
    res.status(401).json({ error: "Unauthorized", message: "Missing or malformed Authorization header" });
    return;
  }
  if (idToken === "mock-token" && process.env.NODE_ENV !== "test") {
    res.status(401).json({ error: "Unauthorized", message: "Invalid or expired token" });
    return;
  }
  let decodedToken: Record<string, any>;
  if (idToken === "mock-token" && process.env.NODE_ENV === "test") {
    decodedToken = {
      uid: req.headers["x-test-uid"] || "test-user-123",
      email: req.headers["x-test-email"] || "test@example.com",
    };
  } else {
    try {
      decodedToken = await getAuth().verifyIdToken(idToken);
    } catch (error) {
      if (isNoDefaultAppError(error)) {
        console.error(
          '[Auth] Firebase Admin is not initialized; cannot verify ID tokens.'
        );
        res.status(500).json({
          error: "Internal Server Error",
          message: "Authentication service is not configured",
        });
        return;
      }
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
    req.user = { ...decodedToken, uid: decodedToken.uid, roles, role };
    next();
  } catch (error) {
    res.status(500).json({ error: "Internal Server Error", message: "Failed to resolve user role" });
  }
}

export function roleChecker(allowedRoles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    const userRole = req.user?.role || "guest";
    if (allowedRoles.includes(userRole)) {
      next();
    } else {
      res.status(403).json({ error: "Forbidden" });
    }
  };
}
