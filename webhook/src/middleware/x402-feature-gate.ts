import { NextFunction, Request, Response } from 'express'

/**
 * Fail-closed gate for x402-gated routes: when the feature is switched off
 * (`X402_ENABLED !== 'true'`) every request is answered with the documented
 * `503 Feature Unavailable` body before any payment middleware runs.
 *
 * The body is the public contract described in docs/stellar/x402-protocol.md,
 * so the gate lives here instead of in each route module (route files must not
 * build error responses themselves — see routes/__tests__/error-boundary.test.ts).
 */
export function requireX402Enabled(req: Request, res: Response, next: NextFunction): void {
  if (process.env.X402_ENABLED === 'true') {
    next()
    return
  }

  res.status(503).json({
    error: 'Feature Unavailable',
    feature: 'x402',
    message: 'x402 payments are disabled',
  })
}
