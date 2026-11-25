'use strict'

/**
 * @file src/services/confirmation.service.ts
 * @description Core transaction confirmation, verification, Trustless Work indexing,
 *              and durable PostgreSQL retry mechanism for escrow transactions.
 */

import db, { withTransaction } from './db'
import { hasuraRequest } from './hasura'
import { getTrustlessWorkApiKey, getTrustlessWorkApiUrl } from '../lib/source-adapters/tw.adapter'
import { TransactionBuilder, Networks, StrKey, Keypair, Address } from '@stellar/stellar-sdk'
import { getStellarConfig } from '../config/stellar'

// ── Types & Constants ─────────────────────────────────────────────────────────

export type LifecycleStage =
  | 'xdr_issued'
  | 'pending_confirmation'
  | 'ledger_confirmed'
  | 'tw_indexed'
  | 'confirmed'

export type EscrowAction = 'deploy' | 'fund'
export type SubmissionPath = 'helper' | 'external'
export type StellarNetwork = 'testnet' | 'mainnet'
export type RetryStatus = 'retrying' | 'dead_letter' | 'completed'

export const MAX_ATTEMPTS = 5
export const BASE_RETRY_DELAY_MS = 1000
export const MAX_RETRY_DELAY_MS = 300_000 // 5 minutes

export interface ConfirmationRetryRecord {
  id: string
  txHash: string
  escrowId: string
  escrowAction: EscrowAction
  network: StellarNetwork
  submissionPath: SubmissionPath
  status: RetryStatus
  attemptCount: number
  maxAttempts: number
  nextRetryAt: string
  lastError: string | null
  metadata?: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface ConfirmationResult {
  success: boolean
  stage: LifecycleStage
  txHash: string
  escrowId: string
  action: EscrowAction
  network: StellarNetwork
  submissionPath: SubmissionPath
  retryRecordId?: string
  error?: string
  ledger?: number
  twIndexed?: boolean
  isDuplicate?: boolean
}

export interface ProcessRetriesSummary {
  processed: number
  succeeded: number
  retried: number
  deadLettered: number
  errors: string[]
}

const VALID_TX_HASH = /^[0-9a-fA-F]{64}$/

// ── Horizon / Stellar Verification ─────────────────────────────────────────────

export interface StellarVerificationResult {
  verified: boolean
  ledger?: number
  successful?: boolean
  networkMatch?: boolean
  error?: string
}

/**
 * Verifies a Stellar transaction directly against the expected Stellar network.
 * Enforces:
 *  - Valid 64-hex tx hash format
 *  - Ledger execution on the matching network
 *  - Rejection of failed, pending, expired, or wrong-network transactions
 */
export async function verifyStellarTransaction(
  txHash: string,
  expectedNetwork: StellarNetwork
): Promise<StellarVerificationResult> {
  if (!txHash || !VALID_TX_HASH.test(txHash)) {
    return {
      verified: false,
      error: 'Invalid transaction hash format; must be a 64-character hex string',
    }
  }

  const horizonBase =
    expectedNetwork === 'mainnet'
      ? 'https://horizon.stellar.org'
      : 'https://horizon-testnet.stellar.org'

  try {
    const response = await fetch(`${horizonBase}/transactions/${txHash}`)
    if (response.status === 404) {
      return {
        verified: false,
        error: `Transaction not found on Stellar ${expectedNetwork} (pending, expired, or wrong network)`,
      }
    }

    if (!response.ok) {
      return {
        verified: false,
        error: `Stellar Horizon returned status ${response.status}`,
      }
    }

    const txData = (await response.json()) as {
      successful?: boolean
      ledger?: number
      id?: string
      network?: string
    }

    if (txData.successful !== true) {
      return {
        verified: false,
        successful: false,
        error: 'Transaction failed on-ledger',
      }
    }

    return {
      verified: true,
      successful: true,
      networkMatch: true,
      ledger: txData.ledger,
    }
  } catch (err) {
    const error = err as Error
    return {
      verified: false,
      error: `Network error verifying transaction: ${error.message}`,
    }
  }
}

// ── Trustless Work Indexer Synchronization ────────────────────────────────────

/**
 * Calls Trustless Work's indexer/update-from-txHash endpoint.
 * Guardrail: Only callable for TW-generated XDR contexts!
 */
export async function updateTWIndexerFromTxHash(
  txHash: string,
  network: StellarNetwork,
  isTWGenerated: boolean
): Promise<{ success: boolean; error?: string }> {
  if (!isTWGenerated) {
    return {
      success: false,
      error:
        'Guardrail violation: indexer/update-from-txHash can only be called for TW-generated XDRs',
    }
  }

  const twBaseUrl = getTrustlessWorkApiUrl()
  const twApiKey = getTrustlessWorkApiKey()

  try {
    const response = await fetch(`${twBaseUrl}/indexer/update-from-txHash`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(twApiKey ? { 'x-api-key': twApiKey } : {}),
      },
      body: JSON.stringify({ txHash, network }),
    })

