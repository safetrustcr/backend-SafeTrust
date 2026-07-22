const crypto = require('crypto');
const verifyTrustlessWorkSignature = require('../trustlesswork-signature.middleware');

const SECRET = 'dev-secret';

function sign(secret, rawBody) {
  const hmac = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return `sha256=${hmac}`;
}

describe('verifyTrustlessWorkSignature', () => {
  let req, res, next;
  const rawBody = Buffer.from(JSON.stringify({ contractId: 'escrow-1', status: 'funded' }));

  beforeEach(() => {
    req = { headers: {}, rawBody };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
    process.env.TRUSTLESSWORK_WEBHOOK_SECRET = SECRET;
  });

  afterEach(() => {
    delete process.env.TRUSTLESSWORK_WEBHOOK_SECRET;
    jest.clearAllMocks();
  });

  it('calls next() when the signature is valid', () => {
    req.headers['x-trustlesswork-signature'] = sign(SECRET, rawBody);

    verifyTrustlessWorkSignature(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 401 with the exact error message when the header is missing', () => {
    verifyTrustlessWorkSignature(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Missing x-trustlesswork-signature header',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 with the exact error message when the signature is wrong', () => {
    req.headers['x-trustlesswork-signature'] = sign('a-different-secret', rawBody);

    verifyTrustlessWorkSignature(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid webhook signature' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when the signature is malformed instead of throwing', () => {
    req.headers['x-trustlesswork-signature'] = 'not-a-valid-signature';

    expect(() => verifyTrustlessWorkSignature(req, res, next)).not.toThrow();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid webhook signature' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when the payload was tampered with after signing', () => {
    req.headers['x-trustlesswork-signature'] = sign(SECRET, rawBody);
    // Simulate a forged body that arrives with a signature computed over a
    // different (legitimate-looking) payload.
    req.rawBody = Buffer.from(JSON.stringify({ contractId: 'escrow-1', status: 'completed' }));

    verifyTrustlessWorkSignature(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid webhook signature' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 500 without touching next() when the secret is not configured', () => {
    delete process.env.TRUSTLESSWORK_WEBHOOK_SECRET;
    req.headers['x-trustlesswork-signature'] = sign(SECRET, rawBody);

    verifyTrustlessWorkSignature(req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Webhook secret not configured' });
    expect(next).not.toHaveBeenCalled();
  });
});
