import { hasuraRequest } from './hasura'

// ── Tenant-scoped admin writes ─────────────────────────────────────────────────
//
// The admin Hasura client bypasses role permissions, so every privileged write
// that carries tenant data goes through `hasuraTenantRequest`. The caller passes
// the tenant it has verified (the session tenant from `req.context.tenantId`, or
// the platform tenant for signed server-to-server webhooks), and any tenant value
// in the variables must equal it before the request is sent.

export class TenantMismatchError extends Error {
  readonly statusCode = 403

  constructor(message = 'Tenant does not match the verified session tenant') {
    super(message)
    this.name = 'TenantMismatchError'
  }
}

const TENANT_KEYS = ['tenant_id', 'tenantId'] as const

function tenantValuesOf(value: unknown): unknown[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  const record = value as Record<string, unknown>
  return TENANT_KEYS.map((key) => record[key]).filter((entry) => entry !== undefined)
}

/**
 * Reject variables whose tenant differs from `tenantId`.
 *
 * Checks the top-level variables, the insert payload (`object` and every row of
 * `objects`) and the update payload (`_set`).
 */
export function assertTenantScopedVariables(
  tenantId: string,
  variables: Record<string, unknown>
): void {
  if (typeof tenantId !== 'string' || tenantId.length === 0) {
    throw new TenantMismatchError('A verified tenant is required for this write')
  }

  const rows = Array.isArray(variables.objects) ? variables.objects : []
  const values = [
    ...tenantValuesOf(variables),
    ...tenantValuesOf(variables.object),
    ...tenantValuesOf(variables._set),
    ...rows.flatMap(tenantValuesOf),
  ]

  if (values.some((value) => value !== tenantId)) {
    throw new TenantMismatchError()
  }
}

/**
 * Run an admin Hasura request for one verified tenant. Throws
 * `TenantMismatchError` before any network call when the variables name a
 * different tenant.
 */
export async function hasuraTenantRequest<T = Record<string, unknown>>(
  tenantId: string,
  query: string,
  variables: Record<string, unknown> = {}
): Promise<T> {
  assertTenantScopedVariables(tenantId, variables)
  return hasuraRequest<T>(query, variables)
}
