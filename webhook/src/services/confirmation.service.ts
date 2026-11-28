'use strict'

/**
 * @file src/services/confirmation.service.ts
 * @description Core transaction confirmation, verification, Trustless Work indexing,
 *              and durable PostgreSQL retry mechanism for escrow transactions.
 */

import { Networks, Transaction, FeeBumpTransaction, TransactionBuilder } from '@stellar/stellar-sdk'
import db, { withTransaction } from './db'
import { hasuraRequest } from './hasura'
import { getTransactionByHash } from '../clients/stellar.client'
import { sendTransaction, updateIndexerFromTxHash } from '../clients/trustless-work.client'
import { UpstreamError, UpstreamTimeoutError } from '../utils/upstream-errors'
import {
  upsertRetryRecord,
  updateRetryRecordStatus,
  fetchPendingRetries,
  type UpsertRetryRecordParams,
} from '../repositories/confirmation-retry.repository'

export {
  upsertRetryRecord,
  updateRetryRecordStatus,
  fetchPendingRetries,
  type UpsertRetryRecordParams,
}

/** Describe an upstream failure for the retry record / result error field. */
function upstreamErrorText(upstream: string, error: unknown): string {
  if (error instanceof UpstreamTimeoutError) {
    return `${upstream} timed out after ${error.timeoutMs} ms at ${error.upstreamPath}`
  }
  if (error instanceof UpstreamError) {
    return `${upstream} upstream error at ${error.upstreamPath}: ${error.message}`
  }
  return `${upstream} request failed: ${error instanceof Error ? error.message : String(error)}`
}

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

  try {
    const txData = await getTransactionByHash(txHash, expectedNetwork)
    if (txData === null) {
      return {
        verified: false,
        error: `Transaction not found on Stellar ${expectedNetwork} (pending, expired, or wrong network)`,
      }
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
 * Calls Trustless Work's PUT /indexer/update-from-txhash endpoint.
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

  try {
    await updateIndexerFromTxHash(txHash, network)
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: upstreamErrorText('TW indexer', err),
    }
  }
}

/**
 * Calls Trustless Work's helper/send-transaction endpoint (Path A).
 */
export async function sendTransactionViaTWHelper(
  signedXdr: string,
  network: StellarNetwork
): Promise<{ success: boolean; txHash?: string; error?: string; ambiguous?: boolean }> {
  try {
    const { txHash } = await sendTransaction(signedXdr, network)
    if (!txHash) {
      // The helper answered 2xx, so it may have accepted the transaction.
      return {
        success: false,
        ambiguous: true,
        error: 'TW helper response did not include transaction hash',
      }
    }

    return { success: true, txHash }
  } catch (err) {
    // A 4xx proves the helper rejected the request. Timeouts, transport
    // failures and 5xx may have reached the network, so they are ambiguous.
    const status = err instanceof UpstreamError ? err.upstreamStatus : undefined
    const rejected = status !== undefined && status >= 400 && status < 500
    return {
      success: false,
      ambiguous: !rejected,
      error: upstreamErrorText('TW helper', err),
    }
  }
}

/**
 * Derive the transaction hash locally from the signed XDR and network
 * passphrase (never from the helper response). Returns null when the XDR
 * is malformed, which proves nothing was submitted.
 */
export function deriveTxHashFromSignedXdr(
  signedXdr: string,
  network: StellarNetwork
): string | null {
  try {
    const passphrase = network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET
    const tx = TransactionBuilder.fromXDR(signedXdr, passphrase)
    return (tx as Transaction | FeeBumpTransaction).hash().toString('hex')
  } catch {
    return null
  }
}

// ── Bounded Exponential Backoff ───────────────────────────────────────────────

export function calculateBackoffMs(attemptCount: number): number {
  const delay = BASE_RETRY_DELAY_MS * Math.pow(2, Math.max(0, attemptCount - 1))
  return Math.min(delay, MAX_RETRY_DELAY_MS)
}

