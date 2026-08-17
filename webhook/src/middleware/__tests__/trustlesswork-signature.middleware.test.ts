import crypto from 'crypto'
import { verifyTrustlessWorkSignature } from '../trustlesswork-signature.middleware'

const SECRET = 'dev-secret'

function sign(secret: string, timestamp: string, rawBody: Buffer): string {
  const payload = Buffer.concat([Buffer.from(timestamp, 'utf8'), Buffer.from('.'), rawBody])
  const hmac = crypto.createHmac('sha256', secret).update(payload).digest('hex')
  return `sha256=${hmac}`
}

describe('verifyTrustlessWorkSignature', () => {
  let req: any
  let res: any
  let next: jest.Mock
  const rawBody = Buffer.from(JSON.stringify({ contractId: 'escrow-1', status: 'funded' }))

  beforeEach(() => {
    req = {
      headers: {
        'x-trustlesswork-timestamp': String(Date.now()),
      },
      rawBody,
    }
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    }
    next = jest.fn()
    process.env.TRUSTLESSWORK_WEBHOOK_SECRET = SECRET
  })

  afterEach(() => {
    delete process.env.TRUSTLESSWORK_WEBHOOK_SECRET
    jest.clearAllMocks()
  })

  it('calls next() when the signature is valid', () => {
    req.headers['x-trustlesswork-signature'] = sign(
      SECRET,
      req.headers['x-trustlesswork-timestamp'],
      rawBody
    )

    verifyTrustlessWorkSignature(req, res, next)

    expect(next).toHaveBeenCalled()
    expect(res.status).not.toHaveBeenCalled()
  })

  it('returns 401 with the exact error message when the header is missing', () => {
    delete req.headers['x-trustlesswork-timestamp']
    verifyTrustlessWorkSignature(req, res, next)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({
      error: 'Missing x-trustlesswork-signature header',
    })
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 401 when the timestamp header is missing', () => {
    req.headers['x-trustlesswork-signature'] = sign(SECRET, String(Date.now()), rawBody)
    delete req.headers['x-trustlesswork-timestamp']

    verifyTrustlessWorkSignature(req, res, next)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({
      error: 'Missing TrustlessWork signature headers',
    })
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 401 when the timestamp is older than 5 minutes', () => {
    const timestamp = String(Date.now() - 6 * 60 * 1_000)
    req.headers['x-trustlesswork-timestamp'] = timestamp
    req.headers['x-trustlesswork-signature'] = sign(SECRET, timestamp, rawBody)

    verifyTrustlessWorkSignature(req, res, next)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({
      error: 'Webhook timestamp expired or invalid',
    })
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 401 when the timestamp is more than 5 minutes in the future', () => {
    const timestamp = String(Date.now() + 6 * 60 * 1_000)
    req.headers['x-trustlesswork-timestamp'] = timestamp
    req.headers['x-trustlesswork-signature'] = sign(SECRET, timestamp, rawBody)

    verifyTrustlessWorkSignature(req, res, next)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({
      error: 'Webhook timestamp expired or invalid',
    })
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 401 when the timestamp is not a complete decimal millisecond value', () => {
    req.headers['x-trustlesswork-timestamp'] = `${Date.now()}abc`
    req.headers['x-trustlesswork-signature'] = sign(SECRET, req.headers['x-trustlesswork-timestamp'], rawBody)

    verifyTrustlessWorkSignature(req, res, next)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({
      error: 'Webhook timestamp expired or invalid',
    })
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 401 when the timestamp is not a number', () => {
    req.headers['x-trustlesswork-signature'] = sign(SECRET, 'not-a-timestamp', rawBody)
    req.headers['x-trustlesswork-timestamp'] = 'not-a-timestamp'

    verifyTrustlessWorkSignature(req, res, next)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({
      error: 'Webhook timestamp expired or invalid',
    })
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 401 with the exact error message when the signature is wrong', () => {
    req.headers['x-trustlesswork-signature'] = sign(
      'a-different-secret',
      req.headers['x-trustlesswork-timestamp'],
      rawBody
    )

    verifyTrustlessWorkSignature(req, res, next)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid webhook signature' })
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 401 when the signature is malformed instead of throwing', () => {
    req.headers['x-trustlesswork-signature'] = 'not-a-valid-signature'

    expect(() => verifyTrustlessWorkSignature(req, res, next)).not.toThrow()
    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid webhook signature' })
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 401 when the payload was tampered with after signing', () => {
    req.headers['x-trustlesswork-signature'] = sign(
      SECRET,
      req.headers['x-trustlesswork-timestamp'],
      rawBody
    )
    // Simulate a forged body that arrives with a signature computed over a
    // different (legitimate-looking) payload.
    req.rawBody = Buffer.from(JSON.stringify({ contractId: 'escrow-1', status: 'completed' }))

    verifyTrustlessWorkSignature(req, res, next)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid webhook signature' })
    expect(next).not.toHaveBeenCalled()
  })

  it('calls next() for invalid UTF-8 payload bytes with a matching signature', () => {
    const invalidUtf8 = Buffer.from([0xff, 0xfe, 0x00, 0x80, 0x7b])
    req.rawBody = invalidUtf8
    req.headers['x-trustlesswork-signature'] = sign(
      SECRET,
      req.headers['x-trustlesswork-timestamp'],
      invalidUtf8
    )

    verifyTrustlessWorkSignature(req, res, next)

    expect(next).toHaveBeenCalled()
    expect(res.status).not.toHaveBeenCalled()
  })

  it('returns 500 without touching next() when the secret is not configured', () => {
    delete process.env.TRUSTLESSWORK_WEBHOOK_SECRET
    req.headers['x-trustlesswork-signature'] = sign(
      SECRET,
      req.headers['x-trustlesswork-timestamp'],
      rawBody
    )

    verifyTrustlessWorkSignature(req, res, next)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ error: 'Webhook secret not configured' })
    expect(next).not.toHaveBeenCalled()
  })
})
