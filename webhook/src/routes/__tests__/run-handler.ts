import { errorHandler } from '../../middleware/error-handler'

/**
 * Test helper that invokes a route handler and delegates any thrown error
 * to the centralized errorHandler middleware (simulating Express 5 async error handling).
 */
export async function runHandler<T = any>(
  handler: (req: any, res: any, next?: any) => Promise<T> | T,
  req: any,
  res: any
): Promise<T | void> {
  try {
    return await handler(req, res)
  } catch (err) {
    errorHandler(err, req, res, () => {})
  }
}
