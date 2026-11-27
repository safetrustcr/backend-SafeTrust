import { Request, Response, NextFunction } from 'express'
import {
  requireX402Payment,
  setX402Engine,
} from '../x402-payment.middleware'

describe('x402-payment.middleware', () => {
  let req: any
  let res: any
  let next: jest.Mock

  beforeEach(() => {
    req = {
      headers: {},
    }
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
    }
    next = jest.fn()
    delete process.env.STELLAR_NETWORK
    delete process.env.X402_FACILITATOR_URL
    process.env.SAFETRUST_PLATFORM_WALLET = 'GTESTPLATFORMWALLET'
    process.env.X402_ENABLED = 'true'
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  it('returns 503 when x402 is disabled', async () => {
    process.env.X402_ENABLED = 'false'
    setX402Engine(null)

    await requireX402Payment(0.10)(req as Request, res as Response, next as NextFunction)

    expect(res.status).toHaveBeenCalledWith(503)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: 'Feature Unavailable',
      feature: 'x402',
    }))
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 503 when the platform wallet is missing', async () => {
    const mockBuildRequirement = jest.fn()
    setX402Engine({
      validateX402Payment: jest.fn(),
      buildPaymentRequirement: mockBuildRequirement,
    })
    delete process.env.SAFETRUST_PLATFORM_WALLET

    await requireX402Payment(0.10)(req as Request, res as Response, next as NextFunction)

    expect(res.status).toHaveBeenCalledWith(503)
    expect(res.json).toHaveBeenCalledWith({
      error: 'Feature Unavailable',
      feature: 'x402',
      message: 'x402 platform wallet is not configured',
    })
    expect(mockBuildRequirement).not.toHaveBeenCalled()
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 503 when the platform wallet contains only whitespace', async () => {
    const mockBuildRequirement = jest.fn()
    setX402Engine({
      validateX402Payment: jest.fn(),
      buildPaymentRequirement: mockBuildRequirement,
    })
    process.env.SAFETRUST_PLATFORM_WALLET = '   '

    await requireX402Payment(0.10)(req as Request, res as Response, next as NextFunction)

    expect(res.status).toHaveBeenCalledWith(503)
    expect(res.json).toHaveBeenCalledWith({
      error: 'Feature Unavailable',
      feature: 'x402',
      message: 'x402 platform wallet is not configured',
    })
    expect(mockBuildRequirement).not.toHaveBeenCalled()
    expect(next).not.toHaveBeenCalled()
  })

  describe('Missing X-Payment Header (402 Payment Required)', () => {
    it('returns 503 when no addon is loaded', async () => {
      setX402Engine(null)
      const middleware = requireX402Payment(0.10)
      await middleware(req as Request, res as Response, next as NextFunction)

      expect(res.status).toHaveBeenCalledWith(503)
      expect(res.json).toHaveBeenCalledWith({
        error: 'Feature Unavailable',
        feature: 'x402',
        message: 'x402 payment processor is unavailable',
      })
      expect(next).not.toHaveBeenCalled()
    })

    it('returns 402 with mainnet requirement when STELLAR_NETWORK=mainnet', async () => {
      process.env.STELLAR_NETWORK = 'mainnet'
      setX402Engine({
        validateX402Payment: jest.fn(),
        buildPaymentRequirement: jest.fn().mockReturnValue(JSON.stringify({
          scheme: 'exact',
          network: 'stellar:mainnet',
          max_amount_usdc: 0.25,
          asset: {
            code: 'USDC',
            contract: 'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75',
            issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
          },
          facilitator_url: 'https://channels.openzeppelin.com/x402',
        })),
      })
      const middleware = requireX402Payment(0.25)
      await middleware(req as Request, res as Response, next as NextFunction)

      expect(res.status).toHaveBeenCalledWith(402)
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Payment Required',
          x402Version: 2,
          accepts: [
            expect.objectContaining({
              scheme: 'exact',
              network: 'stellar:mainnet',
              max_amount_usdc: 0.25,
              asset: expect.objectContaining({
                code: 'USDC',
                contract: 'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75',
                issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
              }),
              facilitator_url: 'https://channels.openzeppelin.com/x402',
            }),
          ],
        })
      )
    })

    it('uses buildPaymentRequirement from addon when available', async () => {
      const mockBuildRequirement = jest.fn().mockReturnValue(
        JSON.stringify({
          scheme: 'exact',
          network: 'stellar:testnet',
          max_amount_usdc: 0.10,
          asset: {
            code: 'USDC',
            contract: 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA',
            issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
          },
          facilitator_url: 'https://channels.openzeppelin.com/x402/testnet',
          pay_to: 'GPLATFORM',
          description: 'SafeTrust booking fee',
        })
      )

      setX402Engine({
        validateX402Payment: jest.fn(),
        buildPaymentRequirement: mockBuildRequirement,
      })

      const middleware = requireX402Payment(0.10)
      await middleware(req as Request, res as Response, next as NextFunction)

      expect(mockBuildRequirement).toHaveBeenCalledWith(
        0.10,
        'stellar:testnet',
        'https://channels.openzeppelin.com/x402/testnet',
        'GTESTPLATFORMWALLET'
      )
      expect(res.status).toHaveBeenCalledWith(402)
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Payment Required',
          x402Version: 2,
          accepts: [
            expect.objectContaining({
              pay_to: 'GPLATFORM',
            }),
          ],
        })
      )
      // The same challenge is exposed to v2 clients as base64 JSON.
      expect(res.set).toHaveBeenCalledWith(
        'PAYMENT-REQUIRED',
        expect.any(String)
      )
    })
  })

  describe('Invalid X-Payment Header', () => {
    it('returns 402 with invalid_reason when validateX402Payment returns is_valid: false', async () => {
      setX402Engine({
        validateX402Payment: jest.fn().mockReturnValue(
          JSON.stringify({
            is_valid: false,
            payer_address: null,
            amount_usdc: 0,
            network: '',
            invalid_reason: 'Invalid X-Payment header format — must start with \'x402 \'',
          })
        ),
        buildPaymentRequirement: jest.fn(),
      })

      req.headers['x-payment'] = 'invalid-header-format'
      const middleware = requireX402Payment(0.10)
      await middleware(req as Request, res as Response, next as NextFunction)

      expect(res.status).toHaveBeenCalledWith(402)
      expect(res.json).toHaveBeenCalledWith({
        error: 'Invalid x402 payment',
        invalid_reason: 'Invalid X-Payment header format — must start with \'x402 \'',
        x402Version: 2,
      })
      expect(next).not.toHaveBeenCalled()
    })

    it('returns 402 when network is unsupported', async () => {
      setX402Engine({
        validateX402Payment: jest.fn().mockReturnValue(
          JSON.stringify({
            is_valid: false,
            payer_address: null,
            amount_usdc: 0,
            network: 'ethereum:1',
            invalid_reason: 'Unsupported network: \'ethereum:1\' — SafeTrust only accepts Stellar payments',
          })
        ),
        buildPaymentRequirement: jest.fn(),
      })

      req.headers['x-payment'] = 'x402 eyJzY2hlbWUiOiJleGFjdCIsIm5ldHdvcmsiOiJldGhlcmV1bToxIn0='
      const middleware = requireX402Payment(0.10)
      await middleware(req as Request, res as Response, next as NextFunction)

      expect(res.status).toHaveBeenCalledWith(402)
      expect(res.json).toHaveBeenCalledWith({
        error: 'Invalid x402 payment',
        invalid_reason: 'Unsupported network: \'ethereum:1\' — SafeTrust only accepts Stellar payments',
        x402Version: 2,
      })
    })

    it('returns 402 when payment amount is insufficient', async () => {
      setX402Engine({
        validateX402Payment: jest.fn().mockReturnValue(
          JSON.stringify({
            is_valid: false,
            payer_address: null,
            amount_usdc: 0.05,
            network: 'stellar:testnet',
            invalid_reason: 'Insufficient payment: 0.05 USDC < required 0.1 USDC',
          })
        ),
        buildPaymentRequirement: jest.fn(),
      })

      req.headers['x-payment'] = 'x402 eyJhbW91bnQiOjAuMDV9'
      const middleware = requireX402Payment(0.10)
      await middleware(req as Request, res as Response, next as NextFunction)

      expect(res.status).toHaveBeenCalledWith(402)
      expect(res.json).toHaveBeenCalledWith({
        error: 'Invalid x402 payment',
        invalid_reason: 'Insufficient payment: 0.05 USDC < required 0.1 USDC',
        x402Version: 2,
      })
    })
  })

  describe('Valid X-Payment Header (Success Flow)', () => {
    it('populates req.x402 and calls next() on valid payment', async () => {
      setX402Engine({
        validateX402Payment: jest.fn().mockReturnValue(
          JSON.stringify({
            is_valid: true,
            payer_address: 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ',
            amount_usdc: 0.10,
            network: 'stellar:testnet',
            invalid_reason: null,
          })
        ),
        buildPaymentRequirement: jest.fn(),
      })

      req.headers['x-payment'] = 'x402 valid-b64-payload'
      const middleware = requireX402Payment(0.10)
      await middleware(req as Request, res as Response, next as NextFunction)

      expect(next).toHaveBeenCalled()
      expect(res.status).not.toHaveBeenCalled()
      expect(req.x402).toEqual({
        payer: 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ',
        amountUsdc: 0.10,
        network: 'stellar:testnet',
        paymentHeader: 'x402 valid-b64-payload',
      })
    })
  })

  describe('Error Handling', () => {
    it('returns 500 when an unexpected exception occurs during validation', async () => {
      setX402Engine({
        validateX402Payment: jest.fn().mockImplementation(() => {
          throw new Error('Fatal native exception')
        }),
        buildPaymentRequirement: jest.fn(),
      })

      req.headers['x-payment'] = 'x402 valid-payload'
      const middleware = requireX402Payment(0.10)
      await middleware(req as Request, res as Response, next as NextFunction)

      expect(res.status).toHaveBeenCalledWith(500)
      expect(res.json).toHaveBeenCalledWith({
        error: 'Payment validation failed',
      })
      expect(next).not.toHaveBeenCalled()
    })
  })
})
