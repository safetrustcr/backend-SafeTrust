import { readdirSync, readFileSync } from 'fs'
import { join, relative } from 'path'

// Application code logs through `middleware/logger.ts`, which adds the
// request id and writes one JSON object per line. A bare console call would
// produce an uncorrelated, unstructured line.

const SRC_DIR = join(__dirname, '..', '..')
const CHECKED_DIRS = [SRC_DIR]
const LOGGER_MODULE = join(SRC_DIR, 'middleware', 'logger.ts')
const CONSOLE_CALL = /\bconsole\.[A-Za-z_$][\w$]*\s*\(/

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
  it('finds application sources to check', () => {
    expect(sourceFiles(SRC_DIR).length).toBeGreaterThan(10)
  })

  it('has no bare console calls outside the logger implementation', () => {
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
