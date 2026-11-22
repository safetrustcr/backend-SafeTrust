import crypto from 'node:crypto'

export function validateStellarAddress(address: unknown): address is string {
  if (typeof address !== 'string' || address.length !== 56 || !address.startsWith('G')) return false
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = 0; let count = 0; const bytes: number[] = []
  for (const char of address) {
    const value = alphabet.indexOf(char)
    if (value < 0) return false
    bits = (bits << 5) | value; count += 5
    if (count >= 8) { count -= 8; bytes.push((bits >> count) & 255) }
  }
  if (bytes.length !== 35 || bytes[0] !== 0x30) return false
  let crc = 0
  for (const byte of bytes.slice(0, 33)) {
    crc ^= byte << 8
    for (let i = 0; i < 8; i++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
  }
  return crc === (bytes[33] | (bytes[34] << 8))
}

export function verifyHmacSignature(payload: Buffer | Uint8Array, signature: string, secret: string): boolean {
  if (!secret || !signature) return false
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`
  const actual = Buffer.from(signature); const wanted = Buffer.from(expected)
  return actual.length === wanted.length && crypto.timingSafeEqual(actual, wanted)
}

export function verifyStellarEd25519(message: string, signature: string, address: string): boolean {
  if (!validateStellarAddress(address) || !/^[a-f0-9]{128}$/i.test(signature)) return false
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = 0; let count = 0; const bytes: number[] = []
  for (const char of address) { const value = alphabet.indexOf(char); bits = (bits << 5) | value; count += 5; if (count >= 8) { count -= 8; bytes.push((bits >> count) & 255) } }
  const key = Buffer.from('302a300506032b6570032100' + Buffer.from(bytes.slice(1, 33)).toString('hex'), 'hex')
  return crypto.verify(null, Buffer.from(message), { key, format: 'der', type: 'spki' }, Buffer.from(signature, 'hex'))
}
