import {
  validateStellarAddress,
  resolveStellarNetwork,
  getX402Config,
  createFacilitatorClient,
  buildX402ResourceServer,
  X402_PRICE,
  DEFAULT_TESTNET_FACILITATOR_URL,
} from '../x402'

describe('x402 config module', () => {
  const originalEnv = process.env
  const validStellarAddress = 'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57'

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterAll(() => {
    process.env = originalEnv
  })

  describe('validateStellarAddress', () => {
    it('returns true for a valid Ed25519 public key', () => {
      expect(validateStellarAddress(validStellarAddress)).toBe(true)
    })

    it('returns false for obvious placeholder', () => {
      expect(validateStellarAddress('G_YOUR_PLATFORM_WALLET_PUBLIC_KEY')).toBe(false)
    })

    it('returns false for invalid addresses or non-strings', () => {
      expect(validateStellarAddress('')).toBe(false)
      expect(validateStellarAddress('not-an-address')).toBe(false)
      expect(validateStellarAddress('CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA')).toBe(false) // Contract ID, not G account
      expect(validateStellarAddress(undefined as any)).toBe(false)
    })
  })

  describe('resolveStellarNetwork', () => {
    it('resolves testnet variants to stellar:testnet', () => {
      expect(resolveStellarNetwork('testnet')).toBe('stellar:testnet')
      expect(resolveStellarNetwork('stellar:testnet')).toBe('stellar:testnet')
    })

    it('resolves mainnet/pubnet variants to stellar:pubnet', () => {
      expect(resolveStellarNetwork('mainnet')).toBe('stellar:pubnet')
      expect(resolveStellarNetwork('pubnet')).toBe('stellar:pubnet')
      expect(resolveStellarNetwork('stellar:pubnet')).toBe('stellar:pubnet')
      expect(resolveStellarNetwork('stellar:mainnet')).toBe('stellar:pubnet')
    })

    it('defaults to stellar:testnet when unset', () => {
      delete process.env.STELLAR_NETWORK
      expect(resolveStellarNetwork()).toBe('stellar:testnet')
    })
  })

  describe('getX402Config', () => {
    it('does not throw when X402_ENABLED is false even if wallet is placeholder or missing', () => {
      process.env.X402_ENABLED = 'false'
      process.env.SAFETRUST_PLATFORM_WALLET = 'G_YOUR_PLATFORM_WALLET_PUBLIC_KEY'
      const config = getX402Config()
      expect(config.enabled).toBe(false)
      expect(config.price).toBe(X402_PRICE)
    })

    it('throws when X402_ENABLED is true and wallet is placeholder', () => {
      process.env.X402_ENABLED = 'true'
      process.env.SAFETRUST_PLATFORM_WALLET = 'G_YOUR_PLATFORM_WALLET_PUBLIC_KEY'
      expect(() => getX402Config()).toThrow(/Invalid or missing SAFETRUST_PLATFORM_WALLET/)
    })

    it('throws when X402_ENABLED is true and wallet is empty', () => {
      process.env.X402_ENABLED = 'true'
      delete process.env.SAFETRUST_PLATFORM_WALLET
      expect(() => getX402Config()).toThrow(/Invalid or missing SAFETRUST_PLATFORM_WALLET/)
    })

    it('throws on mainnet startup when X402_ENABLED is true and facilitator URL is missing', () => {
      process.env.X402_ENABLED = 'true'
      process.env.STELLAR_NETWORK = 'mainnet'
      process.env.SAFETRUST_PLATFORM_WALLET = validStellarAddress
      delete process.env.X402_FACILITATOR_URL

      expect(() => getX402Config()).toThrow(/Mainnet \(stellar:pubnet\) requires X402_FACILITATOR_URL/)
    })

    it('succeeds on testnet with valid wallet and defaults facilitator URL', () => {
      process.env.X402_ENABLED = 'true'
      process.env.STELLAR_NETWORK = 'testnet'
      process.env.SAFETRUST_PLATFORM_WALLET = validStellarAddress
      delete process.env.X402_FACILITATOR_URL

      const config = getX402Config()
      expect(config.enabled).toBe(true)
      expect(config.network).toBe('stellar:testnet')
      expect(config.facilitatorUrl).toBe(DEFAULT_TESTNET_FACILITATOR_URL)
      expect(config.payTo).toBe(validStellarAddress)
      expect(config.price).toBe('$0.10')
    })

    it('succeeds on mainnet when facilitator URL is explicitly provided', () => {
      process.env.X402_ENABLED = 'true'
      process.env.STELLAR_NETWORK = 'mainnet'
      process.env.SAFETRUST_PLATFORM_WALLET = validStellarAddress
      process.env.X402_FACILITATOR_URL = 'https://channels.openzeppelin.com/x402'
      process.env.X402_FACILITATOR_API_KEY = 'test-api-key'

      const config = getX402Config()
      expect(config.enabled).toBe(true)
      expect(config.network).toBe('stellar:pubnet')
      expect(config.facilitatorUrl).toBe('https://channels.openzeppelin.com/x402')
      expect(config.facilitatorApiKey).toBe('test-api-key')
    })
  })

  describe('createFacilitatorClient and auth headers', () => {
    it('creates HTTPFacilitatorClient with auth headers when API key is provided', async () => {
      const client = createFacilitatorClient('https://example.com/facilitator', 'my-secret-key')
      expect(client.url).toBe('https://example.com/facilitator')

      // Check createAuthHeaders
      const auth = (client as any)._createAuthHeaders
      expect(auth).toBeDefined()
      const headers = await auth()
      expect(headers).toEqual({
        verify: { Authorization: 'Bearer my-secret-key' },
        settle: { Authorization: 'Bearer my-secret-key' },
        supported: { Authorization: 'Bearer my-secret-key' },
      })
    })

    it('creates HTTPFacilitatorClient without auth headers when API key is omitted', () => {
      const client = createFacilitatorClient('https://example.com/facilitator')
      const auth = (client as any)._createAuthHeaders
      expect(auth).toBeUndefined()
    })
  })

  describe('buildX402ResourceServer', () => {
    it('registers ExactStellarScheme for the configured network', () => {
      const client = createFacilitatorClient('https://example.com/facilitator')
      const server = buildX402ResourceServer(client, 'stellar:testnet')
      expect(server).toBeDefined()
    })
  })
})
