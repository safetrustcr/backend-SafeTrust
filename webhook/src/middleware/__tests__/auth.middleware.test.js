const { authMiddleware } = require('../auth.middleware');
const { getAuth } = require('firebase-admin/auth');

// Mock firebase-admin/auth
jest.mock('firebase-admin/auth', () => ({
  getAuth: jest.fn()
}));

describe('authMiddleware', () => {
  let req, res, next;

  beforeEach(() => {
    req = { headers: {} };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
    next = jest.fn();
    jest.clearAllMocks();
  });

  it('should return 401 if Authorization header is missing', async () => {
    await authMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Unauthorized' }));
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 401 if Authorization header is malformed', async () => {
    req.headers['authorization'] = 'Basic 12345';
    await authMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 401 if token verification fails', async () => {
    req.headers['authorization'] = 'Bearer invalid-token';
    getAuth.mockReturnValue({
      verifyIdToken: jest.fn().mockRejectedValue(new Error('Invalid token'))
    });

    await authMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('should call next() and attach user if token is valid', async () => {
    const mockUser = { uid: '123', email: 'test@example.com', name: 'Test User' };
    req.headers['authorization'] = 'Bearer valid-token';
    getAuth.mockReturnValue({
      verifyIdToken: jest.fn().mockResolvedValue(mockUser)
    });

    await authMiddleware(req, res, next);
    expect(req.user).toMatchObject({
      uid: mockUser.uid,
      email: mockUser.email,
      name: mockUser.name,
    });
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
