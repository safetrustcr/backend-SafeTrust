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
    req.user = { uid: "anonymous", role: "anonymous" };
    return next();
  }

  const idToken = authHeader.split("Bearer ")[1];
  try {
    const decodedToken = await getAuth().verifyIdToken(idToken);
    const uid = decodedToken.uid;
    const role = await getHighestRole(uid);
    req.user = { uid, role };
    next();
  } catch (error) {
    res.status(401).json({ error: "Unauthorized" });
  }
}

export function roleChecker(allowedRoles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    const userRole = req.user?.role || "anonymous";
    if (allowedRoles.includes(userRole)) {
      next();
    } else {
      res.status(403).json({ error: "Forbidden" });
    }
  };
}
