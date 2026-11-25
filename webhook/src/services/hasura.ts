const DEFAULT_HASURA_ENDPOINT  = 'http://graphql-engine:8080/v1/graphql'
const DEFAULT_HASURA_TIMEOUT_MS = 10_000

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

/**
 * Require the shared secret the Hasura reconciliation cron trigger sends as
 * `x-hasura-event-secret` on POST /reconciliation/sync-escrows.
 *
 * In production a missing secret throws so the service fails at startup
 * instead of serving an endpoint anyone on the internet can call. In
 * non-production a missing secret only warns: the guard in
 * sync-escrows.route.ts stays open (dev mode) so local development works
 * with the secret unset, and local setups that do set it (see
 * webhook/.env.example) are already protected.
 */
export function requireHasuraEventSecret(): void {
  if (process.env.HASURA_EVENT_SECRET) {
    return
  }

  const msg = 'Missing HASURA_EVENT_SECRET'
  if (process.env.NODE_ENV === 'production') {
    throw new Error(msg)
  }
  console.warn(`${msg} — reconciliation endpoint is unauthenticated (non-production)`)
}

// ── Core request ───────────────────────────────────────────────────────────────

/**
 * Execute a Hasura GraphQL query or mutation with the admin secret.
 * Throws a typed error with `details` when Hasura returns errors.
 *
 * This client bypasses Hasura role permissions. Only services and
 * repositories may import it; route handlers call service methods instead
 * (enforced by `routes/__tests__/admin-client-boundary.test.ts`). Writes that
 * carry tenant data go through `hasuraTenantRequest` in
 * `tenant-scoped-hasura.ts`.
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

export default {
  getHasuraEndpoint,
  getHasuraAdminSecret,
  requireHasuraEventSecret,
  hasuraRequest,
}