    if (!response.ok) {
      const errText = await response.text()
      return {
        success: false,
        error: `TW indexer returned status ${response.status}: ${errText}`,
      }
    }

    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: `TW indexer network error: ${(err as Error).message}`,
    }
  }
}

/**
 * Calls Trustless Work's helper/send-transaction endpoint (Path A).
 */
export async function sendTransactionViaTWHelper(
  signedXdr: string,
  network: StellarNetwork
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  const twBaseUrl = getTrustlessWorkApiUrl()
  const twApiKey = getTrustlessWorkApiKey()

  try {
    const response = await fetch(`${twBaseUrl}/helper/send-transaction`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(twApiKey ? { 'x-api-key': twApiKey } : {}),
      },
      body: JSON.stringify({ signedXdr, network }),
    })

    if (!response.ok) {
      const errText = await response.text()
      return {
        success: false,
        error: `TW helper returned status ${response.status}: ${errText}`,
      }
    }

    const data = (await response.json()) as { txHash?: string; hash?: string }
    const txHash = data.txHash || data.hash
    if (!txHash) {
      return {
        success: false,
        error: 'TW helper response did not include transaction hash',
      }
    }

    return { success: true, txHash }
  } catch (err) {
    return {
      success: false,
      error: `TW helper network error: ${(err as Error).message}`,
    }
  }
}

// ── Bounded Exponential Backoff ───────────────────────────────────────────────

export function calculateBackoffMs(attemptCount: number): number {
  const delay = BASE_RETRY_DELAY_MS * Math.pow(2, Math.max(0, attemptCount - 1))
  return Math.min(delay, MAX_RETRY_DELAY_MS)
}

// ── Database Operations for Retries ───────────────────────────────────────────

export async function upsertRetryRecord(params: {
  txHash: string
  escrowId: string
  action: EscrowAction
  network: StellarNetwork
  submissionPath: SubmissionPath
  status?: RetryStatus
  lastError?: string | null
  attemptCount?: number
  metadata?: Record<string, unknown>
}): Promise<ConfirmationRetryRecord> {
  const status = params.status ?? 'retrying'
  const attemptCount = params.attemptCount ?? 0
  const nextRetryMs = status === 'retrying' ? calculateBackoffMs(attemptCount) : 0

  const { rows } = await db.query<any>(
    `
    INSERT INTO safetrust.escrow_confirmation_retries (
      tx_hash,
      escrow_id,
      escrow_action,
      network,
      submission_path,
      status,
      attempt_count,
      max_attempts,
      next_retry_at,
      last_error,
      metadata,
      tenant_id,
      updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8,
      NOW() + ($9 * INTERVAL '1 millisecond'),
      $10, $11, 'safetrust', NOW()
    )
    ON CONFLICT (tx_hash, escrow_action)
    DO UPDATE SET
      status = EXCLUDED.status,
      last_error = EXCLUDED.last_error,
      attempt_count = EXCLUDED.attempt_count,
      next_retry_at = EXCLUDED.next_retry_at,
      updated_at = NOW()
    RETURNING
      id,
      tx_hash AS "txHash",
      escrow_id AS "escrowId",
      escrow_action AS "escrowAction",
      network,
      submission_path AS "submissionPath",
      status,
      attempt_count AS "attemptCount",
      max_attempts AS "maxAttempts",
      next_retry_at AS "nextRetryAt",
      last_error AS "lastError",
      metadata,
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    `,
    [
      params.txHash,
      params.escrowId,
      params.action,
      params.network,
      params.submissionPath,
      status,
      attemptCount,
      MAX_ATTEMPTS,
      nextRetryMs,
      params.lastError ?? null,
      JSON.stringify(params.metadata ?? {}),
    ]
  )

  return rows[0]
}

