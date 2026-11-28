import {
  Keypair,
  Account,
  TransactionBuilder,
  Networks,
  Operation,
  Asset,
} from '@stellar/stellar-sdk'
import {
  validateSignedXdr,
  AUTHORIZED_ESCROW_FUNCTIONS,
} from '../confirmation.service'

describe('Signed XDR Security Verification (validateSignedXdr)', () => {
  const keypair = Keypair.random()
  const sourceAccount = new Account(keypair.publicKey(), '100')

  function createSignedTestTx(operation: any, networkPassphrase = Networks.TESTNET): string {
    const tx = new TransactionBuilder(sourceAccount, {
      fee: '100',
      networkPassphrase,
    })
      .addOperation(operation)
      .setTimeout(30)
      .build()

    tx.sign(keypair)
    return tx.toXDR()
  }

  it('rejects empty or non-string input', () => {
    expect(validateSignedXdr('', 'testnet').valid).toBe(false)
    expect(validateSignedXdr(null as any, 'testnet').valid).toBe(false)
  })

  it('rejects malformed or corrupted XDR', () => {
    const result = validateSignedXdr('not_a_valid_xdr_payload', 'testnet')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('Failed to decode signed XDR')
  })

  it('rejects XDR signed for different network (network mismatch)', () => {
    const mainnetXdr = createSignedTestTx(
      Operation.payment({
        destination: keypair.publicKey(),
        asset: Asset.native(),
        amount: '1',
      }),
      Networks.PUBLIC
    )

    // Validated against testnet -> signature / hash mismatch
    const result = validateSignedXdr(mainnetXdr, 'testnet')
    expect(result.valid).toBe(false)
  })

  it('accepts valid payment operation signed for target network', () => {
    const validXdr = createSignedTestTx(
      Operation.payment({
        destination: keypair.publicKey(),
        asset: Asset.native(),
        amount: '10',
      }),
      Networks.TESTNET
    )

    const result = validateSignedXdr(validXdr, 'testnet')
    expect(result.valid).toBe(true)
    expect(result.sourceAccount).toBe(keypair.publicKey())
  })

  it('rejects dangerous account-modification operations (e.g. setOptions)', () => {
    const dangerousXdr = createSignedTestTx(
      Operation.setOptions({
        masterWeight: 0, // dangerous: zeroing master key
      }),
      Networks.TESTNET
    )

    const result = validateSignedXdr(dangerousXdr, 'testnet')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('Security violation: unauthorized operation "setOptions"')
  })

  it('rejects accountMerge operation', () => {
    const dangerousXdr = createSignedTestTx(
      Operation.accountMerge({
        destination: Keypair.random().publicKey(),
      }),
      Networks.TESTNET
    )

    const result = validateSignedXdr(dangerousXdr, 'testnet')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('Security violation: unauthorized operation "accountMerge"')
  })

  it('has known authorized escrow functions list', () => {
    expect(AUTHORIZED_ESCROW_FUNCTIONS.has('fund')).toBe(true)
    expect(AUTHORIZED_ESCROW_FUNCTIONS.has('approve')).toBe(true)
    expect(AUTHORIZED_ESCROW_FUNCTIONS.has('release')).toBe(true)
    expect(AUTHORIZED_ESCROW_FUNCTIONS.has('dispute')).toBe(true)
    expect(AUTHORIZED_ESCROW_FUNCTIONS.has('resolve')).toBe(true)
  })
})
