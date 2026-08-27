'use strict'

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const crateDir = __dirname
const nativeDir = path.join(crateDir, 'native')
const dest = path.join(nativeDir, 'index.node')
const libNames = [
  'libsoroban_reconciler.so',
  'libsoroban_reconciler.dylib',
  'soroban_reconciler.dll',
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
    'soroban-reconciler: native library not found. Run `cargo build --release` first.'
  )
  process.exit(1)
}

fs.mkdirSync(nativeDir, { recursive: true })
fs.copyFileSync(found, dest)
console.log(`soroban-reconciler: wrote ${dest} from ${found}`)
