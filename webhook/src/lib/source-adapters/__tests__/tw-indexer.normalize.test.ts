import {
  configuredAmount,
  deriveEscrowStatus,
  normalizeIndexerEscrow,
  normalizeIndexerEscrows,
  validateIndexerEscrow,
} from '../tw-indexer.normalize'
import type { TwIndexerEscrow, TwMilestone } from '../tw-indexer.types'

const ROLES = {
  approver: 'GAPPROVER',
  serviceProvider: 'GHOST',
  platformAddress: 'GPLATFORM',
  releaseSigner: 'GRELEASER',
  disputeResolver: 'GRESOLVER',
  receiver: 'GHOST',
}

function single(overrides: Partial<TwIndexerEscrow> = {}): TwIndexerEscrow {
  return {
    contractId: 'CSINGLE',
    type: 'single-release',
    amount: 500,
    balance: 0,
    roles: ROLES,
    flags: { approved: false, disputed: false, released: false, resolved: false },
    milestones: [
      { description: 'Check-in', approved: false },
      { description: 'Check-out', approved: false },
    ],
    ...overrides,
  }
}

function multi(milestones: TwMilestone[], overrides: Partial<TwIndexerEscrow> = {}): TwIndexerEscrow {
  return {
    contractId: 'CMULTI',
    type: 'multi-release',
    balance: 0,
    roles: { ...ROLES, receiver: undefined },
    milestones,
    ...overrides,
  }
}

const ms = (flags: TwMilestone['flags'] = {}, amount = 100): TwMilestone => ({
  description: 'stage', amount, receiver: 'GHOST', flags,
})

describe('deriveEscrowStatus — single-release', () => {
  it.each([
    [{ isCancelled: true, isDisputed: true, isCompleted: true, isPending: true }, 'cancelled'],
    [{ isDisputed: true, isCompleted: true, isPending: true }, 'disputed'],
    [{ isCompleted: true, isPending: true }, 'completed'],
    [{ isPending: true }, 'pending_funding'],
  ])('applies V1 flag precedence for %j', (flags, expected) => {
    expect(deriveEscrowStatus(single({ flags }))).toBe(expected)
  })

  it.each<[string, Partial<TwIndexerEscrow>, string]>([
    ['nothing funded', {}, 'created'],
    ['balance above zero', { balance: 500 }, 'funded'],
    ['fundedBy set without a balance read', { balance: undefined, fundedBy: 'GGUEST' }, 'funded'],
    ['one milestone approved', {
      balance: 500,
      milestones: [{ description: 'a', approved: true }, { description: 'b', approved: false }],
    }, 'milestone_approved'],
    ['disputed', { balance: 500, flags: { disputed: true } }, 'disputed'],
    ['released', { balance: 0, flags: { released: true } }, 'completed'],
    ['resolved', { flags: { disputed: true, resolved: true } }, 'resolved'],
  ])('%s → %s', (_label, overrides, expected) => {
    expect(deriveEscrowStatus(single(overrides))).toBe(expected)
  })

  it('lets a dispute win over approved milestones', () => {
    expect(deriveEscrowStatus(single({
      balance: 500,
      flags: { disputed: true },
      milestones: [{ description: 'a', approved: true }],
    }))).toBe('disputed')
  })

  it('treats a missing type as single-release', () => {
    expect(deriveEscrowStatus(single({ type: undefined, flags: { released: true } }))).toBe('completed')
  })
})

describe('deriveEscrowStatus — multi-release', () => {
  it.each<[string, TwMilestone[], Partial<TwIndexerEscrow>, string]>([
    ['nothing funded', [ms(), ms()], {}, 'created'],
    ['funded', [ms(), ms()], { balance: 200 }, 'funded'],
    ['one milestone approved', [ms({ approved: true }), ms()], { balance: 200 }, 'milestone_approved'],
    ['one milestone released, one pending', [ms({ approved: true, released: true }), ms()], { balance: 100 }, 'milestone_approved'],
    ['one milestone disputed', [ms({ disputed: true }), ms({ approved: true })], { balance: 200 }, 'disputed'],
    ['a resolved dispute does not count as open', [ms({ disputed: true, resolved: true }), ms({ approved: true })], { balance: 100 }, 'milestone_approved'],
    ['every milestone released', [ms({ released: true }), ms({ released: true })], {}, 'completed'],
    ['all settled, one by dispute resolution', [ms({ released: true }), ms({ disputed: true, resolved: true })], {}, 'resolved'],
  ])('%s → %s', (_label, milestones, overrides, expected) => {
    expect(deriveEscrowStatus(multi(milestones, overrides))).toBe(expected)
  })

  it('falls back to escrow flags when there are no milestones', () => {
    expect(deriveEscrowStatus(multi([], { flags: { released: true } }))).toBe('completed')
  })
})

