'use strict'

const fs = require('fs')
const path = require('path')
const { verifyProofOfFunds } = require('..')

const paths = process.argv.slice(2)
if (paths.length !== 4) {
  console.error('usage: node verify-artifacts.js <proof> <vk> <threshold_stroops> <balance_commitment_hex>')
  process.exit(2)
}

const [proofPath, verificationKeyPath, thresholdStroops, balanceCommitment] = paths
const [proof, verificationKey] = [proofPath, verificationKeyPath].map((file) =>
  fs.readFileSync(path.resolve(file)).toString('hex')
)

const isValid = verifyProofOfFunds(
  proof,
  verificationKey,
  thresholdStroops,
  balanceCommitment
)
console.log(isValid ? 'valid' : 'invalid')
process.exitCode = isValid ? 0 : 1
