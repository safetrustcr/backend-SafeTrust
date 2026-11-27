import { readdirSync, readFileSync } from 'fs'
import { join, relative } from 'path'

// The admin Hasura client bypasses role permissions, so route handlers must
// reach it only through service-layer methods (ARCH-A11 / #713).

const ROUTES_DIR = join(__dirname, '..')
const ADMIN_CLIENT_MODULE = /(['"])[./]*(?:[^'"]*\/)?services\/(?:hasura|tenant-scoped-hasura)\1/

function routeSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      return entry.name === '__tests__' ? [] : routeSourceFiles(fullPath)
    }
    return /\.ts$/.test(entry.name) ? [fullPath] : []
  })
}

describe('admin Hasura client boundary', () => {
  it('finds route sources to check', () => {
    expect(routeSourceFiles(ROUTES_DIR).length).toBeGreaterThan(0)
  })

  it('is not imported by any route handler or route module', () => {
    const offenders = routeSourceFiles(ROUTES_DIR)
      .filter((file) => ADMIN_CLIENT_MODULE.test(readFileSync(file, 'utf8')))
      .map((file) => relative(ROUTES_DIR, file))

    expect(offenders).toEqual([])
  })
})
