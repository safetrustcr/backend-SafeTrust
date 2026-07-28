const { authMiddleware } = require('../auth.middleware');
const { getAuth } = require('firebase-admin/auth');
const db = require('../../services/db');

// Mock firebase-admin/auth
jest.mock('firebase-admin/auth', () => ({
  getAuth: jest.fn()
}));

// Mock the db module so tests never hit a real Postgres connection.
jest.mock('../../services/db', () => ({
  query: jest.fn()
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
    // Default: no roles assigned unless a test overrides.
    db.query.mockResolvedValue({ rows: [] });
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

  it('should call next() and attach user with roles from user_roles if token is valid', async () => {
    const mockUser = { uid: '123', email: 'test@example.com', name: 'Test User' };
    req.headers['authorization'] = 'Bearer valid-token';
    getAuth.mockReturnValue({
      verifyIdToken: jest.fn().mockResolvedValue(mockUser)
    });
    db.query.mockResolvedValue({ rows: [{ name: 'host' }] });

    await authMiddleware(req, res, next);
    expect(req.user).toMatchObject({
      uid: mockUser.uid,
      email: mockUser.email,
      name: mockUser.name,
      roles: ['host'],
      role: 'host',
    });
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('should default role to guest when the verified user has no roles', async () => {
    const mockUser = { uid: '123', email: 'test@example.com', name: 'Test User' };
    req.headers['authorization'] = 'Bearer valid-token';
    getAuth.mockReturnValue({
      verifyIdToken: jest.fn().mockResolvedValue(mockUser)
    });
    db.query.mockResolvedValue({ rows: [] });

    await authMiddleware(req, res, next);
    expect(req.user).toMatchObject({ roles: [], role: 'guest' });
    expect(next).toHaveBeenCalled();
  });

  it('should not let custom claims clobber role/roles from user_roles', async () => {
    // A stale/hostile `role` claim in the token must not override the DB lookup.
    const mockUser = { uid: '123', email: 'test@example.com', role: 'admin', roles: ['admin'] };
    req.headers['authorization'] = 'Bearer valid-token';
    getAuth.mockReturnValue({
      verifyIdToken: jest.fn().mockResolvedValue(mockUser)
    });
    db.query.mockResolvedValue({ rows: [{ name: 'guest' }] });

    await authMiddleware(req, res, next);
    expect(req.user).toMatchObject({ roles: ['guest'], role: 'guest' });
    expect(next).toHaveBeenCalled();
  });

  describe('mock-token bypass', () => {
    const OLD_ENV = process.env.NODE_ENV;

    beforeEach(() => {
      process.env.NODE_ENV = 'test';
    });

    afterAll(() => {
      process.env.NODE_ENV = OLD_ENV;
    });

    it('should attach roles from user_roles for the mock-token test uid', async () => {
      req.headers['authorization'] = 'Bearer mock-token';
      req.headers['x-test-uid'] = 'host-user-001';
      db.query.mockResolvedValue({ rows: [{ name: 'host' }] });

      await authMiddleware(req, res, next);
      expect(db.query).toHaveBeenCalledWith(expect.any(String), ['host-user-001']);
      expect(req.user).toMatchObject({
        uid: 'host-user-001',
        roles: ['host'],
        role: 'host',
      });
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should default role to guest for a mock-token user with no roles', async () => {
      req.headers['authorization'] = 'Bearer mock-token';
      req.headers['x-test-uid'] = 'no-role-user-001';
      db.query.mockResolvedValue({ rows: [] });

      await authMiddleware(req, res, next);
      expect(req.user).toMatchObject({ roles: [], role: 'guest' });
      expect(next).toHaveBeenCalled();
    });

    it('should return 500 if mock-token is used outside the test environment', async () => {
      process.env.NODE_ENV = 'production';
      req.headers['authorization'] = 'Bearer mock-token';

      await authMiddleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(next).not.toHaveBeenCalled();
    });
  });
});
