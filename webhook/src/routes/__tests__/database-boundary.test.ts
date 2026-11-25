import { readFileSync, readdirSync } from 'fs'
import { join, relative } from 'path'

const ROUTES_DIR = join(__dirname, '..')
const DATABASE_MODULE =
  /(?:\bfrom\s+|\brequire\s*\(\s*|\bimport\s*(?:\(\s*)?)['"][^'"]*db\/pool['"]/

function routeSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      return entry.name === '__tests__' ? [] : routeSourceFiles(fullPath)
    }
    return /\.ts$/.test(entry.name) ? [fullPath] : []
  })
}

describe('database access boundary', () => {
  it('rejects dynamic and side-effect imports of db/pool', () => {
    expect(DATABASE_MODULE.test("import('../db/pool')")).toBe(true)
    expect(DATABASE_MODULE.test("import '../db/pool'")).toBe(true)
  })

  it('allows db/pool only in the health route', () => {
    const offenders = routeSourceFiles(ROUTES_DIR)
      .filter((file) => DATABASE_MODULE.test(readFileSync(file, 'utf8')))
      .map((file) => relative(ROUTES_DIR, file))
      .filter((file) => file !== 'health.route.ts')

    expect(offenders).toEqual([])
  })
})
