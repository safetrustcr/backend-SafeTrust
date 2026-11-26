import { NextFunction, Request, RequestHandler, Response } from 'express'
import { authMiddleware } from './auth.middleware'
import { requireX402Payment } from './x402-payment.middleware'

export function x402UnlessAuthenticated(price: number): RequestHandler {
  const requirePayment = requireX402Payment(price)

  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.context) {
      next()
      return
    }

    const authorization = req.headers.authorization
    if (authorization === undefined) {
      requirePayment(req, res, next)
      return
    }

    if (!/^Bearer \S+$/.test(authorization)) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Missing or malformed Authorization header',
      })
      return
    }

    void Promise.resolve(
      authMiddleware(req, res, (error?: unknown) => {
        if (error) {
          next(error)
          return
        }
        if (res.headersSent) return
        if (!req.context) {
          res.status(401).json({ error: 'Unauthorized', message: 'Invalid or expired token' })
          return
        }
        next()
      })
    ).catch(next)
  }
}
