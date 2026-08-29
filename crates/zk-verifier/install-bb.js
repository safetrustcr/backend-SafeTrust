'use strict'

const crypto = require('crypto')
const fs = require('fs')
const https = require('https')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const VERSION = '5.0.0-nightly.20260522'
const RELEASE_URL = `https://github.com/AztecProtocol/barretenberg/releases/download/v${VERSION}`
const ASSETS = {
  'darwin-arm64': ['barretenberg-arm64-darwin.tar.gz', 'f566c48ba0dace70a7a3464dae1157c6e69b5260b1e2ec0f579713f9e7a70300'],
  'darwin-x64': ['barretenberg-amd64-darwin.tar.gz', '9ca2e275f7925635f1241eae4c187491e4fb8dac5fbf649cb6596fac621d43fc'],
  'linux-arm64': ['barretenberg-arm64-linux.tar.gz', 'b6842ea75c171fd84b5e8fa0af75f61121d0c3dee1c52e17b7f8d7619a4189fe'],
  'linux-x64': ['barretenberg-amd64-linux.tar.gz', 'd207ec90fbfa2fba24d7a47b7a75892ee052b7984252b866a4a0c1b5296e1571'],
  'win32-x64': ['barretenberg-amd64-windows.tar.gz', '41bc04d53db52aeb9b75639499ee3a95777433a4ede77bdc08601263bf7ebd4b'],
}

function installedVersion(binary) {
  if (!fs.existsSync(binary)) return null
  const result = spawnSync(binary, ['--version'], { encoding: 'utf8' })
  if (result.status !== 0) return null
  return `${result.stdout}${result.stderr}`.trim()
}

function download(url, destination, expectedSha256, redirects = 5) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { 'User-Agent': 'SafeTrust-zk-verifier' } }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume()
        if (redirects === 0) return reject(new Error('too many download redirects'))
        return resolve(download(response.headers.location, destination, expectedSha256, redirects - 1))
      }
      if (response.statusCode !== 200) {
        response.resume()
        return reject(new Error(`BB download failed with HTTP ${response.statusCode}`))
      }

      const hash = crypto.createHash('sha256')
      const output = fs.createWriteStream(destination, { flags: 'wx' })
      response.on('data', (chunk) => hash.update(chunk))
      response.pipe(output)
      output.on('error', reject)
      output.on('finish', () => {
        output.close(() => {
          const actual = hash.digest('hex')
          if (actual !== expectedSha256) {
            return reject(new Error(`BB checksum mismatch: expected ${expectedSha256}, received ${actual}`))
          }
          resolve()
        })
      })
    })
    request.on('error', reject)
  })
}

async function main() {
  const asset = ASSETS[`${process.platform}-${process.arch}`]
  if (!asset) throw new Error(`unsupported BB platform: ${process.platform}-${process.arch}`)

  const binaryName = process.platform === 'win32' ? 'bb.exe' : 'bb'
  const destination = path.join(__dirname, binaryName)
  if (installedVersion(destination) === VERSION) {
    console.log(`zk-verifier: Barretenberg ${VERSION} is already installed`)
    return
  }

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'safetrust-bb-'))
  try {
    const [assetName, sha256] = asset
    const archive = path.join(temporary, assetName)
    await download(`${RELEASE_URL}/${assetName}`, archive, sha256)
    const extracted = spawnSync('tar', ['-xzf', archive, '-C', temporary], { stdio: 'inherit' })
    if (extracted.status !== 0) throw new Error('could not extract the BB release archive')

    const source = path.join(temporary, binaryName)
    fs.copyFileSync(source, destination)
    fs.chmodSync(destination, 0o755)
    if (installedVersion(destination) !== VERSION) throw new Error('installed BB binary has the wrong version')
    console.log(`zk-verifier: installed Barretenberg ${VERSION} at ${destination}`)
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(`zk-verifier: ${error.message}`)
  process.exitCode = 1
})
