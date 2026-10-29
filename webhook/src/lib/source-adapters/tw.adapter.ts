import https from 'https'
import http from 'http'
import type { EscrowRecord } from '../reconciliation.types'

export const TW_BASE_URL =
  process.env.TRUSTLESS_WORK_API_URL || 'https://dev.api.trustlesswork.com'
export const TW_API_KEY = process.env.TRUSTLESS_WORK_API_KEY || ''

function httpGet(url: string, headers: Record<string, string> = {}): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const transport = parsed.protocol === 'https:' ? https : http

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: `${parsed.pathname}${parsed.search}`,
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(TW_API_KEY ? { 'x-api-key': TW_API_KEY } : {}),
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

export async function fetchEscrowsByContractIds(contractIds: string[]): Promise<EscrowRecord[]> {
  const qs = encodeURIComponent(contractIds.join(','))
  const url = `${TW_BASE_URL}/helper/get-escrows-by-contract-ids?contractIds=${qs}`
  const data = await httpGet(url)

  if (Array.isArray(data)) return data as unknown as EscrowRecord[]
  if (Array.isArray((data as Record<string, unknown>).escrows)) {
    return (data as Record<string, unknown>).escrows as EscrowRecord[]
  }

  throw new Error(
    `Unexpected TrustlessWork API response shape: ${JSON.stringify(data).slice(0, 200)}`
  )
}
