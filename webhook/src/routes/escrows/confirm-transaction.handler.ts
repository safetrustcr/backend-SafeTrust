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
import { assertSignedXdrCannotAdvanceStatus, isEscrowParty } from '../../services/escrow.service'
import { AuthError, ForbiddenError, ValidationError } from '../../utils/errors'

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
    throw new ValidationError(
      'Client-side wallet signing cannot advance escrow status; transaction must be submitted with a txHash'
    )
  }

  // 2. Validate required fields
  if (!escrowId) {
    throw new ValidationError('escrowId is required')
  }

  if (!action || !['deploy', 'fund'].includes(action)) {
    throw new ValidationError('action must be either "deploy" or "fund"')
  }

  if (!['testnet', 'mainnet'].includes(network)) {
    throw new ValidationError('network must be either "testnet" or "mainnet"')
  }

  const uid = req.context?.uid || req.user?.uid
  const tenantId = req.context?.tenantId
  if (!uid || !tenantId) {
    throw new AuthError('Unauthorized')
  }

  if (!(await isEscrowParty(uid, escrowId, tenantId))) {
    throw new ForbiddenError('Caller is not a recognized party on this escrow')
  }

  // 3. Dispatch according to submission path
  if (submissionPath === 'helper') {
    if (!signedXdr) {
      throw new ValidationError('signedXdr is required for helper submission')
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
      throw new ValidationError(result.error ?? 'Helper submission failed')
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
      throw new ValidationError('txHash is required for external submission')
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
      throw new ValidationError(result.error ?? 'Helper submission failed')
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
    throw new ValidationError('Invalid submissionPath; must be "helper" or "external"')
  }
}
