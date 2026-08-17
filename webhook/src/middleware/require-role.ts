'use strict'

import { Response, NextFunction } from 'express'
import { AuthenticatedRequest } from './auth.middleware'

/**
 * Role-based authorization factory. Expects `req.user.roles` (array, set by
 * `authenticateFirebase` / `authMiddleware` from the `user_roles` lookup) and/or
 * the scalar `req.user.role` / `req.user.admin` fallbacks.
 *
 * Authorization succeeds when *any* of the user's assigned roles is allowed — a
 * multi-role user (e.g. `['guest', 'host']`) must not be denied a `host`-only
 * route just because the scalar `role` resolved to `guest`.
 *
 * @param allowedRoles Roles permitted for the route (e.g. `['admin']`).
 */
export const requireRole = (allowedRoles: string[]) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required',
      })
      return
    }

    // Prefer the full roles array; fall back to the scalar role / admin claim,
    // defaulting to 'guest' when nothing is assigned.
    const userRoles =
      Array.isArray(req.user.roles) && req.user.roles.length > 0
        ? req.user.roles
        : [req.user.admin ? 'admin' : req.user.role || 'guest']

    const isAllowed = userRoles.some((role) => allowedRoles.includes(role))

    if (!isAllowed) {
      res.status(403).json({
        error: 'Forbidden',
        message: 'Insufficient permissions or role not assigned',
      })
      return
    }

    next()
  }
