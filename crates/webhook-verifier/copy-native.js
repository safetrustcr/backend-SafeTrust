'use strict'

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const crateDir = __dirname
const dest = path.join(crateDir, 'index.node')
const libNames = [
  'libwebhook_verifier.so',
  'libwebhook_verifier.dylib',
  'webhook_verifier.dll',
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
    'webhook-verifier: native library not found. Run `cargo build --release` first.'
  )
  process.exit(1)
}

fs.copyFileSync(found, dest)
console.log(`webhook-verifier: wrote ${dest} from ${found}`)
