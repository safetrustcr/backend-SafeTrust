import { Request, Response, NextFunction } from "express";
import { getAuth } from "firebase-admin/auth";
import { getHighestRole } from "../services/claims";

export interface AuthRequest extends Request {
  user?: { uid: string; role: string };
}

export async function authMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized", message: "Missing or malformed Authorization header" });
    return;
  }

  const idToken = authHeader.split("Bearer ")[1];
  let uid: string;
  try {
    const decodedToken = await getAuth().verifyIdToken(idToken);
    uid = decodedToken.uid;
  } catch (error) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const role = await getHighestRole(uid);
    req.user = { uid, role };
    next();
  } catch (error) {
    res.status(500).json({ error: "Internal Server Error", message: "Failed to resolve user role" });
    return;
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
