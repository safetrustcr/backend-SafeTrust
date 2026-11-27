import { readFileSync } from 'node:fs'

/**
 * Reads a configuration secret from a file when `<NAME>_FILE` is set, otherwise
 * from the `<NAME>` environment variable.
 *
 * File-backed secrets are the production path: Compose mounts them under
 * /run/secrets/… and they never show up in `docker inspect` or in the
 * environment of every process in the container. Plain variables stay supported
 * for local development.
 *
 * A `*_FILE` that is set but unreadable is a configuration error and throws —
 * silently falling back to the environment would hide a broken mount.
 */
export function readSecret(name: string): string | undefined {
  const filePath = process.env[`${name}_FILE`]?.trim()

  if (filePath) {
    let contents: string
    try {
      contents = readFileSync(filePath, 'utf8')
    } catch (err) {
      throw new Error(
        `[secrets] Cannot read ${name}_FILE (${filePath}): ${(err as Error).message}`
      )
    }
    // Files written by `echo` or an editor end with a newline that is not part
    // of the value.
    const value = contents.replace(/\r?\n$/, '')
    if (value.length > 0) return value
  }

  const value = process.env[name]
  return value === undefined || value === '' ? undefined : value
}
