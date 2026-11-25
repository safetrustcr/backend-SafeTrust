import {
  getStellarNetwork,
  getStellarConfig,
  validateStellarConfig,
  STELLAR_NETWORKS,
} from '../stellar'

describe('Stellar Configuration', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterAll(() => {
    process.env = originalEnv
  })

  describe('getStellarNetwork', () => {
    it('defaults to testnet when STELLAR_NETWORK is unset', () => {
      delete process.env.STELLAR_NETWORK
      expect(getStellarNetwork()).toBe('testnet')
    })

    it('returns testnet for testnet value', () => {
      process.env.STELLAR_NETWORK = 'testnet'
      expect(getStellarNetwork()).toBe('testnet')
    })

    it('returns mainnet for mainnet or public values', () => {
      process.env.STELLAR_NETWORK = 'mainnet'
      expect(getStellarNetwork()).toBe('mainnet')

      process.env.STELLAR_NETWORK = 'public'
      expect(getStellarNetwork()).toBe('mainnet')
    })
  })

  describe('getStellarConfig', () => {
    it('returns correct constants for testnet', () => {
      process.env.STELLAR_NETWORK = 'testnet'
      const config = getStellarConfig()

      expect(config.network).toBe('testnet')
      expect(config.networkPassphrase).toBe(STELLAR_NETWORKS.testnet.networkPassphrase)
      expect(config.usdcAssetCode).toBe('USDC')
      expect(config.usdcIssuer).toBe('GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5')
      expect(config.usdcContractId).toBe('CBIELTK6YBZJU5UP2WWQEUCYJLPU6QXN54EXSKRMGQGELN7B57H7W5S3')
      expect(config.horizonUrl).toContain('horizon-testnet.stellar.org')
      expect(config.trustlessWorkApiUrl).toContain('dev.api.trustlesswork.com')
    })

    it('returns correct constants for mainnet', () => {
      process.env.STELLAR_NETWORK = 'mainnet'
      const config = getStellarConfig()

      expect(config.network).toBe('mainnet')
      expect(config.networkPassphrase).toBe(STELLAR_NETWORKS.mainnet.networkPassphrase)
      expect(config.usdcAssetCode).toBe('USDC')
      expect(config.usdcIssuer).toBe('GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN')
      expect(config.usdcContractId).toBe('CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75')
      expect(config.horizonUrl).toBe('https://horizon.stellar.org')
      expect(config.trustlessWorkApiUrl).toBe('https://api.trustlesswork.com')
    })

    it('reads platform role addresses from environment', () => {
      process.env.SAFETRUST_PLATFORM_WALLET = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'
      process.env.SAFETRUST_RELEASE_SIGNER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'
      process.env.SAFETRUST_DISPUTE_RESOLVER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'

      const config = getStellarConfig()
      expect(config.platformWallet).toBe('GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5')
      expect(config.releaseSigner).toBe('GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5')
      expect(config.disputeResolver).toBe('GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5')
    })
  })

  describe('validateStellarConfig', () => {
    it('validates a clean testnet configuration', () => {
      process.env.STELLAR_NETWORK = 'testnet'
      const result = validateStellarConfig()
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('flags invalid network name', () => {
      process.env.STELLAR_NETWORK = 'ethereum'
      const result = validateStellarConfig()
      expect(result.valid).toBe(false)
      expect(result.errors[0]).toContain('Invalid STELLAR_NETWORK')
    })

    it('flags invalid Stellar public key format', () => {
      process.env.STELLAR_NETWORK = 'testnet'
      process.env.SAFETRUST_PLATFORM_WALLET = 'invalid_not_stellar_key'
      const result = validateStellarConfig()
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('Invalid Stellar public key'))).toBe(true)
    })

    it('flags cross-network URL pollution', () => {
      process.env.STELLAR_NETWORK = 'mainnet'
      process.env.HORIZON_URL = 'https://horizon-testnet.stellar.org'
      const result = validateStellarConfig()
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('testnet Horizon URL'))).toBe(true)
    })
  })
})
