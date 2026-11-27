import { StrKey } from '@stellar/stellar-sdk'
import {
  HTTPFacilitatorClient,
  x402ResourceServer,
  FacilitatorClient,
} from '@x402/core/server'
import { ExactStellarScheme } from '@x402/stellar/exact/server'
import { Network } from '@x402/core/types'

export const X402_PRICE = '$0.10'
export const DEFAULT_TESTNET_FACILITATOR_URL = 'https://x402.org/facilitator'

export type StellarPaymentNetwork = 'stellar:testnet' | 'stellar:pubnet'

export interface X402Context {
  payer?: string | null
  amountUsdc: number
  network: string
  /**
   * Raw X-Payment header that was verified for this request. Set by the
   * booking-fee gate so the fee can be settled and receipted idempotently.
   */
  paymentHeader?: string
}

declare global {
  namespace Express {
    interface Request {
      x402?: X402Context
    }
  }
}

/**
 * Bounded cache of payers seen by the resource server, consumed by routes that
 * only carry the payment payload. Entries are dropped on consumption; the cap
 * keeps a long-lived process from accumulating proofs that are never consumed
 * (every hold and booking verification lands here).
 */
const MAX_VERIFIED_PAYERS = 100
const verifiedPayers = new Map<string, string | null>()

export function consumeVerifiedPayer(paymentSignatureHeader: string | undefined): string | null {
  if (!paymentSignatureHeader) return null
  try {
    const decoded = JSON.parse(Buffer.from(paymentSignatureHeader, 'base64').toString('utf8')) as {
      payload?: unknown
    }
    const key = JSON.stringify(decoded.payload ?? null)
    const payer = verifiedPayers.get(key) ?? null
    verifiedPayers.delete(key)
    return payer
  } catch {
    return null
  }
}

export interface X402Config {
  enabled: boolean
  network: StellarPaymentNetwork
  facilitatorUrl: string
  facilitatorApiKey?: string
  price: string
  payTo: string
}

/**
 * Validates a Stellar Ed25519 public key (G...).
 * Non-address placeholders like 'G_YOUR_PLATFORM_WALLET_PUBLIC_KEY' return false.
 */
export function validateStellarAddress(address: string): boolean {
  if (!address || typeof address !== 'string') return false
  const trimmed = address.trim()
  try {
    return StrKey.isValidEd25519PublicKey(trimmed)
  } catch {
    return false
  }
}

/**
 * Resolves the CAIP-2 Stellar network from environment settings.
 */
export function resolveStellarNetwork(rawNetwork?: string): StellarPaymentNetwork {
  const net = (rawNetwork ?? process.env.STELLAR_NETWORK ?? 'testnet').trim().toLowerCase()
  if (net === 'mainnet' || net === 'pubnet' || net === 'stellar:pubnet' || net === 'stellar:mainnet') {
    return 'stellar:pubnet'
  }
  return 'stellar:testnet'
}

/**
 * Loads, normalizes, and validates the x402 payment configuration from process.env.
 * On mainnet (stellar:pubnet), fails startup if the facilitator URL or network is missing.
 * When enabled, fails startup if SAFETRUST_PLATFORM_WALLET is missing or not a valid Stellar address.
 */
export function getX402Config(): X402Config {
  const enabled = process.env.X402_ENABLED === 'true'
  const network = resolveStellarNetwork(process.env.STELLAR_NETWORK || process.env.X402_NETWORK)

  const facilitatorApiKey = process.env.X402_FACILITATOR_API_KEY?.trim() || undefined
  const rawFacilitatorUrl = process.env.X402_FACILITATOR_URL?.trim()
  const facilitatorUrl = rawFacilitatorUrl || (network === 'stellar:testnet' ? DEFAULT_TESTNET_FACILITATOR_URL : '')

  const payTo = process.env.SAFETRUST_PLATFORM_WALLET?.trim() || ''

  if (enabled) {
    if (!payTo || !validateStellarAddress(payTo)) {
      throw new Error(
        `[x402] Invalid or missing SAFETRUST_PLATFORM_WALLET: '${payTo}'. Must be a valid Stellar public key (G...).`
      )
    }

    if (network === 'stellar:pubnet') {
      if (!facilitatorUrl) {
        throw new Error(
          '[x402] Mainnet (stellar:pubnet) requires X402_FACILITATOR_URL to be explicitly configured.'
        )
      }
      if (!rawFacilitatorUrl && !process.env.X402_FACILITATOR_URL) {
        throw new Error(
          '[x402] Mainnet (stellar:pubnet) requires X402_FACILITATOR_URL to be explicitly set.'
        )
      }
    }
  }

  return {
    enabled,
    network,
    facilitatorUrl,
    facilitatorApiKey,
    price: X402_PRICE,
    payTo,
  }
}

