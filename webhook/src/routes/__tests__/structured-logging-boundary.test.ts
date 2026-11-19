import { readdirSync, readFileSync } from 'fs'
import { join, relative } from 'path'

// Route handlers and middleware log through `middleware/logger.ts`, which adds
// the request id and writes one JSON object per line. A bare console call
// would produce an uncorrelated, unstructured line.

const SRC_DIR = join(__dirname, '..', '..')
const CHECKED_DIRS = ['routes', 'middleware'].map((dir) => join(SRC_DIR, dir))
const LOGGER_MODULE = join(SRC_DIR, 'middleware', 'logger.ts')
const CONSOLE_CALL = /\bconsole\.(log|info|warn|error|debug)\s*\(/

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      return entry.name === '__tests__' ? [] : sourceFiles(fullPath)
    }
    return /\.ts$/.test(entry.name) && fullPath !== LOGGER_MODULE ? [fullPath] : []
  })
}

describe('structured logging boundary', () => {
  it('finds route and middleware sources to check', () => {
    expect(CHECKED_DIRS.flatMap(sourceFiles).length).toBeGreaterThan(10)
  })

  it('has no bare console calls in route handlers or middleware', () => {
    const offenders = CHECKED_DIRS.flatMap(sourceFiles).flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => CONSOLE_CALL.test(line) && !line.trim().startsWith('//'))
        .map(({ index }) => `${relative(SRC_DIR, file)}:${index + 1}`)
    )

    expect(offenders).toEqual([])
  })
})
