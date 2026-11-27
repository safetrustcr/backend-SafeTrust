import https from 'https'
import http from 'http'
import { logger } from '../../middleware/logger'
import { readSecret } from '../../config/secrets'
import type { TwIndexerEscrow } from './tw-indexer.types'

// ── Configuration ──────────────────────────────────────────────────────────────
//
// TRUSTLESSWORK_API_URL / TRUSTLESSWORK_API_KEY are the names docker-compose
// passes to the container. The earlier TRUSTLESS_WORK_API_* spelling is still
// read, with a warning, so an existing .env keeps working until it is renamed.

export const DEFAULT_TRUSTLESSWORK_API_URL = 'https://dev.api.trustlesswork.com'

const warnedLegacyNames = new Set<string>()

function readSetting(name: string, legacyName: string): string | undefined {
  // readSecret prefers <NAME>_FILE (/run/secrets/…) and falls back to <NAME>.
  const value = readSecret(name)?.trim()
  if (value) return value

  const legacy = readSecret(legacyName)?.trim()
  if (legacy) {
    if (!warnedLegacyNames.has(legacyName)) {
      warnedLegacyNames.add(legacyName)
      logger.warn('trustlesswork.legacy_env_name', { legacyName, name })
    }
    return legacy
  }
  return undefined
}

/** Trustless Work API base URL, without a trailing slash. */
export function getTrustlessWorkApiUrl(): string {
  const url = readSetting('TRUSTLESSWORK_API_URL', 'TRUSTLESS_WORK_API_URL') ?? DEFAULT_TRUSTLESSWORK_API_URL
  return url.replace(/\/+$/, '')
}

/** Trustless Work API key sent as `x-api-key`; empty when not configured. */
export function getTrustlessWorkApiKey(): string {
  return readSetting('TRUSTLESSWORK_API_KEY', 'TRUSTLESS_WORK_API_KEY') ?? ''
}

/** Test seam: forget which legacy names were already reported. */
export function __resetTrustlessWorkConfigWarningsForTests(): void {
  warnedLegacyNames.clear()
}

// ── Indexer read ───────────────────────────────────────────────────────────────

/** Trustless Work V1 indexer read (trustless-work-dev skill, skills/api/*-release-escrow.md). */
export const INDEXER_PATH = '/helper/get-escrow-by-contract-ids'

/**
 * Query string for one chunk: one `contractIds` pair per id (the parameter is
 * a `string[]`) and `validateOnChain=true`, so the indexer checks its copy
 * against the contract before answering.
 */
export function buildIndexerUrl(baseUrl: string, contractIds: string[]): string {
  const params = new URLSearchParams()
  for (const id of contractIds) params.append('contractIds', id)
  params.append('validateOnChain', 'true')
  return `${baseUrl}${INDEXER_PATH}?${params.toString()}`
}

function httpGet(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const transport = parsed.protocol === 'https:' ? https : http
    const apiKey = getTrustlessWorkApiKey()

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: `${parsed.pathname}${parsed.search}`,
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'x-api-key': apiKey } : {}),
        ...headers,
      },
    }

    const req = transport.request(options, (res) => {
      let raw = ''
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => { raw += chunk })
      res.on('end', () => {
        if (res.statusCode! < 200 || res.statusCode! >= 300) {
          return reject(
            new Error(
              `TrustlessWork API responded with status ${res.statusCode}: ${raw}`
            )
          )
        }
        try {
          resolve(JSON.parse(raw))
        } catch (e) {
          reject(new Error(`Failed to parse TrustlessWork API response: ${(e as Error).message}`))
        }
      })
    })

    req.on('error', reject)
    req.setTimeout(30_000, () => {
      req.destroy(new Error('TrustlessWork API request timed out after 30 s'))
    })
    req.end()
  })
}

/**
 * Raw V1 indexer escrows for the given contract ids. The caller normalizes
 * them with `normalizeIndexerEscrows` before writing.
 */
export async function fetchEscrowsByContractIds(contractIds: string[]): Promise<TwIndexerEscrow[]> {
  const data = await httpGet(buildIndexerUrl(getTrustlessWorkApiUrl(), contractIds))

  if (Array.isArray(data)) return data as TwIndexerEscrow[]
  if (data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>).escrows)) {
    return (data as Record<string, unknown>).escrows as TwIndexerEscrow[]
  }

  throw new Error(
    `Unexpected TrustlessWork API response shape: ${JSON.stringify(data).slice(0, 200)}`
  )
}
