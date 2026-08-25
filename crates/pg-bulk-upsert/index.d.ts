/** Result of a single bulk UPSERT, returned as JSON by {@link bulkUpsertEscrows}. */
export interface BulkUpsertResult {
  /** Rows actually inserted or updated (equals the row-by-row `updated` count). */
  rows_affected: number
  /** Rows present but identical, skipped by the `IS DISTINCT FROM` guard. */
  unchanged: number
  /** Wall-clock time the statement took, in milliseconds. */
  duration_ms: number
}

/** One escrow row to upsert. Numeric fields are passed as strings so that
 *  `DECIMAL(20,7)` values keep their exact form. */
export interface EscrowUpdate {
  contract_id: string
  status: string
  amount: string
  balance: string
  marker: string
  approver: string
  releaser: string
  escrow_type: string
}

/**
 * Upsert a batch of escrow rows into `public.trustless_work_escrows` with a
 * single `INSERT ... ON CONFLICT DO UPDATE` statement fed by `UNNEST` arrays.
 *
 * The `IS DISTINCT FROM` guard leaves unchanged rows untouched, so
 * `rows_affected` counts only real changes and `unchanged = total - rows_affected`.
 * Duplicate `contract_id`s within one call are de-duplicated (last write wins).
 *
 * Returns a Promise and does not block the Node.js event loop. The promise
 * rejects for a malformed `updatesJson` or a connect/query failure, so the caller
 * can fall back to the row-by-row path.
 *
 * @param updatesJson JSON-encoded {@link EscrowUpdate}[].
 * @param connString  PostgreSQL connection string (NoTls).
 * @returns Promise resolving to a JSON-encoded {@link BulkUpsertResult}.
 */
export function bulkUpsertEscrows(updatesJson: string, connString: string): Promise<string>
