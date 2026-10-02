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

// ── Core request ───────────────────────────────────────────────────────────────

/**
 * Execute a Hasura GraphQL query or mutation.
 * Throws a typed error with `details` when Hasura returns errors.
 */
export async function hasuraRequest<T = Record<string, unknown>>(
  query: string,
  variables: Record<string, unknown> = {},
  timeoutMs: number = DEFAULT_HASURA_TIMEOUT_MS
): Promise<T> {
  const adminSecret = process.env.HASURA_GRAPHQL_ADMIN_SECRET

  if (!adminSecret) {
    throw new Error('Missing HASURA_GRAPHQL_ADMIN_SECRET')
  }

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
  hasuraRequest,
}