export async function updateRetryRecordStatus(
  id: string,
  status: RetryStatus,
  attemptCount: number,
  lastError: string | null
): Promise<void> {
  const nextRetryMs = status === 'retrying' ? calculateBackoffMs(attemptCount) : 0

  await db.query(
    `
    UPDATE safetrust.escrow_confirmation_retries
    SET
      status = $1,
      attempt_count = $2,
      last_error = $3,
      next_retry_at = NOW() + ($4 * INTERVAL '1 millisecond'),
      updated_at = NOW()
    WHERE id = $5
    `,
    [status, attemptCount, lastError, nextRetryMs, id]
  )
}

// ── Local Database Promotion ──────────────────────────────────────────────────

/**
 * Promotes local PostgreSQL records once both ledger confirmation and TW indexing succeed.
 * Strictly separates deployment from funding:
 *  - deploy: sets status = 'created' (NOT 'funded'), sets tx_hash, network on trustless_work_escrows.
 *  - fund: sets status = 'funded', updates balance = amount, sets tx_hash, network on trustless_work_escrows.
 * Status, balance and ledger freshness are written ONLY to trustless_work_escrows.
 * In the same transaction (withTransaction), writes/updates the signed transaction on escrow_transactions.
 */
export async function promoteEscrowStatus(
  escrowId: string,
  action: EscrowAction,
  txHash: string,
  network: StellarNetwork
): Promise<void> {
  const runner = db.withTransaction ?? withTransaction
  await runner(async (client) => {
    let updateResult: { rows: any[] }
    if (action === 'deploy') {
      updateResult = await client.query(
        `
        UPDATE safetrust.trustless_work_escrows
        SET
          status = 'created',
          tx_hash = $1,
          network = $2,
          updated_at = NOW()
        WHERE contract_id = $3
        RETURNING id, tenant_id, contract_id, amount, marker, approver
        `,
        [txHash, network, escrowId]
      )
    } else if (action === 'fund') {
      updateResult = await client.query(
        `
        UPDATE safetrust.trustless_work_escrows
        SET
          status = 'funded',
          balance = amount,
          tx_hash = $1,
          network = $2,
          updated_at = NOW()
        WHERE contract_id = $3
        RETURNING id, tenant_id, contract_id, amount, marker, approver
        `,
        [txHash, network, escrowId]
      )
    } else {
      updateResult = { rows: [] }
    }

    const escrowRow = updateResult?.rows?.[0]
    const internalEscrowId = escrowRow?.id
    const tenantId = escrowRow?.tenant_id ?? 'safetrust'

    if (internalEscrowId) {
      const updateTx = await client.query(
        `
        WITH target_tx AS (
          SELECT id
          FROM safetrust.escrow_transactions
          WHERE escrow_id = $2
            AND (
              tx_hash = $1
              OR (tx_hash IS NULL AND kind = $3 AND status IN ('pending_signature', 'submitted'))
            )
          ORDER BY (tx_hash = $1) DESC, created_at DESC
          LIMIT 1
        )
        UPDATE safetrust.escrow_transactions et
        SET
          status = 'confirmed',
          tx_hash = COALESCE(et.tx_hash, $1),
          updated_at = NOW()
        FROM target_tx
        WHERE et.id = target_tx.id
        RETURNING et.id
        `,
        [txHash, internalEscrowId, action]
      )

      if (updateTx?.rows && updateTx.rows.length === 0) {
        await client.query(
          `
          INSERT INTO safetrust.escrow_transactions (
            escrow_id,
            kind,
            tx_hash,
            status,
            contract_id,
            engagement_id,
            sender_address,
            receiver_address,
            amount,
            tenant_id,
            created_at,
            updated_at
          ) VALUES ($1, $2, $3, 'confirmed', $4, $5, $6, $7, $8, $9, NOW(), NOW())
          ON CONFLICT (escrow_id, kind, tx_hash)
            WHERE tx_hash IS NOT NULL
          DO UPDATE SET
            status = EXCLUDED.status,
            updated_at = NOW()
          `,
          [
            internalEscrowId,
            action,
            txHash,
            escrowRow.contract_id ?? escrowId,
            `eng_${internalEscrowId}`,
            escrowRow.approver ?? '',
            escrowRow.marker ?? '',
            escrowRow.amount ?? 0,
            tenantId
          ]
        )
      }
    } else {
      await client.query(
        `
        WITH target_tx AS (
          SELECT id
          FROM safetrust.escrow_transactions
          WHERE escrow_id = (SELECT id FROM safetrust.trustless_work_escrows WHERE contract_id = $2 LIMIT 1)
            AND (
              tx_hash = $1
              OR (tx_hash IS NULL AND kind = $3 AND status IN ('pending_signature', 'submitted'))
            )
          ORDER BY (tx_hash = $1) DESC, created_at DESC
          LIMIT 1
        )
        UPDATE safetrust.escrow_transactions et
        SET
          status = 'confirmed',
          tx_hash = COALESCE(et.tx_hash, $1),
          updated_at = NOW()
        FROM target_tx
        WHERE et.id = target_tx.id
        `,
        [txHash, escrowId, action]
      )
    }
  })
}

