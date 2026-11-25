'use strict'

import crypto from 'crypto'
import db from './db'
import { logger } from '../middleware/logger'
import {
  getX402AddonInstance,
  X402SettlementResult,
} from '../middleware/x402-payment.middleware'
import {
  ConflictError,
  PaymentRequiredError,
  ServiceUnavailableError,
} from '../utils/errors'

/**
 * How long a `pending` settlement row blocks a retry. A row older than this is
 * assumed to belong to a crashed or timed-out request and may be attempted
 * again; the facilitator deduplicates on the signed payload.
 */
export const SETTLEMENT_PENDING_TIMEOUT_MS = 120_000

export interface X402SettlementInput {
  /** Raw X-Payment header from the request. */
  paymentHeader: string
  amountUsdc: number
  payer?: string | null
  network?: string
  purpose?: string
  /**
   * Hold this settlement pays for, when the payment buys a booking hold. It is
   * persisted so a payment proof can never be reused for a different hold.
   */
  holdId?: string | null
}

export interface X402SettlementReceipt {
  idempotencyKey: string
  transactionHash: string | null
  /** True when a previously confirmed settlement was reused. */
  reused: boolean
}

interface SettlementRow {
  status: string
  tx_hash: string | null
  hold_id: string | null
  updated_at: Date | string
}

/**
 * Stable key for a payment attempt: the same signed header always maps to the
 * same settlement record, so retries reuse the confirmed result.
 */
export function settlementIdempotencyKey(
  paymentHeader: string,
  amountUsdc: number
): string {
  return crypto
    .createHash('sha256')
    .update(`${amountUsdc.toFixed(2)}:${paymentHeader}`)
    .digest('hex')
}

async function findSettlement(idempotencyKey: string): Promise<SettlementRow | undefined> {
  const result = await db.query<SettlementRow>(
    `SELECT status, tx_hash, hold_id, updated_at
       FROM safetrust.x402_settlements
      WHERE idempotency_key = $1`,
    [idempotencyKey]
  )
  return result.rows[0]
}

function isFreshPending(row: SettlementRow | undefined): boolean {
  if (!row || row.status !== 'pending') return false
  const updatedAt = new Date(row.updated_at).getTime()
  return Number.isFinite(updatedAt) && Date.now() - updatedAt < SETTLEMENT_PENDING_TIMEOUT_MS
}

/**
 * A payment proof is bound to the hold it paid for. Reusing it for another
 * hold — or for a hold when it settled a different purpose — is a conflict.
 */
function assertHoldBinding(row: SettlementRow, holdId: string | null | undefined): void {
  if (!holdId) return
  if (row.hold_id !== holdId) {
    throw new ConflictError('Payment proof was already used for a different hold', {
      code: 'settlement_hold_mismatch',
    })
  }
}

async function markFailed(idempotencyKey: string, reason: string): Promise<void> {
  try {
    await db.query(
      `UPDATE safetrust.x402_settlements
          SET status = 'failed', error = $2, updated_at = NOW()
        WHERE idempotency_key = $1
          AND status <> 'settled'`,
      [idempotencyKey, reason]
    )
  } catch (error) {
    logger.error('x402.settlement_persist_failed', { idempotencyKey, error })
  }
}

/**
 * Verify-and-settle the booking fee synchronously and persist the outcome.
 *
 * - A previously `settled` payment returns its stored hash without charging again,
 *   provided it settled the same hold.
 * - A fresh `pending` row (another request in flight) is a conflict.
 * - Any failure is persisted and surfaced as an error, so the caller never
 *   reports a booking as paid when settlement is unconfirmed.
 */
