'use strict'

/**
 * @file src/routes/escrows/confirm-transaction.handler.ts
 * @description Handles transaction confirmation and Trustless Work indexing
 *              for both Helper (Path A) and External (Path B) submission flows.
 */

import { Request, Response } from 'express'
import {
  processHelperSubmission,
  processExternalSubmission,
  type StellarNetwork,
} from '../../services/confirmation.service'
import type { ConfirmTransactionBody } from '../../validation'
import { getPlatformTenantId } from '../../config/tenant'

export type ConfirmTransactionPayload = ConfirmTransactionBody

export async function confirmTransactionHandler(
  req: Request<{}, {}, ConfirmTransactionBody>,
  res: Response
): Promise<Response> {
  const {
    submissionPath = 'external',
    txHash,
    signedXdr,
    escrowId,
    action,
    network = (process.env.STELLAR_NETWORK as StellarNetwork) || 'testnet',
    isTWGenerated = true,
  } = req.body
  const tenantId = getPlatformTenantId()

  // Dispatch according to the validated submission path.
  if (submissionPath === 'helper') {
    if (!signedXdr) {
      return res.status(400).json({ error: 'signedXdr is required for helper submission' })
    }

    const result = await processHelperSubmission({
      signedXdr,
      escrowId,
      action,
      network,
      isTWGenerated,
      tenantId,
    })

    if (!result.success) {
      return res.status(400).json({
        success: false,
        stage: result.stage,
        error: result.error,
        retryRecordId: result.retryRecordId,
      })
    }

    return res.status(200).json({
      success: true,
      stage: result.stage,
      txHash: result.txHash,
      escrowId: result.escrowId,
      action: result.action,
      network: result.network,
      ledger: result.ledger,
      twIndexed: result.twIndexed,
    })
  } else if (submissionPath === 'external') {
    if (!txHash) {
      return res.status(400).json({ error: 'txHash is required for external submission' })
    }

    const result = await processExternalSubmission({
      txHash,
      escrowId,
      action,
      network,
      isTWGenerated,
      tenantId,
    })

    if (!result.success) {
      return res.status(400).json({
        success: false,
        stage: result.stage,
        error: result.error,
        retryRecordId: result.retryRecordId,
      })
    }

    return res.status(200).json({
      success: true,
      stage: result.stage,
      txHash: result.txHash,
      escrowId: result.escrowId,
      action: result.action,
      network: result.network,
      ledger: result.ledger,
      twIndexed: result.twIndexed,
    })
  } else {
    return res.status(400).json({
      error: 'Invalid submissionPath; must be "helper" or "external"',
    })
  }
}
