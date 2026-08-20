import { Request, Response, NextFunction } from 'express'

export interface AuthenticatedUser {
  uid: string
  email?: string
  name?: string
  admin?: boolean
  role?: string
  roles?: string[]
  [key: string]: unknown
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser
}

export function resolveUserRole(uid: string): Promise<{ roles: string[]; role: string }>
export function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void | Response>
export function authenticateFirebase(req: Request, res: Response, next: NextFunction): Promise<void | Response>
