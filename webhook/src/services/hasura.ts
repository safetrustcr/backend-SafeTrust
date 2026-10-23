const DEFAULT_HASURA_ENDPOINT  = 'http://graphql-engine:8080/v1/graphql'
const DEFAULT_HASURA_TIMEOUT_MS = 10_000
const DEFAULT_HASURA_ROLE      = 'safetrust'

// ── Types ──────────────────────────────────────────────────────────────────────

interface HasuraError {
  message: string
  extensions?: Record<string, unknown>
}

interface HasuraResponse<T> {
  data: T
  errors?: HasuraError[]
}


// Extend Error to carry Hasura error details
interface HasuraRequestError extends Error {
  details: HasuraError[]
}

// ── Helpers ────────────────────────────────────────────────────────────────────

export function getHasuraEndpoint(): string {
  const configured = process.env.HASURA_GRAPHQL_ENDPOINT ?? DEFAULT_HASURA_ENDPOINT
  return configured.endsWith('/v1/graphql')
    ? configured
    : `${configured.replace(/\/$/, '')}/v1/graphql`
}

/**
 * Read the Hasura admin secret from the environment.
 * Throws when it is absent so the service fails closed instead of falling
 * back to a committed default.
 */
export function getHasuraAdminSecret(): string {
  const adminSecret = process.env.HASURA_ADMIN_SECRET

  if (!adminSecret) {
    throw new Error('Missing HASURA_ADMIN_SECRET')
  }

  return adminSecret
}

// ── Core request ───────────────────────────────────────────────────────────────

/**
 * Execute a Hasura GraphQL query or mutation.
 * Throws a typed error with `details` when Hasura returns errors.
 *
 * @deprecated Do not call this from handlers. This function uses the admin
 * secret and bypasses Hasura role permissions. Handlers must go through an
 * application service method (see `hasuraAdminRequest` / `hasuraScopedRequest`
 * below) which derives trusted values from the verified session and enforces
 * tenant ownership before issuing privileged writes.
 */
export async function hasuraRequest<T = Record<string, unknown>>(
  query: string,
  variables: Record<string, unknown> = {},
  timeoutMs: number = DEFAULT_HASURA_TIMEOUT_MS
): Promise<T> {
  const adminSecret = getHasuraAdminSecret()

  const response = await fetch(getHasuraEndpoint(), {
    method: 'POST',
    headers: {
      'Content-Type':        'application/json',
      'x-hasura-admin-secret': adminSecret,
    },
    body:   JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(timeoutMs),
  })

  const json = (await response.json()) as HasuraResponse<T>

  if (!response.ok) {
    throw new Error(`Hasura request failed with status ${response.status}`)
  }

  if (json.errors?.length) {
    const error = new Error('Hasura request failed') as HasuraRequestError
    error.details = json.errors
    throw error
  }

  return json.data
}

// ── Service-layer wrappers ────────────────────────────────────────────────────
//
// The admin client is intentionally NOT exported for direct handler use.
// Handlers must call these wrappers, which enforce the trust boundary:
//   - `hasuraAdminRequest` is for internal/system writes only. It requires an
//     explicit `tenantId` derived from the verified JWT session (never a string
//     literal) and rejects mutations whose variables contain a mismatched
//     `tenant_id`/`tenantId` value.
//   - `hasuraScopedRequest` issues requests under a scoped Hasura role
//     (`x-hasura-role` + session claims) so ordinary role permissions apply.

export interface ScopedSession {
  tenantId: string
  /** Verified Firebase ID token, forwarded so Hasura authenticates the caller. */
  idToken:  string
  userId?:  string
  role?:    string
}

export class TenantMismatchError extends Error {
  constructor(message = 'Tenant mismatch: mutation tenant does not match verified session tenant') {
    super(message)
    this.name = 'TenantMismatchError'
  }
}

function tenantValuesOf(value: unknown): unknown[] {
  if (!value || typeof value !== 'object') return []
  const record = value as Record<string, unknown>
  return [record.tenant_id, record.tenantId]
}

export function assertTenantMatches(
  tenantId: string,
  variables: Record<string, unknown>
): void {
  // Top-level variables plus the nested insert/update payload (`object`,
  // or each row of `objects`).
  const nested = variables.object
  const rows = Array.isArray(variables.objects) ? variables.objects : []
  const candidates = [
    ...tenantValuesOf(variables),
    ...tenantValuesOf(nested),
    ...rows.flatMap(tenantValuesOf),
  ]
  for (const value of candidates) {
    if (value === undefined) continue
    if (value !== tenantId) {
      throw new TenantMismatchError()
    }
  }
}

/**
 * Internal/system write using the admin secret. Only callable from the
 * application service layer. `tenantId` MUST be derived from
 * `req.context.tenantId` (session-verified), never a string literal.
 */
export async function hasuraAdminRequest<T = Record<string, unknown>>(
  tenantId: string,
  query: string,
  variables: Record<string, unknown> = {},
  timeoutMs: number = DEFAULT_HASURA_TIMEOUT_MS
): Promise<T> {
  if (!tenantId) {
    throw new TenantMismatchError('hasuraAdminRequest requires a session-derived tenantId')
  }
  assertTenantMatches(tenantId, variables)
  return hasuraRequest<T>(query, variables, timeoutMs)
}

/**
 * Scoped request using a Hasura role derived from the verified session.
 * Hasura role permissions apply; the admin secret is not used.
 */
export async function hasuraScopedRequest<T = Record<string, unknown>>(
  session: ScopedSession,
  query: string,
  variables: Record<string, unknown> = {},
  timeoutMs: number = DEFAULT_HASURA_TIMEOUT_MS
): Promise<T> {
  if (!session.tenantId) {
    throw new TenantMismatchError('hasuraScopedRequest requires a session-derived tenantId')
  }
  if (!session.idToken) {
    throw new Error('hasuraScopedRequest requires the verified session token')
  }
  assertTenantMatches(session.tenantId, variables)

  const response = await fetch(getHasuraEndpoint(), {
    method: 'POST',
    headers: {
      'Content-Type':              'application/json',
      Authorization:               `Bearer ${session.idToken}`,
      'x-hasura-role':             session.role ?? DEFAULT_HASURA_ROLE,
      'x-hasura-tenant-id':        session.tenantId,
      ...(session.userId ? { 'x-hasura-user-id': session.userId } : {}),
    },
    body:   JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(timeoutMs),
  })

  const json = (await response.json()) as HasuraResponse<T>

  if (!response.ok) {
    throw new Error(`Hasura request failed with status ${response.status}`)
  }

  if (json.errors?.length) {
    const error = new Error('Hasura request failed') as HasuraRequestError
    error.details = json.errors
    throw error
  }

  return json.data
}

export default {
  getHasuraEndpoint,
  hasuraAdminRequest,
  hasuraScopedRequest,
  getHasuraAdminSecret,
  hasuraRequest,
}