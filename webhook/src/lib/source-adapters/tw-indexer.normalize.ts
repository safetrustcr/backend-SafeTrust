/**
 * Maps a Trustless Work V1 indexer escrow onto the record the reconciliation
 * UPSERT writes (`safetrust.trustless_work_escrows`).
 *
 * Both sync paths (sequential TypeScript fetch and the parallel Rust
 * chunk-processor) return raw indexer JSON; this is the single mapping.
 *
 * ── Status derivation ───────────────────────────────────────────────────────
 * The V1 indexer has no `status` field. Status is derived from flags, first
 * match wins:
 *
 *   single-release (escrow `flags`, milestone `approved`)
 *     flags.resolved                       → resolved
 *     flags.released                       → completed
 *     flags.disputed                       → disputed
 *     any milestone approved               → milestone_approved
 *     balance > 0 or fundedBy set          → funded
 *     otherwise                            → created
 *
 *   multi-release (per-milestone `flags`)
 *     every milestone released or resolved → resolved if any was resolved,
 *                                            otherwise completed
 *     any milestone disputed, unresolved   → disputed
 *     any milestone approved or released   → milestone_approved
 *     balance > 0 or fundedBy set          → funded
 *     otherwise                            → created
 *
 * Not derivable from the indexer: `active` and `pending_funding` (SafeTrust
 * steps with no V1 flag) and `cancelled` (V1 has no cancel operation). A
 * single-release `withdraw-remaining-funds` emits no V1 event, so it is not
 * observable here either.
 *
 * ── Roles ────────────────────────────────────────────────────────────────────
 * The table still uses the pre-V1 role columns until the schema migration:
 *   marker   ← roles.serviceProvider
 *   approver ← roles.approver
 *   releaser ← roles.releaseSigner
 * `platformAddress`, `disputeResolver` and `receiver` have no column yet.
 */

import type { EscrowRecord } from '../reconciliation.types'
import type { TwFlags, TwIndexerEscrow, TwMilestone } from './tw-indexer.types'
import { EscrowStatus, isEscrowStatus } from '../../domain'

export type DerivedEscrowStatus = EscrowStatus

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function flagsOf(value: unknown): TwFlags {
  return isPlainObject(value) ? (value as TwFlags) : {}
}

