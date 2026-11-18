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
import type { TwIndexerEscrow, TwMilestone } from './tw-indexer.types'

export type DerivedEscrowStatus =
  | 'created'
  | 'funded'
  | 'milestone_approved'
  | 'disputed'
  | 'completed'
  | 'resolved'

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
  return milestone.approved === true || milestone.flags?.approved === true
}

function milestonesOf(escrow: TwIndexerEscrow): TwMilestone[] {
  return Array.isArray(escrow.milestones) ? escrow.milestones : []
}

function deriveSingleReleaseStatus(escrow: TwIndexerEscrow): DerivedEscrowStatus {
  const flags = escrow.flags ?? {}
  if (flags.resolved) return 'resolved'
  if (flags.released) return 'completed'
  if (flags.disputed) return 'disputed'
  if (milestonesOf(escrow).some(milestoneApproved)) return 'milestone_approved'
  return isFunded(escrow) ? 'funded' : 'created'
}

function deriveMultiReleaseStatus(escrow: TwIndexerEscrow): DerivedEscrowStatus {
  const milestones = milestonesOf(escrow)
  if (milestones.length === 0) return deriveSingleReleaseStatus(escrow)

  const settled = (m: TwMilestone) => m.flags?.released === true || m.flags?.resolved === true
  if (milestones.every(settled)) {
    return milestones.some((m) => m.flags?.resolved === true) ? 'resolved' : 'completed'
  }
  if (milestones.some((m) => m.flags?.disputed === true && m.flags?.resolved !== true)) {
    return 'disputed'
  }
  if (milestones.some((m) => milestoneApproved(m) || m.flags?.released === true)) {
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
  const escrow: TwIndexerEscrow = raw && typeof raw === 'object' ? (raw as TwIndexerEscrow) : {}
  const roles = escrow.roles ?? {}
  const balance = toNumber(escrow.balance)

  return {
    contractId: typeof escrow.contractId === 'string' ? escrow.contractId : '',
    status: deriveEscrowStatus(escrow),
    amount: configuredAmount(escrow),
    // Unknown balance is sent as 0; the UPSERT never lets a 0 overwrite a
    // stored nonzero balance from an unversioned snapshot.
    balance: balance ?? 0,
    escrowType: isMultiRelease(escrow) ? 'multi_release' : 'single_release',
    roles: {
      marker: roles.serviceProvider ?? '',
      approver: roles.approver ?? '',
      releaser: roles.releaseSigner ?? '',
    },
    // The V1 indexer carries no ledger sequence (see escrow-freshness.ts).
    ledgerSeq: null,
  }
}

export function normalizeIndexerEscrows(raw: unknown[]): EscrowRecord[] {
  return raw.map(normalizeIndexerEscrow)
}
