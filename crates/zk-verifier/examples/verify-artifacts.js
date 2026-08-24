'use strict'

const fs = require('fs')
const path = require('path')
const { verifyProofOfFunds } = require('..')

const paths = process.argv.slice(2)
if (paths.length !== 3) {
  console.error('usage: node verify-artifacts.js <proof> <vk> <public_inputs>')
  process.exit(2)
}

const [proof, verificationKey, publicInputs] = paths.map((file) =>
  fs.readFileSync(path.resolve(file)).toString('hex')
)

const isValid = verifyProofOfFunds(proof, verificationKey, publicInputs)
console.log(isValid ? 'valid' : 'invalid')
process.exitCode = isValid ? 0 : 1