export interface XdrValidationResult {
  valid: boolean
  error?: string
  sourceAccount?: string
  targetContractId?: string
  functionName?: string
}

export const AUTHORIZED_ESCROW_FUNCTIONS = new Set([
  'initialize',
  'fund',
  'approve',
  'change_milestone_status',
  'change_status',
  'release',
  'dispute',
  'resolve',
  'transfer',
  'deposit',
  'withdraw',
])

/**
 * Validates a signed Stellar transaction XDR against network passphrase,
 * allowed operations, expected contract address, action, source accounts,
 * and smart contract function names.
 */
export function validateSignedXdr(
  signedXdr: string,
  network: StellarNetwork,
  expectedContractId?: string,
  action?: EscrowAction,
  expectedSourceAccounts?: string[]
): XdrValidationResult {
  if (!signedXdr || typeof signedXdr !== 'string') {
    return { valid: false, error: 'Signed XDR is required and must be a string' }
  }

  try {
    const passphrase =
      network === 'mainnet'
        ? Networks.PUBLIC
        : Networks.TESTNET

    let tx: any
    try {
      tx = TransactionBuilder.fromXDR(signedXdr, passphrase)
    } catch (parseErr) {
      return {
        valid: false,
        error: `Failed to decode signed XDR for network ${network}: ${(parseErr as Error).message}`,
      }
    }

    const sourceAccount = tx.source
    if (!sourceAccount || !StrKey.isValidEd25519PublicKey(sourceAccount)) {
      return { valid: false, error: 'Signed XDR source account is invalid' }
    }

    // Validate transaction source against expected booking parties if specified
    if (expectedSourceAccounts && expectedSourceAccounts.length > 0) {
      const isAllowed = expectedSourceAccounts.some(
        (acc) => acc && acc.trim() === sourceAccount.trim()
      )
      if (!isAllowed) {
        return {
          valid: false,
          error: `Unauthorized transaction source: account ${sourceAccount} does not match expected booking parties`,
        }
      }
    }

    if (!tx.operations || tx.operations.length === 0) {
      return { valid: false, error: 'Signed XDR contains no operations' }
    }

    for (const op of tx.operations) {
      if (
        op.type === 'setOptions' ||
        op.type === 'accountMerge' ||
        op.type === 'inflation' ||
        op.type === 'manageData' ||
        op.type === 'clawback'
      ) {
        return {
          valid: false,
          error: `Security violation: unauthorized operation "${op.type}" in signed XDR`,
        }
      }

      if (op.type === 'invokeHostFunction') {
        const func = op.func as any
        if (!func) {
          return { valid: false, error: 'Malformed invokeHostFunction operation: missing func' }
        }

        const funcType = typeof func.type === 'string' ? func.type : (func.type?.name ?? '')
        if (funcType === 'hostFunctionTypeInvokeContract' || func.invokeContract) {
          const invokeArgs = func.invokeContract
          if (!invokeArgs) {
            return { valid: false, error: 'Malformed invokeContract args in host function' }
          }

          let invokedContractAddress = ''
          try {
            if (invokeArgs.contractAddress) {
              invokedContractAddress = Address.fromScAddress(invokeArgs.contractAddress).toString()
            }
          } catch {
            // ignore address decoding error
          }

          // Enforce expected escrow binding
          if (
            expectedContractId &&
            expectedContractId.startsWith('C') &&
            invokedContractAddress &&
            invokedContractAddress !== expectedContractId
          ) {
            return {
              valid: false,
              error: `Contract address mismatch: expected ${expectedContractId}, observed ${invokedContractAddress}`,
            }
          }

          const fnName = invokeArgs.functionName ? invokeArgs.functionName.toString().trim() : ''
          if (fnName && !AUTHORIZED_ESCROW_FUNCTIONS.has(fnName.toLowerCase())) {
            return {
              valid: false,
              error: `Unauthorized contract function invocation: "${fnName}"`,
              functionName: fnName,
            }
          }

          // Validate requested action against invoked function
          if (action === 'fund') {
            const fundFns = ['fund', 'deposit', 'approve']
            if (fnName && !fundFns.includes(fnName.toLowerCase())) {
              return {
                valid: false,
                error: `Action mismatch: action "${action}" cannot invoke contract function "${fnName}"`,
                functionName: fnName,
              }
            }
          } else if (action === 'deploy') {
            const deployFns = ['deploy', 'initialize', 'init', 'create']
            if (fnName && !deployFns.includes(fnName.toLowerCase())) {
              return {
                valid: false,
                error: `Action mismatch: action "${action}" cannot invoke contract function "${fnName}"`,
                functionName: fnName,
              }
            }
          }
        } else {
          return {
            valid: false,
            error: `Unsupported host function type: "${funcType}"`,
          }
        }
      } else if (op.type === 'payment') {
        if (action === 'deploy') {
          return {
            valid: false,
            error: `Action mismatch: payment operation cannot be used for "deploy" action`,
          }
        }
        if (
          expectedContractId &&
          expectedContractId.startsWith('G') &&
          op.destination !== expectedContractId
        ) {
          return {
            valid: false,
            error: `Payment destination mismatch: expected ${expectedContractId}, observed ${op.destination}`,
          }
        }
      }
    }

    // Reject envelopes with no signatures
    if (!tx.signatures || tx.signatures.length === 0) {
      return {
        valid: false,
        error: 'Signed XDR contains no signatures',
      }
    }

    let hasValidSig = false
    const txHash = tx.hash()
    for (const sig of tx.signatures) {
      const rawSig = sig.signature?.value || sig.signature
      if (rawSig && sourceAccount) {
        try {
          const keypair = Keypair.fromPublicKey(sourceAccount)
          if (keypair.verify(txHash, rawSig)) {
            hasValidSig = true
            break
          }
        } catch {
          // Check next signature
        }
      }
    }
    if (!hasValidSig) {
      return {
        valid: false,
        error: `Transaction signature is invalid for network ${network}`,
      }
    }

    return { valid: true, sourceAccount }
  } catch (err) {
    return {
      valid: false,
      error: `Error validating signed XDR: ${(err as Error).message}`,
    }
  }
}