describe('configuredAmount', () => {
  it('uses the single-release amount', () => {
    expect(configuredAmount(single({ amount: 500 }))).toBe(500)
  })

  it('sums multi-release milestone amounts', () => {
    expect(configuredAmount(multi([ms({}, 120), ms({}, 80)]))).toBe(200)
  })

  it('accepts numeric strings', () => {
    expect(configuredAmount(single({ amount: '42.5' }))).toBe(42.5)
    expect(configuredAmount(multi([ms({}, '10' as unknown as number), ms({}, 5)]))).toBe(15)
  })

  it('returns 0 for a missing or non-numeric amount', () => {
    expect(configuredAmount(single({ amount: undefined }))).toBe(0)
    expect(configuredAmount(single({ amount: 'lots' }))).toBe(0)
  })
})

describe('normalizeIndexerEscrow', () => {
  it('maps a V1 escrow onto the current table columns', () => {
    expect(normalizeIndexerEscrow(single({ balance: '500', milestones: [{ description: 'a', approved: true }] }))).toEqual({
      contractId: 'CSINGLE',
      status: 'milestone_approved',
      amount: 500,
      balance: 500,
      escrowType: 'single_release',
      roles: { marker: 'GHOST', approver: 'GAPPROVER', releaser: 'GRELEASER' },
      ledgerSeq: null,
    })
  })

  it('marks multi-release escrows', () => {
    expect(normalizeIndexerEscrow(multi([ms()])).escrowType).toBe('multi_release')
  })

  it('sends a 0 balance when the indexer did not report one', () => {
    expect(normalizeIndexerEscrow(single({ balance: undefined })).balance).toBe(0)
  })

  it('keeps an escrow without a contract id, with an empty id, so the upsert skips it', () => {
    expect(normalizeIndexerEscrow({ flags: {} }).contractId).toBe('')
  })

  it.each([null, undefined, 'text', 42, []])('tolerates junk input %p', (raw) => {
    expect(normalizeIndexerEscrow(raw)).toMatchObject({ contractId: '', status: 'created', amount: 0 })
  })

  it('leaves missing roles empty instead of guessing', () => {
    expect(normalizeIndexerEscrow(single({ roles: undefined })).roles).toEqual({
      marker: '', approver: '', releaser: '',
    })
  })

  it('ignores non-string role values instead of writing them', () => {
    const roles = { serviceProvider: 42, approver: { a: 1 }, releaseSigner: 'GRELEASER' }
    expect(normalizeIndexerEscrow(single({ roles: roles as never })).roles).toEqual({
      marker: '', approver: '', releaser: 'GRELEASER',
    })
  })
})

describe('validateIndexerEscrow', () => {
  it.each<[string, unknown]>([
    ['a valid single-release escrow', single()],
    ['a valid multi-release escrow', multi([ms(), ms({ approved: true })])],
    ['an absent milestone array', single({ milestones: undefined })],
    ['a null milestone array', single({ milestones: null as never })],
    ['an empty milestone array', single({ milestones: [] })],
  ])('accepts %s', (_label, raw) => {
    expect(validateIndexerEscrow(raw)).toBeNull()
  })

  it.each<[string, unknown, string]>([
    ['a non-object', 'escrow', 'escrow is not an object'],
    ['an array', [single()], 'escrow is not an object'],
    ['a missing contractId', { ...single(), contractId: undefined }, 'missing contractId'],
    ['a blank contractId', { ...single(), contractId: '  ' }, 'missing contractId'],
    ['a null milestone', single({ milestones: [null as never] }), 'milestones[0] is not an object'],
    ['a primitive milestone', single({ milestones: [{ description: 'a' }, 7 as never] }), 'milestones[1] is not an object'],
    ['a non-array milestones field', single({ milestones: { 0: {} } as never }), 'milestones is not an array'],
    ['non-object milestone flags', multi([{ ...ms(), flags: 'released' as never }]), 'milestones[0].flags is not an object'],
    ['non-object escrow flags', single({ flags: true as never }), 'flags is not an object'],
    ['non-object roles', single({ roles: 'GHOST' as never }), 'roles is not an object'],
  ])('rejects %s', (_label, raw, reason) => {
    expect(validateIndexerEscrow(raw)).toBe(reason)
  })
})

describe('normalizeIndexerEscrows', () => {
  it('skips an invalid record without blocking valid siblings', () => {
    const broken = single({ contractId: 'CBROKEN', milestones: [null as never] })
    const { escrows, invalid } = normalizeIndexerEscrows([single(), broken, multi([ms()])])

    expect(escrows.map((e) => e.contractId)).toEqual(['CSINGLE', 'CMULTI'])
    expect(invalid).toEqual([{ contractId: 'CBROKEN', reason: 'milestones[0] is not an object' }])
  })

  it('reports an invalid record without a contract id', () => {
    expect(normalizeIndexerEscrows([{ flags: {} }]).invalid).toEqual([
      { contractId: undefined, reason: 'missing contractId' },
    ])
  })
})
