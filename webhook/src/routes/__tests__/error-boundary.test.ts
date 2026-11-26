import { readdirSync, readFileSync } from 'fs'
import { join, relative } from 'path'

// Handlers and route modules must not construct 4xx or 5xx error responses
// directly; instead, throw typed AppError instances from utils/errors.ts and
// let middleware/error-handler.ts format them (Issue #815).

const ROUTES_DIR = join(__dirname, '..')
const HTTP_ERROR_STATUS = /\bres\.(?:status|sendStatus)\s*\(\s*(4\d{2}|5\d{2})\s*\)/

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
          .map(({ index }) => `${relative(ROUTES_DIR, file)}:${index + 1}`)
      )
      .filter((loc) => !loc.startsWith('health.route.ts'))

    expect(offenders).toEqual([])
  })
})
