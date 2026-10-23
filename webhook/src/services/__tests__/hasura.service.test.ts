import {
  assertTenantMatches,
  hasuraAdminRequest,
  hasuraScopedRequest,
  TenantMismatchError,
} from '../hasura'

const mockedFetch = jest.fn()

function respond(data: unknown, ok = true, status = 200, errors?: unknown[]) {
  mockedFetch.mockResolvedValueOnce({
    ok,
    status,
    json: async () => ({ data, ...(errors ? { errors } : {}) }),
  })
}

describe('hasura service-layer wrappers', () => {
  const originalFetch = global.fetch
  const originalSecret = process.env.HASURA_ADMIN_SECRET

  beforeAll(() => {
    global.fetch = mockedFetch as unknown as typeof fetch
    process.env.HASURA_ADMIN_SECRET = 'test-secret'
  })

  afterAll(() => {
    global.fetch = originalFetch
    if (originalSecret === undefined) delete process.env.HASURA_ADMIN_SECRET
    else process.env.HASURA_ADMIN_SECRET = originalSecret
  })

  beforeEach(() => jest.clearAllMocks())

  describe('assertTenantMatches', () => {
    it('accepts matching or absent tenant values', () => {
      expect(() => assertTenantMatches('t-a', {})).not.toThrow()
      expect(() =>
        assertTenantMatches('t-a', { tenantId: 't-a', object: { tenant_id: 't-a' } })
      ).not.toThrow()
    })

    it.each([
      [{ tenant_id: 't-b' }],
      [{ tenantId: 't-b' }],
      [{ object: { tenant_id: 't-b' } }],
      [{ object: { tenantId: 't-b' } }],
      [{ objects: [{ tenant_id: 't-a' }, { tenant_id: 't-b' }] }],
    ])('rejects a mismatched tenant in %j', (variables) => {
      expect(() => assertTenantMatches('t-a', variables)).toThrow(TenantMismatchError)
    })
  })

  describe('hasuraAdminRequest', () => {
    it('requires a session tenant', async () => {
      await expect(hasuraAdminRequest('', 'query { x }')).rejects.toBeInstanceOf(
        TenantMismatchError
      )
      expect(mockedFetch).not.toHaveBeenCalled()
    })

    it('rejects a nested payload tenant mismatch before calling Hasura', async () => {
      await expect(
        hasuraAdminRequest('t-a', 'mutation { x }', { object: { tenant_id: 't-b' } })
      ).rejects.toBeInstanceOf(TenantMismatchError)
      expect(mockedFetch).not.toHaveBeenCalled()
    })

    it('forwards to Hasura with the admin secret when the tenant matches', async () => {
      respond({ ok: true })
      await expect(
        hasuraAdminRequest('t-a', 'mutation { x }', { tenantId: 't-a' })
      ).resolves.toEqual({ ok: true })
      expect(mockedFetch.mock.calls[0][1].headers['x-hasura-admin-secret']).toBe('test-secret')
    })
  })

  describe('hasuraScopedRequest', () => {
    const session = { tenantId: 't-a', idToken: 'jwt-123', userId: 'u-1' }

    it('forwards the verified bearer token and scoped role headers', async () => {
      respond({ rows: [] })
      await expect(hasuraScopedRequest(session, 'query { x }')).resolves.toEqual({ rows: [] })

      const headers = mockedFetch.mock.calls[0][1].headers
      expect(headers.Authorization).toBe('Bearer jwt-123')
      expect(headers['x-hasura-role']).toBe('safetrust')
      expect(headers['x-hasura-tenant-id']).toBe('t-a')
      expect(headers['x-hasura-user-id']).toBe('u-1')
      expect(headers['x-hasura-admin-secret']).toBeUndefined()
    })

    it('omits the user header and honours a custom role', async () => {
      respond({})
      await hasuraScopedRequest({ tenantId: 't-a', idToken: 'jwt', role: 'guest' }, 'q')
      const headers = mockedFetch.mock.calls[0][1].headers
      expect(headers['x-hasura-role']).toBe('guest')
      expect(headers['x-hasura-user-id']).toBeUndefined()
    })

    it('requires tenant and token', async () => {
      await expect(
        hasuraScopedRequest({ ...session, tenantId: '' }, 'q')
      ).rejects.toBeInstanceOf(TenantMismatchError)
      await expect(hasuraScopedRequest({ ...session, idToken: '' }, 'q')).rejects.toThrow(
        /verified session token/
      )
      expect(mockedFetch).not.toHaveBeenCalled()
    })

    it('rejects a tenant mismatch in variables', async () => {
      await expect(
        hasuraScopedRequest(session, 'q', { object: { tenantId: 't-z' } })
      ).rejects.toBeInstanceOf(TenantMismatchError)
    })

    it('surfaces HTTP and GraphQL errors', async () => {
      respond(null, false, 500)
      await expect(hasuraScopedRequest(session, 'q')).rejects.toThrow(/status 500/)

      respond(null, true, 200, [{ message: 'denied' }])
      await expect(hasuraScopedRequest(session, 'q')).rejects.toMatchObject({
        message: 'Hasura request failed',
        details: [{ message: 'denied' }],
      })
    })
  })
})
