export interface EscrowRoles {
  marker?: string
  approver?: string
  releaser?: string
  platformAddress?: string
  disputeResolver?: string
  receiver?: string
}

/**
 * Normalized escrow written by reconciliation. The three legacy role columns
 * map V1 serviceProvider/approver/releaseSigner; all six V1 roles are also
 * retained in escrow_metadata for current party authorization.
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

export interface BulkUpsertAddon {
  bulkUpsertEscrows: (updatesJson: string, connString: string) => Promise<string>
}

export interface ChunkProcessorAddon {
  processChunksParallel: (
    chunksJson: string,
    apiUrl: string,
    apiKey: string,
    concurrency: number,
    timeoutMs: number
  ) => Promise<string>
}

export interface BulkUpsertResult {
  rows_affected: number
  unchanged: number
  duration_ms: number
}

export interface ChunkResult {
  chunk_index: number
  fetched: number
  duration_ms: number
  error: string | null
  /** Raw Trustless Work V1 indexer escrows; normalized before the UPSERT. */
  escrows: unknown[]
}

export interface ReconciliationEscrowRow {
  contract_id: string
  id?: string
  status?: string
  balance?: string
  marker?: string
  approver?: string
}
