export interface EscrowRoles {
  marker?: string
  approver?: string
  releaser?: string
}

export interface EscrowRecord {
  contractId: string
  status?: string
  amount?: string | number
  balance?: string | number
  escrowType?: string
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
  escrows: EscrowRecord[]
}

export interface ReconciliationEscrowRow {
  contract_id: string
  id?: string
  status?: string
  balance?: string
  marker?: string
  approver?: string
}