export async function settleBookingFee(
  input: X402SettlementInput
): Promise<X402SettlementReceipt> {
  const idempotencyKey = settlementIdempotencyKey(input.paymentHeader, input.amountUsdc)
  const purpose = input.purpose ?? 'booking_fee'
  const holdId = input.holdId ?? null
  const existing = await findSettlement(idempotencyKey)

  if (existing?.status === 'settled') {
    assertHoldBinding(existing, holdId)
    logger.info('x402.settlement_reused', { idempotencyKey, purpose })
    return {
      idempotencyKey,
      transactionHash: existing.tx_hash,
      reused: true,
    }
  }

  if (isFreshPending(existing)) {
    throw new ConflictError('Payment settlement is already in progress', {
      code: 'settlement_pending',
    })
  }

  if (existing) {
    // An unsettled row may adopt this hold, but never a different one.
    if (holdId && existing.hold_id && existing.hold_id !== holdId) {
      throw new ConflictError('Payment proof was already used for a different hold', {
        code: 'settlement_hold_mismatch',
      })
    }
    // Conditional claim: only take over a row that is not settled and is not a
    // fresh pending attempt. Checking the affected row count makes the claim
    // atomic, so two concurrent retries cannot both settle.
    const claimed = await db.query(
      `UPDATE safetrust.x402_settlements
          SET status = 'pending',
              error = NULL,
              attempts = attempts + 1,
              hold_id = COALESCE($3, hold_id),
              updated_at = NOW()
        WHERE idempotency_key = $1
          AND status <> 'settled'
          AND (status <> 'pending'
               OR updated_at <= NOW() - ($2 || ' milliseconds')::interval)`,
      [idempotencyKey, String(SETTLEMENT_PENDING_TIMEOUT_MS), holdId]
    )

    if ((claimed.rowCount ?? 0) === 0) {
      // Someone else won the claim, or the row settled in the meantime.
      const current = await findSettlement(idempotencyKey)
      if (current?.status === 'settled') {
        assertHoldBinding(current, holdId)
        logger.info('x402.settlement_reused', { idempotencyKey, purpose })
        return { idempotencyKey, transactionHash: current.tx_hash, reused: true }
      }
      throw new ConflictError('Payment settlement is already in progress', {
        code: 'settlement_pending',
      })
    }
  } else {
    const inserted = await db.query(
      `INSERT INTO safetrust.x402_settlements
         (idempotency_key, purpose, amount_usdc, network, payer_address, hold_id, status, attempts)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', 1)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [
        idempotencyKey,
        purpose,
        input.amountUsdc,
        input.network ?? null,
        input.payer ?? null,
        holdId,
      ]
    )
    if ((inserted.rowCount ?? 0) === 0) {
      const concurrent = await findSettlement(idempotencyKey)
      if (concurrent?.status === 'settled') {
        assertHoldBinding(concurrent, holdId)
        return { idempotencyKey, transactionHash: concurrent.tx_hash, reused: true }
      }
      throw new ConflictError('Payment settlement is already in progress', {
        code: 'settlement_pending',
      })
    }
  }

  const addon = getX402AddonInstance()
  if (!addon?.settleX402Payment) {
    const reason = 'x402 settlement processor is unavailable'
    await markFailed(idempotencyKey, reason)
    throw new ServiceUnavailableError(reason)
  }

  let outcome: X402SettlementResult
  try {
    // The addon performs the facilitator round-trip off the JS thread and
    // resolves when settlement is confirmed.
    outcome = await addon.settleX402Payment(input.paymentHeader, input.amountUsdc)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    await markFailed(idempotencyKey, reason)
    logger.error('x402.settlement_error', { idempotencyKey, purpose, error })
    throw new ServiceUnavailableError('x402 settlement failed')
  }

  if (!outcome.settled) {
    const reason = outcome.error ?? 'x402 settlement was declined'
    await markFailed(idempotencyKey, reason)
    logger.warn('x402.settlement_declined', { idempotencyKey, purpose, reason })
    throw new PaymentRequiredError(reason, { code: 'settlement_failed' })
  }

  const transactionHash = outcome.transaction_hash ?? null
  await db.query(
    `UPDATE safetrust.x402_settlements
        SET status = 'settled',
            tx_hash = $2,
            payer_address = COALESCE($3, payer_address),
            network = COALESCE($4, network),
            hold_id = COALESCE($5, hold_id),
            error = NULL,
            updated_at = NOW()
      WHERE idempotency_key = $1`,
    [
      idempotencyKey,
      transactionHash,
      input.payer ?? null,
      input.network || outcome.network || null,
      holdId,
    ]
  )

  logger.info('x402.settled', { idempotencyKey, purpose, transactionHash })
  return { idempotencyKey, transactionHash, reused: false }
}
