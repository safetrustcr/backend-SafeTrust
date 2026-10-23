import type { ChunkProcessorAddon } from '../reconciliation.types'
import { TW_API_KEY, TW_BASE_URL } from '../source-adapters/tw.adapter'

const CHUNK_PROCESSOR_MODULE = '../../../../crates/chunk-processor'

let chunkProcessor: ChunkProcessorAddon | null = null
let chunkProcessorLoadFailed = false
let chunkProcessorOverride: ChunkProcessorAddon | null | undefined

function envInt(name: string, fallback: number): number {
  const parsed = parseInt(process.env[name] ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function loadChunkProcessor(): ChunkProcessorAddon | null {
  if (chunkProcessorOverride !== undefined) return chunkProcessorOverride
  if (chunkProcessor || chunkProcessorLoadFailed) return chunkProcessor
  try {
    chunkProcessor = require(CHUNK_PROCESSOR_MODULE)
  } catch (err) {
    chunkProcessorLoadFailed = true
    console.error(
      '[reconciliation] ⚠️  chunk-processor addon unavailable — ' +
        `falling back to sequential sync: ${(err as Error).message}`
    )
  }
  return chunkProcessor
}

export function isRustChunkProcessingEnabled(): boolean {
  return process.env.RUST_CHUNKS_ENABLED === 'true'
}

export async function processChunksWithRust(chunks: string[][]): Promise<string> {
  const addon = loadChunkProcessor()
  if (!addon) throw new Error('chunk-processor addon not loaded')
  return addon.processChunksParallel(
    JSON.stringify(chunks),
    TW_BASE_URL,
    TW_API_KEY,
    envInt('CHUNK_CONCURRENCY', 5),
    envInt('CHUNK_TIMEOUT_MS', 5000)
  )
}

export function __setChunkProcessorForTests(
  mock: ChunkProcessorAddon | null | undefined
): void {
  chunkProcessorOverride = mock
  chunkProcessor = null
  chunkProcessorLoadFailed = false
}

export function __resetChunkProcessorForTests(): void {
  chunkProcessorOverride = undefined
  chunkProcessor = null
  chunkProcessorLoadFailed = false
}
