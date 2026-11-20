/**
 * Trustless Work V1 indexer response (`GET /helper/get-escrow-by-contract-ids`).
 *
 * Mirrors `GetEscrowsFromIndexerResponse` in the Trustless Work V1 types
 * (trustless-work-dev skill, skills/api/types.md). Every field is optional:
 * this is untrusted upstream data, and the normalizer decides what is usable.
 *
 * Notably there is NO `status` field and NO ledger sequence: lifecycle state is
 * carried by `flags` (single-release) or per-milestone `flags` (multi-release).
 */

export type TwEscrowType = 'single-release' | 'multi-release'

export interface TwFlags {
  /** Trustless Work V1 escrow-level lifecycle flags. */
  isPending?: boolean
  isCompleted?: boolean
  isDisputed?: boolean
  isCancelled?: boolean
  /** Legacy indexer flags retained during the API transition. */
  approved?: boolean
  disputed?: boolean
  released?: boolean
  resolved?: boolean
}

export interface TwRoles {
  approver?: string
  serviceProvider?: string
  platformAddress?: string
  releaseSigner?: string
  disputeResolver?: string
  /** Single-release only; multi-release receivers live on each milestone. */
  receiver?: string
}

export interface TwMilestone {
  description?: string
  /** Free-text progress label set by the service provider. */
  status?: string
  evidence?: string
  /** Single-release approval. */
  approved?: boolean
  /** Multi-release only. */
  amount?: number | string
  /** Multi-release only. */
  receiver?: string
  /** Multi-release lifecycle flags, per milestone. */
  flags?: TwFlags
}

export interface TwIndexerEscrow {
  contractId?: string
  engagementId?: string
  title?: string
  description?: string
  roles?: TwRoles
  /** Single-release configured amount; multi-release has none at top level. */
  amount?: number | string
  platformFee?: number | string
  /** Present when the indexer reads it (e.g. with validateOnChain=true). */
  balance?: number | string
  milestones?: TwMilestone[]
  /** Single-release lifecycle flags. */
  flags?: TwFlags
  trustline?: { address?: string; symbol?: string; name?: string }
  fundedBy?: string
  disputeStartedBy?: string
  isActive?: boolean
  type?: TwEscrowType | string
  createdAt?: string
  updatedAt?: string
}