// ── Main Confirmation Workflows ───────────────────────────────────────────────

/**
 * Path A: Helper Submission Flow (helper/send-transaction)
 */
export async function processHelperSubmission(params: {
  signedXdr: string
  escrowId: string
  action: EscrowAction
  network: StellarNetwork
  isTWGenerated?: boolean
  expectedSourceAccounts?: string[]
}): Promise<ConfirmationResult> {
  const { signedXdr, escrowId, action, network } = params

  if (!signedXdr || typeof signedXdr !== 'string') {
    return {
      success: false,
      stage: 'xdr_issued',
      txHash: '',
      escrowId,
      action,
      network,
      submissionPath: 'helper',
      error: 'Signed XDR is required for submission',
    }
  }

  // Look up expected booking parties if not passed explicitly
  let expectedSources = params.expectedSourceAccounts
  if (!expectedSources || expectedSources.length === 0) {
    try {
      const escrowRow = await db.query(
        `SELECT e.approver, e.marker, e.releaser, gw.wallet_address AS guest_wallet, hw.wallet_address AS host_wallet
         FROM safetrust.trustless_work_escrows e
         LEFT JOIN safetrust.reservations r ON r.escrow_id = e.id
         LEFT JOIN safetrust.apartments a ON a.id = r.apartment_id
         LEFT JOIN safetrust.user_wallets gw ON gw.user_id = r.guest_id AND gw.chain_type = 'STELLAR' AND gw.is_primary = true
         LEFT JOIN safetrust.user_wallets hw ON hw.user_id = a.owner_id AND hw.chain_type = 'STELLAR' AND hw.is_primary = true
         WHERE (e.contract_id = $1 OR e.id::text = $1)
         LIMIT 1`,
        [escrowId]
      )
      if (escrowRow.rows?.[0]) {
        const r = escrowRow.rows[0]
        const config = getStellarConfig()
        expectedSources = [
          r.approver,
          r.guest_wallet,
          r.marker,
          r.host_wallet,
          config.platformWallet,
          config.releaseSigner,
        ].filter(Boolean) as string[]
      }
    } catch {
      // If DB query fails, continue with structural validation
    }
  }

  // Pre-validate signed XDR against network passphrase, contract binding, action, and expected source party
  const xdrValidation = validateSignedXdr(signedXdr, network, escrowId, action, expectedSources)
  if (!xdrValidation.valid) {
    return {
      success: false,
      stage: 'xdr_issued',
      txHash: '',
      escrowId,
      action,
      network,
      submissionPath: 'helper',
      error: xdrValidation.error ?? 'Invalid signed XDR',
    }
  }

  // Submit via TW helper
  const sendRes = await sendTransactionViaTWHelper(signedXdr, network)
  if (!sendRes.success || !sendRes.txHash) {
    return {
      success: false,
      stage: 'xdr_issued',
      txHash: '',
      escrowId,
      action,
      network,
      submissionPath: 'helper',
      error: sendRes.error ?? 'TW helper failed to submit transaction',
    }
  }

  const txHash = sendRes.txHash

  // Persist pending confirmation and retry record immediately
  const retryRecord = await upsertRetryRecord({
    txHash,
    escrowId,
    action,
    network,
    submissionPath: 'helper',
    status: 'retrying',
    attemptCount: 1,
  })

  // Independently verify ledger execution against the Stellar network
  const ledgerRes = await verifyStellarTransaction(txHash, network)
  if (!ledgerRes.verified) {
    const errorMsg = ledgerRes.error ?? 'Ledger confirmation failed'
    if (retryRecord?.id) {
      await updateRetryRecordStatus(retryRecord.id, 'retrying', 1, errorMsg)
    }
    return {
      success: false,
      stage: 'pending_confirmation',
      txHash,
      escrowId,
      action,
      network,
      submissionPath: 'helper',
      retryRecordId: retryRecord?.id,
      error: errorMsg,
    }
  }

  // Promote SafeTrust DB record
  await promoteEscrowStatus(escrowId, action, txHash, network)
  if (retryRecord?.id) {
    await updateRetryRecordStatus(retryRecord.id, 'completed', 1, null)
  }

  return {
    success: true,
    stage: 'confirmed',
    txHash,
    escrowId,
    action,
    network,
    submissionPath: 'helper',
    retryRecordId: retryRecord.id,
    ledger: ledgerRes.ledger,
    twIndexed: true,
  }
}

