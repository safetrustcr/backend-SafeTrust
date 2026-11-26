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
import { isEscrowParty } from '../../services/escrow.service'
import type { ConfirmTransactionBody } from '../../validation'

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
    isTWGenerated = true,
  } = req.body
  const configuredNetwork = req.body.network ?? process.env.STELLAR_NETWORK ?? 'testnet'
  if (configuredNetwork !== 'testnet' && configuredNetwork !== 'mainnet') {
    return res.status(400).json({ error: 'network must be either "testnet" or "mainnet"' })
  }
  const network: StellarNetwork = configuredNetwork
  const tenantId = req.context?.tenantId
  if (!tenantId) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const uid = req.context?.uid || req.user?.uid
  if (!uid) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  if (!(await isEscrowParty(uid, escrowId, tenantId))) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Caller is not a recognized party on this escrow',
    })
  }

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

    // update-from-txHash only updates Trustless Work's Firebase index; it does
    // not write SafeTrust PostgreSQL. Local promotion is handled separately.
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
