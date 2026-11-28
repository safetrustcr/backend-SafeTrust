import { readdirSync, readFileSync } from 'fs'
import { join, relative } from 'path'

// The webhook must talk to PostgreSQL only through SQL repositories (`db/pool`),
// never by sending GraphQL requests to Hasura or using the Hasura admin secret.

const SRC_DIR = join(__dirname, '..', '..')

const FORBIDDEN_HASURA_PATTERNS = [
  /(['"])[./]*(?:[^'"]*\/)?services\/(?:hasura|tenant-scoped-hasura)\1/,
  /\bhasuraRequest\b/,
  /\bhasuraTenantRequest\b/,
  /x-hasura-admin-secret/i,
  /\/v1\/graphql\b/,
  /\bHASURA_ADMIN_SECRET\b/,
  /\bHASURA_GRAPHQL_ADMIN_SECRET\b/,
]

function productionSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      return entry.name === '__tests__' ? [] : productionSourceFiles(fullPath)
    }
    return /\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) ? [fullPath] : []
  })
}

describe('single data-access path boundary (no Hasura GraphQL)', () => {
  it('finds production source files under webhook/src to check', () => {
    expect(productionSourceFiles(SRC_DIR).length).toBeGreaterThan(0)
  })

  it('forbids sending GraphQL to Hasura or using the admin secret anywhere under webhook/src', () => {
    const offenders = productionSourceFiles(SRC_DIR)
      .filter((file) => {
        const content = readFileSync(file, 'utf8')
        return FORBIDDEN_HASURA_PATTERNS.some((pattern) => pattern.test(content))
      })
      .map((file) => relative(SRC_DIR, file))

    expect(offenders).toEqual([])
  })
})
