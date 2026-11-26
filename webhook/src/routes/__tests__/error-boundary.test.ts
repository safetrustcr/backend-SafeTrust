import { readdirSync, readFileSync } from 'fs'
import { join, relative } from 'path'

// Handlers and route modules must not construct 4xx or 5xx error responses
// directly; instead, throw typed AppError instances from utils/errors.ts and
// let middleware/error-handler.ts format them (Issue #815).
//
// Explicit, reviewed exception:
// - `health.route.ts` (GET /health/ready): Infrastructure / Kubernetes readiness
//   probe that reports dependency status ({ status: 'not_ready', dependencies }).
//   It returns HTTP 503 when dependencies (Firebase, Postgres) are not ready per
//   standard probe semantics. It deliberately does not route through the shared
//   error-handler middleware because orchestration tooling (bin/start, Kubernetes)
//   expects the structured probe document rather than the generic ApiError envelope.
const REVIEWED_PROBE_EXEMPTIONS = new Set(['health.route.ts'])

const ROUTES_DIR = join(__dirname, '..')
const HTTP_ERROR_STATUS = /\bres\.(?:status|sendStatus)\s*\([^)]*\b(4\d{2}|5\d{2})\b/

function routeSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      return entry.name === '__tests__' ? [] : routeSourceFiles(fullPath)
    }
    return /\.ts$/.test(entry.name) ? [fullPath] : []
  })
}

describe('error handling boundary', () => {
  it('finds route sources to check', () => {
    expect(routeSourceFiles(ROUTES_DIR).length).toBeGreaterThan(10)
  })

  it('has no direct 4xx or 5xx status calls in route handlers or route files', () => {
    const offenders = routeSourceFiles(ROUTES_DIR)
      .map((file) => ({ file, content: readFileSync(file, 'utf8') }))
      .flatMap(({ file, content }) =>
        content
          .split('\n')
          .map((line, index) => ({ line, index }))
          .filter(({ line }) => HTTP_ERROR_STATUS.test(line) && !line.trim().startsWith('//'))
          .map(({ index }) => ({
            relPath: relative(ROUTES_DIR, file),
            loc: `${relative(ROUTES_DIR, file)}:${index + 1}`,
          }))
      )
      .filter(({ relPath }) => !REVIEWED_PROBE_EXEMPTIONS.has(relPath))
      .map(({ loc }) => loc)

    expect(offenders).toEqual([])
  })

  it('confirms the health.route.ts exemption is strictly limited to the readiness probe', () => {
    const healthFile = join(ROUTES_DIR, 'health.route.ts')
    const matches = readFileSync(healthFile, 'utf8')
      .split('\n')
      .map((line, index) => ({ line, lineNo: index + 1 }))
      .filter(({ line }) => HTTP_ERROR_STATUS.test(line) && !line.trim().startsWith('//'))

    expect(matches).toHaveLength(1)
    expect(matches[0].line).toContain('ready ? 200 : 503')
  })
})