/**
 * Path B: External Submission Flow (Client submits to Stellar, posts txHash)
 */
export async function processExternalSubmission(params: {
  txHash: string
  escrowId: string
  action: EscrowAction
  network: StellarNetwork
  isTWGenerated: boolean
}): Promise<ConfirmationResult> {
  const { txHash, escrowId, action, network, isTWGenerated } = params

  // 1. Validate hash format
  if (!txHash || !VALID_TX_HASH.test(txHash)) {
    return {
      success: false,
      stage: 'xdr_issued',
      txHash: txHash || '',
      escrowId,
      action,
      network,
      submissionPath: 'external',
      error: 'Invalid transaction hash format; must be a 64-character hex string',
    }
  }

  // 2. Guardrail: only TW-generated transactions can invoke indexer/update-from-txHash
  if (!isTWGenerated) {
    return {
      success: false,
      stage: 'pending_confirmation',
      txHash,
      escrowId,
      action,
      network,
      submissionPath: 'external',
      error:
        'Guardrail: indexer/update-from-txHash only permitted for TW-generated XDRs',
    }
  }

  // 3. Immediately persist txHash + network (status = pending_confirmation)
  const retryRecord = await upsertRetryRecord({
    txHash,
    escrowId,
    action,
    network,
    submissionPath: 'external',
    status: 'retrying',
    attemptCount: 1,
  })

  // 4. Verify directly against the Stellar network
  const ledgerRes = await verifyStellarTransaction(txHash, network)
  if (!ledgerRes.verified) {
    const errorMsg = ledgerRes.error ?? 'Ledger verification failed'
    // If the failure is terminal (e.g. failed on-ledger or format error), mark dead letter
    if (retryRecord?.id) {
      if (ledgerRes.successful === false) {
        await updateRetryRecordStatus(retryRecord.id, 'dead_letter', 1, errorMsg)
      } else {
        await updateRetryRecordStatus(retryRecord.id, 'retrying', 1, errorMsg)
      }
    }

    return {
      success: false,
      stage: 'pending_confirmation',
      txHash,
      escrowId,
      action,
      network,
      submissionPath: 'external',
      retryRecordId: retryRecord?.id,
      error: errorMsg,
    }
  }

  // 5. Invoke Trustless Work indexer/update-from-txHash
  const twRes = await updateTWIndexerFromTxHash(txHash, network, isTWGenerated)
  if (!twRes.success) {
    const errorMsg = twRes.error ?? 'TW indexer synchronization failed'
    if (retryRecord?.id) {
      await updateRetryRecordStatus(retryRecord.id, 'retrying', 1, errorMsg)
    }
    return {
      success: false,
      stage: 'ledger_confirmed',
      txHash,
      escrowId,
      action,
      network,
      submissionPath: 'external',
      retryRecordId: retryRecord?.id,
      ledger: ledgerRes.ledger,
      error: errorMsg,
    }
  }

  // 6. Both ledger_confirmed and tw_indexed succeeded -> promote SafeTrust DB record
  await promoteEscrowStatus(escrowId, action, txHash, network)
  if (retryRecord?.id) {
    await updateRetryRecordStatus(retryRecord.id, 'completed', 1, null)
  }
  await updateRetryRecordStatus(retryRecord.id, 'completed', 1, null)

  return {
    success: true,
    stage: 'confirmed',
    txHash,
    escrowId,
    action,
    network,
    submissionPath: 'external',
    retryRecordId: retryRecord.id,
    ledger: ledgerRes.ledger,
    twIndexed: true,
  }
}

