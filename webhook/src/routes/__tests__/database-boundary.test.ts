import { readFileSync, readdirSync } from 'fs'
import { join, relative } from 'path'

const ROUTES_DIR = join(__dirname, '..')
const DATABASE_MODULE =
  /(?:\bfrom\s+|\brequire\s*\(\s*|\bimport\s*(?:\(\s*)?)['"][^'"]*services\/db['"]/

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
  it('rejects dynamic and side-effect imports of services/db', () => {
    expect(DATABASE_MODULE.test("import('../services/db')")).toBe(true)
    expect(DATABASE_MODULE.test("import '../services/db'")).toBe(true)
  })

  it('allows services/db only in the health route', () => {
    const offenders = routeSourceFiles(ROUTES_DIR)
      .filter((file) => DATABASE_MODULE.test(readFileSync(file, 'utf8')))
      .map((file) => relative(ROUTES_DIR, file))
      .filter((file) => file !== 'health.route.ts')

    expect(offenders).toEqual([])
  })
})
