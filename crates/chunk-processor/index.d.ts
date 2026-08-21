/**
 * One entry per chunk returned by {@link processChunksParallel}. Ordered by
 * `chunkIndex`. Escrow objects in `escrows` are the indexer's response verbatim,
 * so the existing UPSERT keeps writing every field it did before.
 */
export interface ChunkSyncResult {
  chunk_index: number
  /** Number of escrow objects returned for this chunk. */
  fetched: number
  /** Wall-clock time this chunk's request took, in milliseconds. */
  duration_ms: number
  /** Non-null when the chunk failed (HTTP error, timeout, bad shape). */
  error: string | null
  /** Raw escrow objects from the TrustlessWork indexer (empty on error). */
  escrows: unknown[]
}

/**
 * Fetch every chunk of contract IDs from the TrustlessWork indexer concurrently,
 * with bounded parallelism and a hard per-chunk timeout.
 *
 * Chunk isolation: one failed chunk never aborts the others — its failure is
 * captured in `error`. Only a malformed `chunksJson` argument throws.
 *
 * @param chunksJson      JSON-encoded `string[][]` — array of contract-id chunks.
 * @param apiUrl          TrustlessWork base URL.
 * @param apiKey          `x-api-key` value; the header is omitted when empty.
 * @param maxConcurrency  Maximum in-flight chunk requests (clamped to >= 1).
 * @param timeoutMs       Hard per-chunk deadline in milliseconds.
 * @returns JSON-encoded `ChunkSyncResult[]`.
 */
export function processChunksParallel(
  chunksJson: string,
  apiUrl: string,
  apiKey: string,
  maxConcurrency: number,
  timeoutMs: number
): string
