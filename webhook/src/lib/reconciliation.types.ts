export interface EscrowRoles {
  marker?: string
  approver?: string
  releaser?: string
}

/**
 * Normalized escrow written by the reconciliation UPSERT. Built from the
 * Trustless Work V1 indexer response by `normalizeIndexerEscrow`; field names
 * follow the current `trustless_work_escrows` columns.
 */
export interface EscrowRecord {
  contractId: string
  status?: string
  amount?: string | number
  balance?: string | number
  escrowType?: string
  ledgerSeq?: bigint | number | string | null
  ledger_seq?: bigint | number | string | null
  network?: string | null
  roles?: EscrowRoles
}

export interface UpsertResult {
  updated: number
  unchanged: number
  skipped: number
}

export interface ChunkSyncResult extends UpsertResult {
  errors: string[]
}

export interface SyncAllResult extends ChunkSyncResult {
  chunks: number
}
