import {
  assertTenantScopedVariables,
  hasuraTenantRequest,
  TenantMismatchError,
} from '../tenant-scoped-hasura'
import { hasuraRequest } from '../hasura'

jest.mock('../hasura', () => ({
  hasuraRequest: jest.fn(),
}))

const mockedHasuraRequest = hasuraRequest as jest.MockedFunction<typeof hasuraRequest>

describe('tenant-scoped-hasura', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('assertTenantScopedVariables', () => {
    it('accepts variables whose tenant matches the verified tenant', () => {
      expect(() =>
        assertTenantScopedVariables('safetrust', {
          tenantId: 'safetrust',
          object: { tenant_id: 'safetrust' },
          objects: [{ tenantId: 'safetrust' }],
          _set: { tenant_id: 'safetrust' },
        })
      ).not.toThrow()
    })

    it('accepts variables that carry no tenant', () => {
      expect(() => assertTenantScopedVariables('safetrust', { escrowId: 'escrow-1' })).not.toThrow()
    })

    it.each([
      ['top-level tenantId', { tenantId: 'hotel_industry' }],
      ['top-level tenant_id', { tenant_id: 'hotel_industry' }],
      ['insert object', { object: { tenant_id: 'hotel_industry' } }],
      ['bulk insert row', { objects: [{ tenant_id: 'safetrust' }, { tenantId: 'hotel_industry' }] }],
      ['update _set', { _set: { tenantId: 'hotel_industry' } }],
      ['non-string tenant', { object: { tenant_id: null } }],
    ])('rejects a mismatched tenant in the %s', (_label, variables) => {
      expect(() => assertTenantScopedVariables('safetrust', variables)).toThrow(TenantMismatchError)
    })

    it('rejects a missing verified tenant', () => {
      expect(() => assertTenantScopedVariables('', {})).toThrow(TenantMismatchError)
    })
  })

  describe('hasuraTenantRequest', () => {
    it('forwards a matching request to the admin client', async () => {
      mockedHasuraRequest.mockResolvedValueOnce({ ok: true })

      const result = await hasuraTenantRequest('safetrust', 'mutation M { m }', {
        object: { tenant_id: 'safetrust' },
      })

      expect(result).toEqual({ ok: true })
      expect(mockedHasuraRequest).toHaveBeenCalledWith('mutation M { m }', {
        object: { tenant_id: 'safetrust' },
      })
    })

    it('rejects a mismatched tenant without calling the admin client', async () => {
      await expect(
        hasuraTenantRequest('safetrust', 'mutation M { m }', {
          object: { tenant_id: 'hotel_industry' },
        })
      ).rejects.toBeInstanceOf(TenantMismatchError)

      expect(mockedHasuraRequest).not.toHaveBeenCalled()
    })
  })
})