/**
 * Creates an HTTPFacilitatorClient configured with optional authentication headers.
 */
export function createFacilitatorClient(
  facilitatorUrl: string,
  apiKey?: string,
  timeoutMs = 15000
): HTTPFacilitatorClient {
  const config: {
    url: string
    timeoutMs: number
    createAuthHeaders?: () => Promise<{
      verify?: Record<string, string>
      settle?: Record<string, string>
      supported?: Record<string, string>
    }>
  } = {
    url: facilitatorUrl,
    timeoutMs,
  }

  if (apiKey) {
    config.createAuthHeaders = async () => {
      const headers = { Authorization: `Bearer ${apiKey}` }
      return {
        verify: headers,
        settle: headers,
        supported: headers,
      }
    }
  }

  return new HTTPFacilitatorClient(config)
}

/**
 * Builds an x402ResourceServer registered with the ExactStellarScheme for the configured network.
 */
export function buildX402ResourceServer(
  facilitatorClient: FacilitatorClient,
  network: Network
): x402ResourceServer {
  const server = new x402ResourceServer(facilitatorClient)
  server.register(network, new ExactStellarScheme())
  server.onAfterVerify(async (ctx) => {
    if (!ctx.result.isValid) return
    const key = JSON.stringify(ctx.paymentPayload.payload ?? null)
    // Re-inserting keeps the entry recent; the oldest key is evicted first
    // (Map preserves insertion order).
    verifiedPayers.delete(key)
    while (verifiedPayers.size >= MAX_VERIFIED_PAYERS) {
      const oldest = verifiedPayers.keys().next().value
      if (oldest === undefined) break
      verifiedPayers.delete(oldest)
    }
    verifiedPayers.set(key, ctx.result.payer ?? null)
  })

  // Seed default supported response so requirements can always be generated
  // even before initialize() resolves or in isolated test environments.
  const defaultSupported = {
    kinds: [
      {
        x402Version: 2 as const,
        scheme: 'exact',
        network,
        extra: { areFeesSponsored: true },
      },
    ],
    extensions: [],
    signers: {},
  }
  const versionMap = new Map()
  const networkMap = new Map()
  networkMap.set('exact', defaultSupported)
  versionMap.set(network, networkMap)
  // @ts-expect-error accessing internal map for offline resilience
  server.supportedResponsesMap.set(2, versionMap)
  const clientVersionMap = new Map()
  const clientNetworkMap = new Map()
  clientNetworkMap.set('exact', facilitatorClient)
  clientVersionMap.set(network, clientNetworkMap)
  // @ts-expect-error accessing internal map for offline resilience
  server.facilitatorClientsMap.set(2, clientVersionMap)

  return server
}

// Global resource server instance with test injection seam
let cachedResourceServer: x402ResourceServer | null = null

/**
 * Test seam: allow tests to inject a mock resource server.
 */
export function setX402ResourceServer(server: x402ResourceServer | null): void {
  cachedResourceServer = server
}

/**
 * Gets or creates the active x402ResourceServer instance.
 */
export function getActiveX402ResourceServer(): x402ResourceServer {
  if (cachedResourceServer) {
    return cachedResourceServer
  }

  const config = getX402Config()
  const facilitatorClient = createFacilitatorClient(
    config.facilitatorUrl,
    config.facilitatorApiKey
  )
  cachedResourceServer = buildX402ResourceServer(facilitatorClient, config.network)
  return cachedResourceServer
}

/**
 * Initializes the resource server with the facilitator's supported kinds.
 */
export async function initializeX402ResourceServer(server?: x402ResourceServer): Promise<x402ResourceServer> {
  const targetServer = server ?? getActiveX402ResourceServer()
  await targetServer.initialize()
  return targetServer
}

