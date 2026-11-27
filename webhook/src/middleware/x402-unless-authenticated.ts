import { NextFunction, Request, RequestHandler, Response } from 'express'
import { paymentMiddleware } from '@x402/express'
import { authMiddleware } from './auth.middleware'
import { getActiveX402ResourceServer, getX402Config } from '../config/x402'

const paymentMiddlewares = new Map<string, RequestHandler>()

export function setPropertyPaymentMiddleware(
  middleware: RequestHandler | null,
  routeKey = '*'
): void {
  if (middleware) paymentMiddlewares.set(routeKey, middleware)
  else paymentMiddlewares.delete(routeKey)
}

function getPropertyPaymentMiddleware(
  price: number,
  routeKey: string
): RequestHandler {
  const cacheKey = `${routeKey}:${price}`
  const injected = paymentMiddlewares.get(routeKey)
  const wildcardInjected = paymentMiddlewares.get('*')
  if (wildcardInjected) return wildcardInjected
  if (injected) return injected
  if (paymentMiddlewares.has(cacheKey)) return paymentMiddlewares.get(cacheKey)!

  const config = getX402Config()
  const server = getActiveX402ResourceServer()
  const middleware = paymentMiddleware(
    {
      [routeKey]: {
        accepts: [{
          scheme: 'exact',
          price: `$${price.toFixed(3)}`,
          network: config.network,
          payTo: config.payTo,
        }],
        description: 'SafeTrust property discovery',
        mimeType: 'application/json',
      },
    },
    server,
    undefined,
    undefined,
    false
  ) as unknown as RequestHandler
  paymentMiddlewares.set(cacheKey, middleware)
  return middleware
}

export function x402UnlessAuthenticated(
  price: number,
  routeKey = 'GET /api/v1/properties/search'
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.context) {
      next()
      return
    }

    const authorization = req.headers.authorization
    if (authorization === undefined) {
      const injected = paymentMiddlewares.get(routeKey) ?? paymentMiddlewares.get('*')
      if (injected) {
        injected(req, res, next)
        return
      }
      const requirePayment = getPropertyPaymentMiddleware(price, routeKey)
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
