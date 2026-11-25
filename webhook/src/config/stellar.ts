import { StrKey } from '@stellar/stellar-sdk'

export type StellarNetwork = 'testnet' | 'mainnet'

export interface StellarNetworkConfig {
  network: StellarNetwork
  networkPassphrase: string
  horizonUrl: string
  trustlessWorkApiUrl: string
  usdcAssetCode: string
  usdcIssuer: string
  usdcContractId: string
  platformWallet?: string
  releaseSigner?: string
  disputeResolver?: string
}

export const STELLAR_NETWORKS: Record<
  StellarNetwork,
  Omit<StellarNetworkConfig, 'platformWallet' | 'releaseSigner' | 'disputeResolver'>
> = {
  testnet: {
    network: 'testnet',
    networkPassphrase: 'Test SDF Network ; September 2015',
    horizonUrl: 'https://horizon-testnet.stellar.org',
    trustlessWorkApiUrl: 'https://dev.api.trustlesswork.com',
    usdcAssetCode: 'USDC',
    usdcIssuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    usdcContractId: 'CBIELTK6YBZJU5UP2WWQEUCYJLPU6QXN54EXSKRMGQGELN7B57H7W5S3',
  },
  mainnet: {
    network: 'mainnet',
    networkPassphrase: 'Public Global Stellar Network ; September 2015',
    horizonUrl: 'https://horizon.stellar.org',
    trustlessWorkApiUrl: 'https://api.trustlesswork.com',
    usdcAssetCode: 'USDC',
    usdcIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    usdcContractId: 'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75',
  },
}

/**
 * Returns the active Stellar network from environment or defaults to 'testnet'.
 */
export function getStellarNetwork(): StellarNetwork {
  const envNetwork = (process.env.STELLAR_NETWORK || 'testnet').toLowerCase().trim()
  if (envNetwork === 'mainnet' || envNetwork === 'public') {
    return 'mainnet'
  }
  return 'testnet'
}

/**
 * Returns complete Stellar network configuration with platform role addresses.
 */
export function getStellarConfig(): StellarNetworkConfig {
  const network = getStellarNetwork()
  const base = STELLAR_NETWORKS[network]
  return {
    ...base,
    horizonUrl: process.env.HORIZON_URL || base.horizonUrl,
    trustlessWorkApiUrl: process.env.TRUSTLESSWORK_API_URL || base.trustlessWorkApiUrl,
    platformWallet:
      process.env.SAFETRUST_PLATFORM_WALLET || process.env.ESCROW_RELEASER_ADDRESS,
    releaseSigner:
      process.env.SAFETRUST_RELEASE_SIGNER || process.env.ESCROW_RELEASER_ADDRESS,
    disputeResolver:
      process.env.SAFETRUST_DISPUTE_RESOLVER || process.env.ESCROW_RESOLVER_ADDRESS,
  }
}

/**
 * Validates startup configuration for network, public keys, and cross-network contamination.
 */
export function validateStellarConfig(): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  const rawNetwork = process.env.STELLAR_NETWORK
  if (rawNetwork && !['testnet', 'mainnet', 'public'].includes(rawNetwork.toLowerCase().trim())) {
    errors.push(`Invalid STELLAR_NETWORK: "${rawNetwork}". Must be "testnet" or "mainnet".`)
  }

  const config = getStellarConfig()

  const checkAddress = (label: string, addr?: string) => {
    if (addr) {
      if (!StrKey.isValidEd25519PublicKey(addr)) {
        errors.push(`Invalid Stellar public key for ${label}: "${addr}"`)
      }
    }
  }

  checkAddress('SAFETRUST_PLATFORM_WALLET', config.platformWallet)
  checkAddress('SAFETRUST_RELEASE_SIGNER', config.releaseSigner)
  checkAddress('SAFETRUST_DISPUTE_RESOLVER', config.disputeResolver)

  // Cross-network sanity check
  if (config.network === 'mainnet') {
    if (config.horizonUrl.includes('testnet')) {
      errors.push(
        `Configuration mismatch: mainnet configured with testnet Horizon URL: ${config.horizonUrl}`
      )
    }
    if (config.trustlessWorkApiUrl.includes('dev.api')) {
      errors.push(
        `Configuration mismatch: mainnet configured with dev Trustless Work API: ${config.trustlessWorkApiUrl}`
      )
    }
  } else if (config.network === 'testnet') {
    if (config.horizonUrl === 'https://horizon.stellar.org') {
      errors.push(
        `Configuration mismatch: testnet configured with public mainnet Horizon URL: ${config.horizonUrl}`
      )
    }
    if (config.trustlessWorkApiUrl === 'https://api.trustlesswork.com') {
      errors.push(
        `Configuration mismatch: testnet configured with production Trustless Work API: ${config.trustlessWorkApiUrl}`
      )
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}
