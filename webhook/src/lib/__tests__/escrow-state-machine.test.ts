const {
  validateTransition,
  getValidPriorStates,
  getTransitionTable,
} = require('../../../../crates/escrow-state-machine') as {
  validateTransition: (from: string, to: string, event: string) => boolean
  getValidPriorStates: (to: string, event: string) => string
  getTransitionTable: () => string
}

describe('escrow-state-machine native addon', () => {
  it('validateTransition returns true for a legal transition', () => {
    expect(validateTransition('created', 'funded', 'escrow.funded')).toBe(true)
  })

  it('validateTransition returns false for an illegal transition', () => {
    expect(validateTransition('completed', 'created', 'escrow.initialized')).toBe(false)
  })

  it('validateTransition throws on an unknown status', () => {
    expect(() => validateTransition('unknown_status', 'funded', 'escrow.funded')).toThrow(
      /Unknown escrow status/
    )
  })

  it('getValidPriorStates returns the prior states for funded', () => {
    expect(getValidPriorStates('funded', 'escrow.funded')).toBe('["created","pending_funding"]')
  })

  it('getValidPriorStates throws when no legal transition exists', () => {
    expect(() => getValidPriorStates('completed', 'dispute.raised')).toThrow(
      /No valid prior states/
    )
  })

  it('getTransitionTable returns the full transition graph', () => {
    const table = JSON.parse(getTransitionTable())
    expect(Array.isArray(table)).toBe(true)
    expect(table.length).toBe(8)
    const fundedRule = table.find(
      (r: { to: string; event: string }) => r.to === 'funded' && r.event === 'escrow.funded'
    )
    expect(fundedRule.from.sort()).toEqual(['created', 'pending_funding'])
  })
})
