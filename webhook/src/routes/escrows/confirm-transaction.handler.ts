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
  EscrowAction,
  StellarNetwork,
  SubmissionPath,
} from '../../services/confirmation.service'
import { assertSignedXdrCannotAdvanceStatus } from '../../services/escrow.service'

export interface ConfirmTransactionPayload {
  submissionPath?: SubmissionPath
  txHash?: string
  signedXdr?: string
  escrowId?: string
  action?: EscrowAction
  network?: StellarNetwork
  isTWGenerated?: boolean
  signingOnly?: boolean
}

export async function confirmTransactionHandler(
  req: Request<{}, {}, ConfirmTransactionPayload>,
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
    signingOnly = false,
  } = req.body

  // 1. Guard against advancing status via client signing alone
  if (signingOnly || (signedXdr && !submissionPath && !txHash)) {
    return res.status(400).json({
      error:
        'Client-side wallet signing cannot advance escrow status; transaction must be submitted with a txHash',
    })
  }

  // 2. Validate required fields
  if (!escrowId) {
    return res.status(400).json({ error: 'escrowId is required' })
  }

  if (!action || !['deploy', 'fund'].includes(action)) {
    return res.status(400).json({ error: 'action must be either "deploy" or "fund"' })
  }

  if (!['testnet', 'mainnet'].includes(network)) {
    return res.status(400).json({ error: 'network must be either "testnet" or "mainnet"' })
  }

  // 3. Dispatch according to submission path
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
