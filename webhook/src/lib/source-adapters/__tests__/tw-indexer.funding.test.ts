import {
  evaluateFundingStatus,
  deriveEscrowStatus,
} from '../tw-indexer.normalize'
import type { TwIndexerEscrow } from '../tw-indexer.types'

describe('TW Indexer Funding and Status Derivation', () => {
  it('classifies as created when balance is 0 and no flags set', () => {
    const escrow: TwIndexerEscrow = {
      contractId: 'C1',
      amount: 100,
      balance: 0,
    }

    expect(evaluateFundingStatus(escrow)).toBe('created')
    expect(deriveEscrowStatus(escrow)).toBe('created')
  })

  it('classifies as partially_funded when balance > 0 but less than target amount', () => {
    const escrow: TwIndexerEscrow = {
      contractId: 'C1',
      amount: 100,
      balance: 50,
    }

    expect(evaluateFundingStatus(escrow)).toBe('partially_funded')
    expect(deriveEscrowStatus(escrow)).toBe('partially_funded')
  })

  it('classifies as funded when balance equals configured amount', () => {
    const escrow: TwIndexerEscrow = {
      contractId: 'C1',
      amount: 100,
      balance: 100,
    }

    expect(evaluateFundingStatus(escrow)).toBe('funded')
    expect(deriveEscrowStatus(escrow)).toBe('funded')
  })

  it('classifies as funded when balance exceeds configured amount', () => {
    const escrow: TwIndexerEscrow = {
      contractId: 'C1',
      amount: 100,
      balance: 100.0000001,
    }

    expect(evaluateFundingStatus(escrow)).toBe('funded')
    expect(deriveEscrowStatus(escrow)).toBe('funded')
  })

  it('handles exact decimal stroops precision correctly', () => {
    const escrow: TwIndexerEscrow = {
      contractId: 'C1',
      amount: '123.4567890',
      balance: '123.4567889', // exactly 1 stroop short
    }

    expect(evaluateFundingStatus(escrow)).toBe('partially_funded')
    expect(deriveEscrowStatus(escrow)).toBe('partially_funded')
  })

  it('prioritizes flags over funding for settled states', () => {
    const escrow: TwIndexerEscrow = {
      contractId: 'C1',
      amount: 100,
      balance: 100,
      flags: {
        released: true,
      },
    }

    expect(deriveEscrowStatus(escrow)).toBe('completed')
  })
})