function stringOr(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function isMultiRelease(escrow: TwIndexerEscrow): boolean {
  return escrow.type === 'multi-release'
}

function isFunded(escrow: TwIndexerEscrow): boolean {
  const balance = toNumber(escrow.balance)
  return (balance !== null && balance > 0) || Boolean(escrow.fundedBy)
}

function milestoneApproved(milestone: TwMilestone): boolean {
  return milestone.approved === true || flagsOf(milestone.flags).approved === true
}

/** Object milestones only; `validateIndexerEscrow` rejects a record holding anything else. */
function milestonesOf(escrow: TwIndexerEscrow): TwMilestone[] {
  return Array.isArray(escrow.milestones) ? escrow.milestones.filter(isPlainObject) : []
}

function deriveSingleReleaseStatus(escrow: TwIndexerEscrow): DerivedEscrowStatus {
  const flags = flagsOf(escrow.flags)
  if (flags.resolved) return 'resolved'
  if (flags.released) return 'completed'
  if (flags.disputed) return 'disputed'
  if (milestonesOf(escrow).some(milestoneApproved)) return 'milestone_approved'
  return isFunded(escrow) ? 'funded' : 'created'
}

function deriveMultiReleaseStatus(escrow: TwIndexerEscrow): DerivedEscrowStatus {
  const milestones = milestonesOf(escrow)
  if (milestones.length === 0) return deriveSingleReleaseStatus(escrow)

  const flags = (m: TwMilestone) => flagsOf(m.flags)
  const settled = (m: TwMilestone) => flags(m).released === true || flags(m).resolved === true
  if (milestones.every(settled)) {
    return milestones.some((m) => flags(m).resolved === true) ? 'resolved' : 'completed'
  }
  if (milestones.some((m) => flags(m).disputed === true && flags(m).resolved !== true)) {
    return 'disputed'
  }
  if (milestones.some((m) => milestoneApproved(m) || flags(m).released === true)) {
    return 'milestone_approved'
  }
  return isFunded(escrow) ? 'funded' : 'created'
}

/** Lifecycle status for a V1 indexer escrow (see the table at the top). */
export function deriveEscrowStatus(escrow: TwIndexerEscrow): DerivedEscrowStatus {
  return isMultiRelease(escrow)
    ? deriveMultiReleaseStatus(escrow)
    : deriveSingleReleaseStatus(escrow)
}

/** Single-release: the configured amount. Multi-release: the sum of milestone amounts. */
export function configuredAmount(escrow: TwIndexerEscrow): number {
  if (!isMultiRelease(escrow)) return toNumber(escrow.amount) ?? 0
  const total = milestonesOf(escrow).reduce((sum, m) => sum + (toNumber(m.amount) ?? 0), 0)
  return total > 0 ? total : toNumber(escrow.amount) ?? 0
}

/**
 * Normalize one raw indexer escrow. Never drops a record: an escrow without a
 * contract id is returned with an empty one so the UPSERT counts it as skipped.
 */
export function normalizeIndexerEscrow(raw: unknown): EscrowRecord {
  const escrow: TwIndexerEscrow = isPlainObject(raw) ? (raw as TwIndexerEscrow) : {}
  const roles: Record<string, unknown> = isPlainObject(escrow.roles) ? escrow.roles : {}
  const balance = toNumber(escrow.balance)

  return {
    contractId: stringOr(escrow.contractId),
    status: deriveEscrowStatus(escrow),
    amount: configuredAmount(escrow),
    // Unknown balance is sent as 0; the UPSERT never lets a 0 overwrite a
    // stored nonzero balance from an unversioned snapshot.
    balance: balance ?? 0,
    escrowType: isMultiRelease(escrow) ? 'multi_release' : 'single_release',
    roles: {
      marker: stringOr(roles.serviceProvider),
      approver: stringOr(roles.approver),
      releaser: stringOr(roles.releaseSigner),
    },
    // The V1 indexer carries no ledger sequence (see escrow-freshness.ts).
    ledgerSeq: null,
  }
}

/**
 * Why a raw indexer record cannot be written, or null when it can.
 *
 * Checks the structure every derivation step dereferences, so a malformed
 * record (for example `milestones: [null]`) is skipped on its own instead of
 * failing the whole chunk.
 */
export function validateIndexerEscrow(raw: unknown): string | null {
  if (!isPlainObject(raw)) return 'escrow is not an object'
  if (typeof raw.contractId !== 'string' || raw.contractId.trim() === '') {
    return 'missing contractId'
  }
  for (const key of ['flags', 'roles', 'trustline'] as const) {
    if (raw[key] != null && !isPlainObject(raw[key])) return `${key} is not an object`
  }
  if (raw.milestones != null) {
    if (!Array.isArray(raw.milestones)) return 'milestones is not an array'
    for (const [index, milestone] of raw.milestones.entries()) {
      if (!isPlainObject(milestone)) return `milestones[${index}] is not an object`
      if (milestone.flags != null && !isPlainObject(milestone.flags)) {
        return `milestones[${index}].flags is not an object`
      }
    }
  }
  return null
}

export interface InvalidIndexerEscrow {
  /** Present when the record carried a usable contract id. */
  contractId?: string
  reason: string
}

export interface NormalizedIndexerBatch {
  escrows: EscrowRecord[]
  /** Records not written; the caller counts them as skipped. */
  invalid: InvalidIndexerEscrow[]
}

/**
 * Normalize a chunk. Each record is validated and normalized on its own: an
 * invalid record lands in `invalid` and never prevents its siblings from
 * being written.
 */
export function normalizeIndexerEscrows(raw: unknown[]): NormalizedIndexerBatch {
  const escrows: EscrowRecord[] = []
  const invalid: InvalidIndexerEscrow[] = []

  for (const record of raw) {
    const contractId =
      isPlainObject(record) && typeof record.contractId === 'string' && record.contractId.trim() !== ''
        ? record.contractId
        : undefined
    const reason = validateIndexerEscrow(record)
    if (reason) {
      invalid.push({ contractId, reason })
      continue
    }
    try {
      escrows.push(normalizeIndexerEscrow(record))
    } catch (error) {
      invalid.push({ contractId, reason: `normalization failed: ${(error as Error).message}` })
    }
  }

  return { escrows, invalid }
}
