'use strict'

/**
 * @file src/routes/reconciliation/prune-retention.handler.ts
 * @description POST /reconciliation/prune-retention — Hasura cron trigger
 * target. Runs the scheduled data-retention cleanup.
 */

import { Request, Response } from 'express'
import { ok, serverError } from '../../utils/response'
import { pruneOperationalData } from '../../services/retention.service'
import { logger } from '../../middleware/logger'

export const pruneRetentionHandler = async (_req: Request, res: Response): Promise<Response> => {
  try {
    const result = await pruneOperationalData()
    return ok(res, result)
  } catch (error) {
    logger.error('retention.prune.failed', { error })
    return serverError(res, 'Retention cleanup failed')
  }
}
