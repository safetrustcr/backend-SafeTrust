'use strict'

// Copies the compiled cdylib (built by `cargo build --release`) to `index.node`
// so `require('pg-bulk-upsert')` resolves it. Mirrors the other crates'
// copy-native.js: the workspace target directory is shared, so the artifact may
// live under the repo-root target/ rather than a crate-local one.

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const crateDir = __dirname
const dest = path.join(crateDir, 'index.node')
const libNames = [
  'libpg_bulk_upsert.so',
  'libpg_bulk_upsert.dylib',
  'pg_bulk_upsert.dll',
]

function cargoTargetDirectory() {
  try {
    const meta = JSON.parse(
      execSync('cargo metadata --format-version 1 --no-deps', {
        cwd: crateDir,
        encoding: 'utf8',
      })
    )
    if (meta && typeof meta.target_directory === 'string') {
      return meta.target_directory
    }
  } catch {
    // Fall through to conventional locations.
  }
  return null
}

const releaseDirs = [
  path.join(crateDir, 'target', 'release'),
  path.join(crateDir, '..', '..', 'target', 'release'),
]

const targetDir = cargoTargetDirectory()
if (targetDir) {
  releaseDirs.unshift(path.join(targetDir, 'release'))
}

let found = null
for (const dir of releaseDirs) {
  for (const name of libNames) {
    const candidate = path.join(dir, name)
    if (fs.existsSync(candidate)) {
      found = candidate
      break
    }
  }
  if (found) break
}

if (!found) {
  console.error(
    'pg-bulk-upsert: native library not found. Run `cargo build --release` first.'
  )
  process.exit(1)
}

fs.copyFileSync(found, dest)
console.log(`pg-bulk-upsert: wrote ${dest} from ${found}`)
