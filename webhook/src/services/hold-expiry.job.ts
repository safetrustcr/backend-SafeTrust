import { expireHolds } from '../repositories/hold.repository'
import { logger } from '../middleware/logger'

export const HOLD_EXPIRY_INTERVAL_MS = 30_000

let timer: NodeJS.Timeout | undefined

/** Periodically expire lapsed holds so they stop blocking dates. */
export function startHoldExpiryJob(intervalMs = HOLD_EXPIRY_INTERVAL_MS): void {
  if (timer) return
  const run = async (): Promise<void> => {
    try {
      const changed = await expireHolds()
      if (changed > 0) logger.info('holds.expired', { count: changed })
    } catch (error) {
      logger.error('holds.expiry_failed', { error })
    }
  }
  timer = setInterval(run, intervalMs)
  timer.unref()
}

export function stopHoldExpiryJob(): void {
  if (timer) clearInterval(timer)
  timer = undefined
}