// ── Background Durable Retry Worker ───────────────────────────────────────────

/**
 * Sweeps pending confirmation retries from the database, executing with
 * exponential backoff, dead-lettering after MAX_ATTEMPTS, and maintaining idempotency.
 */
export async function processPendingConfirmationRetries(): Promise<ProcessRetriesSummary> {
  const summary: ProcessRetriesSummary = {
    processed: 0,
    succeeded: 0,
    retried: 0,
    deadLettered: 0,
    errors: [],
  }

  // Fetch retries ready to execute
  const { rows } = await db.query<any>(
    `
    SELECT
      id,
      tx_hash AS "txHash",
      escrow_id AS "escrowId",
      escrow_action AS "escrowAction",
      network,
      submission_path AS "submissionPath",
      status,
      attempt_count AS "attemptCount",
      max_attempts AS "maxAttempts",
      last_error AS "lastError"
    FROM safetrust.escrow_confirmation_retries
    WHERE status = 'retrying'
      AND next_retry_at <= NOW()
    ORDER BY next_retry_at ASC
    LIMIT 50
    `
  )

  if (rows.length === 0) {
    return summary
  }

  summary.processed = rows.length

  for (const record of rows) {
    const nextAttempt = record.attemptCount + 1

    if (nextAttempt > record.maxAttempts) {
      await updateRetryRecordStatus(
        record.id,
        'dead_letter',
        record.attemptCount,
        'Exceeded maximum confirmation retry attempts'
      )
      summary.deadLettered++
      continue
    }

    try {
      // 1. Verify ledger
      const ledgerRes = await verifyStellarTransaction(
        record.txHash,
        record.network
      )
      if (!ledgerRes.verified) {
        if (ledgerRes.successful === false || nextAttempt >= record.maxAttempts) {
          await updateRetryRecordStatus(
            record.id,
            'dead_letter',
            nextAttempt,
            ledgerRes.error ?? 'Transaction failed on-ledger'
          )
          summary.deadLettered++
        } else {
          await updateRetryRecordStatus(
            record.id,
            'retrying',
            nextAttempt,
            ledgerRes.error ?? 'Ledger confirmation pending'
          )
          summary.retried++
        }
        continue
      }

      // 2. If external submission, sync TW indexer
      if (record.submissionPath === 'external') {
        const twRes = await updateTWIndexerFromTxHash(
          record.txHash,
          record.network,
          true
        )
        if (!twRes.success) {
          if (nextAttempt >= record.maxAttempts) {
            await updateRetryRecordStatus(
              record.id,
              'dead_letter',
              nextAttempt,
              twRes.error ?? 'TW indexer failed'
            )
            summary.deadLettered++
          } else {
            await updateRetryRecordStatus(
              record.id,
              'retrying',
              nextAttempt,
              twRes.error ?? 'TW indexer synchronization failed'
            )
            summary.retried++
          }
          continue
        }
      }

      // 3. Both succeeded -> promote status to confirmed and mark completed
      await promoteEscrowStatus(
        record.escrowId,
        record.escrowAction,
        record.txHash,
        record.network
      )
      await updateRetryRecordStatus(record.id, 'completed', nextAttempt, null)
      summary.succeeded++
    } catch (workerErr) {
      const errMessage = (workerErr as Error).message
      summary.errors.push(`Retry id ${record.id}: ${errMessage}`)
      if (nextAttempt >= record.maxAttempts) {
        await updateRetryRecordStatus(
          record.id,
          'dead_letter',
          nextAttempt,
          errMessage
        )
        summary.deadLettered++
      } else {
        await updateRetryRecordStatus(
          record.id,
          'retrying',
          nextAttempt,
          errMessage
        )
        summary.retried++
      }
    }
  }

  return summary
}
