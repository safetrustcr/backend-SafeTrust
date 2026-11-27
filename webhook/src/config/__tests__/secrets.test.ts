import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { readSecret } from '../secrets'

describe('readSecret', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'secrets-test-'))
    delete process.env.TEST_SECRET
    delete process.env.TEST_SECRET_FILE
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    delete process.env.TEST_SECRET
    delete process.env.TEST_SECRET_FILE
  })

  it('reads the value from the environment when no file is configured', () => {
    process.env.TEST_SECRET = 'from-env'

    expect(readSecret('TEST_SECRET')).toBe('from-env')
  })

  it('returns undefined for an unset or empty variable', () => {
    expect(readSecret('TEST_SECRET')).toBeUndefined()

    process.env.TEST_SECRET = ''
    expect(readSecret('TEST_SECRET')).toBeUndefined()
  })

  it('prefers the *_FILE mount over the environment variable', () => {
    const file = join(dir, 'secret')
    writeFileSync(file, 'from-file\n')
    process.env.TEST_SECRET_FILE = file
    process.env.TEST_SECRET = 'from-env'

    expect(readSecret('TEST_SECRET')).toBe('from-file')
  })

  it('strips a single trailing newline from the file contents', () => {
    const file = join(dir, 'secret')
    writeFileSync(file, '-----BEGIN KEY-----\nabc\n-----END KEY-----\n')
    process.env.TEST_SECRET_FILE = file

    expect(readSecret('TEST_SECRET')).toBe('-----BEGIN KEY-----\nabc\n-----END KEY-----')
  })

  it('throws when the configured file cannot be read', () => {
    process.env.TEST_SECRET_FILE = join(dir, 'does-not-exist')
    process.env.TEST_SECRET = 'from-env'

    expect(() => readSecret('TEST_SECRET')).toThrow(/Cannot read TEST_SECRET_FILE/)
  })
})
