const { requireRole } = require('../require-role');

describe('requireRole', () => {
  let req, res, next;

  beforeEach(() => {
    req = {};
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  it('should return 401 when req.user is missing', () => {
    requireRole(['host'])(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Unauthorized' })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 403 when a guest hits a host-only route', () => {
    req.user = { role: 'guest' };
    requireRole(['host'])(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Forbidden' })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('should call next() when a guest is in the allowed roles', () => {
    req.user = { role: 'guest' };
    requireRole(['guest', 'host'])(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('should call next() when a host is in the allowed roles', () => {
    req.user = { role: 'host' };
    requireRole(['guest', 'host'])(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('should treat an admin claim as the admin role', () => {
    req.user = { admin: true };
    requireRole(['admin'])(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('should fall back to guest when no role or admin claim is present', () => {
    req.user = {};
    requireRole(['guest'])(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
