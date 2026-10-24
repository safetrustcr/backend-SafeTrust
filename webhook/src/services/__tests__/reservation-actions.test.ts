import {
  allowedActions,
  ReservationStatus,
  Party,
  ReservationAction,
} from '../reservation-actions'

describe('reservation-actions service', () => {
  const allStatuses: ReservationStatus[] = [
    'pending',
    'escrow_created',
    'funded',
    'checked_in',
    'checked_out',
    'completed',
    'disputed',
    'resolved',
    'cancelled',
  ]

  const allParties: Party[] = ['guest', 'host', 'admin']

  describe('Table-driven test: every status × party', () => {
    describe.each(allParties)('Party: %s', (party) => {
      describe.each(allStatuses)('Status: %s', (status) => {
        it('computes correct actions without contract (hasContract = false)', () => {
          const actions = allowedActions(status, party, false)
          const expected: ReservationAction[] = ['view']
          if (status === 'pending' || status === 'escrow_created') {
            expected.push('cancel')
          }
          expect(actions).toEqual(expected)
        })

        it('computes correct actions with contract (hasContract = true)', () => {
          const actions = allowedActions(status, party, true)
          const expected: ReservationAction[] = ['view', 'view_contract']
          if (status === 'pending' || status === 'escrow_created') {
            expected.push('cancel')
          }
          expect(actions).toEqual(expected)
        })
      })
    })
  })

  describe('Specific lifecycle stage checks', () => {
    it('allows cancel on pending reservations without contract', () => {
      expect(allowedActions('pending', 'guest', false)).toEqual(['view', 'cancel'])
      expect(allowedActions('pending', 'host', false)).toEqual(['view', 'cancel'])
      expect(allowedActions('pending', 'admin', false)).toEqual(['view', 'cancel'])
    })

    it('allows cancel and view_contract on escrow_created reservations with contract', () => {
      expect(allowedActions('escrow_created', 'guest', true)).toEqual(['view', 'view_contract', 'cancel'])
      expect(allowedActions('escrow_created', 'host', true)).toEqual(['view', 'view_contract', 'cancel'])
      expect(allowedActions('escrow_created', 'admin', true)).toEqual(['view', 'view_contract', 'cancel'])
    })

    it('does NOT allow cancel once funded', () => {
      expect(allowedActions('funded', 'guest', true)).toEqual(['view', 'view_contract'])
      expect(allowedActions('funded', 'host', true)).toEqual(['view', 'view_contract'])
      expect(allowedActions('funded', 'admin', true)).toEqual(['view', 'view_contract'])
    })

    it('does NOT allow cancel for checked_in, checked_out, completed, disputed, resolved, cancelled', () => {
      const nonCancellableStatuses: ReservationStatus[] = [
        'checked_in',
        'checked_out',
        'completed',
        'disputed',
        'resolved',
        'cancelled',
      ]

      for (const status of nonCancellableStatuses) {
        expect(allowedActions(status, 'guest', false)).not.toContain('cancel')
        expect(allowedActions(status, 'host', false)).not.toContain('cancel')
      }
    })
  })
})