// ── Database Operations for Retries ───────────────────────────────────────────
// Handled by confirmation-retry.repository.ts and re-exported above.

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
): Promise<boolean> {
  const runner = db.withTransaction ?? withTransaction
  return await runner(async (client) => {
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
          AND status != 'untrusted'
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
          AND status != 'untrusted'
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

    if (!internalEscrowId) {
      const checkRow = await client.query(
        `SELECT id, status FROM safetrust.trustless_work_escrows WHERE contract_id = $1`,
        [escrowId]
      )
      if (checkRow?.rows?.[0]?.status === 'untrusted') {
        console.warn(
          `[promoteEscrowStatus] Escrow ${escrowId} is quarantined as untrusted; status update blocked.`
        )
        return false
      }
    }

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
    return Boolean(internalEscrowId)
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

    const effectiveAction = action ?? 'fund'
    const PERMITTED_OPS_BY_ACTION: Record<string, string[]> = {
      deploy: ['invokeHostFunction'],
      fund: ['invokeHostFunction', 'payment'],
      release: ['invokeHostFunction'],
      refund: ['invokeHostFunction'],
      resolve: ['invokeHostFunction'],
    }
    const permittedOps = PERMITTED_OPS_BY_ACTION[effectiveAction] ?? ['invokeHostFunction', 'payment']

    for (const op of tx.operations) {
      if (!permittedOps.includes(op.type)) {
        return {
          valid: false,
          error: `Security violation: unauthorized operation "${op.type}" for action "${effectiveAction}"`,
        }
      }

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

        const funcType =
          typeof func.switch === 'function'
            ? func.switch()?.name
            : typeof func.type === 'string'
              ? func.type
              : (func.type?.name ?? '')
        const isInvoke =
          funcType === 'hostFunctionTypeInvokeContract' ||
          (typeof func.arm === 'function' && func.arm() === 'invokeContract') ||
          !!func.invokeContract

        if (isInvoke) {
          const invokeArgs =
            typeof func.invokeContract === 'function'
              ? func.invokeContract()
              : (func.invokeContract ?? (func.value ? (typeof func.value === 'function' ? func.value() : func.value) : null))
          if (!invokeArgs) {
            return { valid: false, error: 'Malformed invokeContract args in host function' }
          }

          let invokedContractAddress = ''
          try {
            const rawContractAddr =
              typeof invokeArgs.contractAddress === 'function'
                ? invokeArgs.contractAddress()
                : (invokeArgs.contractAddress ?? invokeArgs.contract_address)
            if (rawContractAddr) {
              invokedContractAddress = Address.fromScAddress(rawContractAddr).toString()
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

          const rawFnName =
            typeof invokeArgs.functionName === 'function'
              ? invokeArgs.functionName()
              : (invokeArgs.functionName ?? invokeArgs.function_name)
          const fnName = rawFnName ? rawFnName.toString().trim() : ''
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
        if (effectiveAction === 'deploy') {
          return {
            valid: false,
            error: `Action mismatch: payment operation cannot be used for "deploy" action`,
          }
        }
        if (expectedContractId && expectedContractId.startsWith('C')) {
          return {
            valid: false,
            error: `Action mismatch: contract escrow ${expectedContractId} cannot be funded with classic payment operation`,
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
      const rawSig =
        typeof sig.signature === 'function'
          ? sig.signature()
          : (sig.signature?.value || sig.signature)
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

  // Derive the hash locally before sending; malformed XDR was never submitted.
  const derivedHash = deriveTxHashFromSignedXdr(signedXdr, network)
  if (!derivedHash) {
    return {
      success: false,
      stage: 'xdr_issued',
      txHash: '',
      escrowId,
      action,
      network,
      submissionPath: 'helper',
      error: 'Signed XDR is malformed and cannot be submitted',
    }
  }

  // Submit via TW helper (never re-sent; ambiguous failures reconcile by hash)
  const sendRes = await sendTransactionViaTWHelper(signedXdr, network)
  if (!sendRes.success && sendRes.ambiguous) {
    const errorMsg = sendRes.error ?? 'TW helper submission outcome unknown'
    const retryRecord = await upsertRetryRecord({
      txHash: derivedHash,
      escrowId,
      action,
      network,
      submissionPath: 'helper',
      status: 'retrying',
      attemptCount: 1,
      lastError: errorMsg,
    })
    return {
      success: false,
      stage: 'pending_confirmation',
      txHash: derivedHash,
      escrowId,
      action,
      network,
      submissionPath: 'helper',
      retryRecordId: retryRecord.id,
      error: errorMsg,
    }
  }
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

  const txHash = derivedHash

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
  const rows = await fetchPendingRetries(50)

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
