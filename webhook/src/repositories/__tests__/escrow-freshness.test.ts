'use strict'

/**
 * @file webhook/src/repositories/__tests__/escrow-freshness.test.ts
 * @description Comprehensive database and freshness tests for SafeTrust escrow state updates (Issue #661).
 *
 * Test Coverage:
 * 1. Out-of-order delivery: delayed stale snapshot cannot overwrite newer confirmed state
 * 2. Concurrent writers: two writers reading the same seq both attempt to write — only one succeeds
 * 3. Duplicate observations: same seq, same values — idempotent, no error
 * 4. Valid later transitions: newer seq with valid transition — write succeeds
 * 5. Terminal state protection: completed escrow cannot be overwritten by any incoming observation
 * 6. Network/contract identity: testnet observation rejected for mainnet record
 * 7. Unversioned snapshot policy: writes only to pending records, never confirmed records
 * 8. Exact token amounts: no rounding, no loss of DECIMAL(20,7) precision
 */

import {
  evaluateFreshness,
  formatExactBalance,
  isTerminalStatus,
  isPendingStatus,
  canTransitionStatus,
  balancesEqual,
  CANONICAL_TRANSITIONS,
  StoredEscrowState,
  IncomingEscrowObservation,
} from '../../lib/escrow-freshness'
import {
  updateEscrowWithFreshness,
  applyEscrowFreshnessUpdate,
} from '../escrow.repository'
import { reconcileEscrowAtomic } from '../../lib/reconciliation'

describe('Escrow Freshness & Invariant Enforcement (Issue #661)', () => {
  // ─── 1. Out-of-order delivery ──────────────────────────────────────────────
  describe('1. Out-of-order delivery', () => {
    it('delayed stale snapshot cannot overwrite newer confirmed state', () => {
      const stored: StoredEscrowState = {
        id: 'escrow-1',
        contractId: 'C_OUT_OF_ORDER',
        status: 'completed',
        balance: '0.0000000',
        ledgerSeq: 500n,
        network: 'testnet',
      }

      // Delayed snapshot from earlier ledger sequence 450 (status: funded, balance: 100.5000000)
      const incoming: IncomingEscrowObservation = {
        contractId: 'C_OUT_OF_ORDER',
        status: 'funded',
        balance: '100.5000000',
        ledgerSeq: 450n,
        network: 'testnet',
      }

      const outcome = evaluateFreshness(stored, incoming)

      // Must be rejected as terminal / stale, stored state preserved
      expect(outcome.type).toBe('REJECT_TERMINAL')
    })

    it('stale snapshot on non-terminal state is rejected silently with no write', () => {
      const stored: StoredEscrowState = {
        id: 'escrow-2',
        contractId: 'C_STALE',
        status: 'active',
        balance: '250.1234567',
        ledgerSeq: 300n,
        network: 'testnet',
      }

      const incoming: IncomingEscrowObservation = {
        contractId: 'C_STALE',
        status: 'funded',
        balance: '250.1234567',
        ledgerSeq: 290n, // older sequence
        network: 'testnet',
      }

      const outcome = evaluateFreshness(stored, incoming)
      expect(outcome.type).toBe('REJECT_STALE')
      if (outcome.type === 'REJECT_STALE') {
        expect(outcome.reason).toContain('290 < stored seq 300')
      }
    })
  })

  // ─── 2. Concurrent writers ────────────────────────────────────────────────
  describe('2. Concurrent writers simulation', () => {
    it('two writers reading same seq both attempt to write — second writer evaluates fresh row and is handled deterministically', () => {
      // Writer A and Writer B both read stored state at seq 100
      const initialStored: StoredEscrowState = {
        id: 'escrow-conc',
        contractId: 'C_CONC',
        status: 'funded',
        balance: '500.0000000',
        ledgerSeq: 100n,
        network: 'testnet',
      }

      // Writer A writes at seq 105
      const writerA: IncomingEscrowObservation = {
        contractId: 'C_CONC',
        status: 'active',
        balance: '500.0000000',
        ledgerSeq: 105n,
        network: 'testnet',
      }

      const outcomeA = evaluateFreshness(initialStored, writerA)
      expect(outcomeA.type).toBe('WRITE')
      expect(outcomeA).toEqual({
        type: 'WRITE',
        status: 'active',
        balance: '500.0000000',
        ledgerSeq: 105n,
      })

      // State is updated by Writer A
      const updatedStored: StoredEscrowState = {
        ...initialStored,
        status: 'active',
        ledgerSeq: 105n,
      }

      // Writer B attempts to write with an older sequence 104
      const writerB_older: IncomingEscrowObservation = {
        contractId: 'C_CONC',
        status: 'milestone_approved',
        balance: '500.0000000',
        ledgerSeq: 104n,
        network: 'testnet',
      }

      const outcomeB_stale = evaluateFreshness(updatedStored, writerB_older)
      expect(outcomeB_stale.type).toBe('REJECT_STALE')

      // Writer B attempts to write with same sequence 105 but conflicting values
      const writerB_conflict: IncomingEscrowObservation = {
        contractId: 'C_CONC',
        status: 'cancelled',
        balance: '0.0000000',
        ledgerSeq: 105n,
        network: 'testnet',
      }

      const outcomeB_conflict = evaluateFreshness(updatedStored, writerB_conflict)
      expect(outcomeB_conflict.type).toBe('CONFLICT_LOG')
      if (outcomeB_conflict.type === 'CONFLICT_LOG') {
        expect(outcomeB_conflict.reason).toContain('Equal sequence conflict at ledger 105')
      }
    })
  })

  // ─── 3. Duplicate observations ────────────────────────────────────────────
  describe('3. Duplicate observations (idempotency)', () => {
    it('same seq, same values — idempotent, no write, no error', () => {
      const stored: StoredEscrowState = {
        id: 'escrow-dup',
        contractId: 'C_DUP',
        status: 'funded',
        balance: '123.4567890',
        ledgerSeq: 200n,
        network: 'testnet',
      }

      const incoming: IncomingEscrowObservation = {
        contractId: 'C_DUP',
        status: 'funded',
        balance: '123.4567890',
        ledgerSeq: 200n,
        network: 'testnet',
      }

      const outcome = evaluateFreshness(stored, incoming)
      expect(outcome.type).toBe('IDEMPOTENT_UNCHANGED')
    })

    it('same seq, same values with different decimal zero padding — idempotent', () => {
      const stored: StoredEscrowState = {
        id: 'escrow-dup-pad',
        contractId: 'C_DUP_PAD',
        status: 'funded',
        balance: '123.4500000',
        ledgerSeq: 200n,
        network: 'testnet',
      }

      const incoming: IncomingEscrowObservation = {
        contractId: 'C_DUP_PAD',
        status: 'funded',
        balance: '123.45', // unpadded
        ledgerSeq: 200n,
        network: 'testnet',
      }

      const outcome = evaluateFreshness(stored, incoming)
      expect(outcome.type).toBe('IDEMPOTENT_UNCHANGED')
    })
  })

  // ─── 4. Valid later transitions ───────────────────────────────────────────
  describe('4. Valid later transitions', () => {
    it('newer seq with valid transition succeeds along full lifecycle', () => {
      let current: StoredEscrowState = {
        contractId: 'C_LIFECYCLE',
        status: 'pending_funding',
        balance: '0.0000000',
        ledgerSeq: 100n,
        network: 'testnet',
      }

      const steps: Array<{ status: string; balance: string; seq: bigint }> = [
        { status: 'created', balance: '0.0000000', seq: 101n },
        { status: 'funded', balance: '1000.5000000', seq: 102n },
        { status: 'active', balance: '1000.5000000', seq: 103n },
        { status: 'milestone_approved', balance: '1000.5000000', seq: 104n },
        { status: 'completed', balance: '0.0000000', seq: 105n },
      ]

      for (const step of steps) {
        const outcome = evaluateFreshness(current, {
          contractId: 'C_LIFECYCLE',
          status: step.status,
          balance: step.balance,
          ledgerSeq: step.seq,
          network: 'testnet',
        })

        expect(outcome.type).toBe('WRITE')
        if (outcome.type === 'WRITE') {
          expect(outcome.status).toBe(step.status)
          expect(outcome.balance).toBe(step.balance)
          expect(outcome.ledgerSeq).toBe(step.seq)
          current = {
            ...current,
            status: outcome.status,
            balance: outcome.balance,
            ledgerSeq: outcome.ledgerSeq,
          }
        }
      }

      expect(current.status).toBe('completed')
    })

    it('rejects invalid state transition even with a newer sequence number', () => {
      const stored: StoredEscrowState = {
        contractId: 'C_INVALID_TRANS',
        status: 'pending_funding',
        balance: '0.0000000',
        ledgerSeq: 100n,
        network: 'testnet',
      }

      // Trying to jump directly from pending_funding to milestone_approved
      const incoming: IncomingEscrowObservation = {
        contractId: 'C_INVALID_TRANS',
        status: 'milestone_approved',
        balance: '500.0000000',
        ledgerSeq: 200n, // newer sequence!
        network: 'testnet',
      }

      const outcome = evaluateFreshness(stored, incoming)
      expect(outcome.type).toBe('REJECT_INVALID_TRANSITION')
    })
  })

  // ─── 5. Terminal state protection ─────────────────────────────────────────
  describe('5. Terminal state protection', () => {
    it('completed escrow cannot be overwritten by any incoming observation', () => {
      const stored: StoredEscrowState = {
        contractId: 'C_TERMINAL_COMPLETED',
        status: 'completed',
        balance: '0.0000000',
        ledgerSeq: 500n,
        network: 'testnet',
      }

      const attempts: string[] = ['created', 'pending_funding', 'funded', 'active', 'milestone_approved', 'disputed', 'cancelled']

      for (const targetStatus of attempts) {
        const incoming: IncomingEscrowObservation = {
          contractId: 'C_TERMINAL_COMPLETED',
          status: targetStatus,
          balance: '1000.0000000',
          ledgerSeq: 999999n, // much newer sequence!
          network: 'testnet',
        }

        const outcome = evaluateFreshness(stored, incoming)
        expect(outcome.type).toBe('REJECT_TERMINAL')
      }
    })

    it('cancelled cannot be reached from completed regardless of sequence', () => {
      const stored: StoredEscrowState = {
        contractId: 'C_NO_CANCEL_FROM_COMPLETED',
        status: 'completed',
        balance: '0.0000000',
        ledgerSeq: 100n,
        network: 'testnet',
      }

      const incoming: IncomingEscrowObservation = {
        contractId: 'C_NO_CANCEL_FROM_COMPLETED',
        status: 'cancelled',
        balance: '0.0000000',
        ledgerSeq: 200n,
        network: 'testnet',
      }

      const outcome = evaluateFreshness(stored, incoming)
      expect(outcome.type).toBe('REJECT_TERMINAL')
      expect(canTransitionStatus('completed', 'cancelled')).toBe(false)
    })

    it('resolved escrow cannot be overwritten by any incoming observation', () => {
      const stored: StoredEscrowState = {
        contractId: 'C_TERMINAL_RESOLVED',
        status: 'resolved',
        balance: '0.0000000',
        ledgerSeq: 300n,
        network: 'testnet',
      }

      const incoming: IncomingEscrowObservation = {
        contractId: 'C_TERMINAL_RESOLVED',
        status: 'funded',
        balance: '500.0000000',
        ledgerSeq: 400n,
        network: 'testnet',
      }

      const outcome = evaluateFreshness(stored, incoming)
      expect(outcome.type).toBe('REJECT_TERMINAL')
    })
  })

  // ─── 6. Network/contract identity ─────────────────────────────────────────
  describe('6. Network and contract identity', () => {
    it('testnet observation rejected for mainnet record', () => {
      const stored: StoredEscrowState = {
        contractId: 'C_MAINNET',
        status: 'funded',
        balance: '10000.0000000',
        ledgerSeq: 100n,
        network: 'mainnet',
      }

      const incoming: IncomingEscrowObservation = {
        contractId: 'C_MAINNET',
        status: 'completed',
        balance: '0.0000000',
        ledgerSeq: 200n,
        network: 'testnet', // spoofed testnet event
      }

      const outcome = evaluateFreshness(stored, incoming)
      expect(outcome.type).toBe('REJECT_NETWORK_MISMATCH')
      if (outcome.type === 'REJECT_NETWORK_MISMATCH') {
        expect(outcome.reason).toContain('Network mismatch')
      }
    })

    it('stellar:mainnet and stellar:testnet URI prefixes handled correctly', () => {
      const stored: StoredEscrowState = {
        contractId: 'C_STELLAR_NET',
        status: 'funded',
        balance: '50.0000000',
        ledgerSeq: 100n,
        network: 'stellar:mainnet',
      }

      const incoming: IncomingEscrowObservation = {
        contractId: 'C_STELLAR_NET',
        status: 'completed',
        balance: '0.0000000',
        ledgerSeq: 200n,
        network: 'stellar:testnet',
      }

      const outcome = evaluateFreshness(stored, incoming)
      expect(outcome.type).toBe('REJECT_NETWORK_MISMATCH')
    })
  })

  // ─── 7. Unversioned snapshot policy ───────────────────────────────────────
  describe('7. Unversioned snapshot policy', () => {
    it('unversioned snapshot rejected for confirmed records', () => {
      const stored: StoredEscrowState = {
        contractId: 'C_CONFIRMED',
        status: 'funded',
        balance: '500.0000000',
        ledgerSeq: 100n,
        network: 'testnet',
      }

      const incoming: IncomingEscrowObservation = {
        contractId: 'C_CONFIRMED',
        status: 'active',
        balance: '500.0000000',
        ledgerSeq: null, // no sequence from source!
        network: 'testnet',
      }

      const outcome = evaluateFreshness(stored, incoming)
      expect(outcome.type).toBe('REJECT_UNVERSIONED_FOR_CONFIRMED')
    })

    it('unversioned snapshot allowed for pending records without zeroing nonzero balance', () => {
      const stored: StoredEscrowState = {
        contractId: 'C_PENDING',
        status: 'created',
        balance: '100.0000000', // nonzero balance already set
        ledgerSeq: null,
        network: 'testnet',
      }

      const incoming: IncomingEscrowObservation = {
        contractId: 'C_PENDING',
        status: 'funded',
        balance: '0.0000000', // unversioned source provides 0 balance
        ledgerSeq: null,
        network: 'testnet',
      }

      const outcome = evaluateFreshness(stored, incoming)
      expect(outcome.type).toBe('WRITE')
      if (outcome.type === 'WRITE') {
        expect(outcome.status).toBe('funded')
        // Preserves stored nonzero balance!
        expect(outcome.balance).toBe('100.0000000')
      }
    })

    it('unversioned snapshot cannot create a new confirmed/terminal record', () => {
      // No stored row + no ledger_seq + non-pending status must be rejected,
      // matching the Rust evaluator (evaluate_observation, stored == None).
      const incoming: IncomingEscrowObservation = {
        contractId: 'C_NEW_TERMINAL',
        status: 'completed',
        balance: '0.0000000',
        ledgerSeq: null,
        network: 'testnet',
      }

      const outcome = evaluateFreshness(null, incoming)
      expect(outcome.type).toBe('REJECT_UNVERSIONED_FOR_CONFIRMED')
    })

    it('unversioned snapshot may create a new pending record', () => {
      const incoming: IncomingEscrowObservation = {
        contractId: 'C_NEW_PENDING',
        status: 'pending_funding',
        balance: '0.0000000',
        ledgerSeq: null,
        network: 'testnet',
      }

      const outcome = evaluateFreshness(null, incoming)
      expect(outcome.type).toBe('WRITE')
    })

    it('versioned snapshot may create a new confirmed record', () => {
      const incoming: IncomingEscrowObservation = {
        contractId: 'C_NEW_VERSIONED',
        status: 'funded',
        balance: '500.0000000',
        ledgerSeq: 42n,
        network: 'testnet',
      }

      const outcome = evaluateFreshness(null, incoming)
      expect(outcome.type).toBe('WRITE')
    })
  })

  // ─── 8. Exact token amounts ───────────────────────────────────────────────
  describe('8. Exact token amounts (no rounding)', () => {
    it('preserves exact fractional amounts losslessly', () => {
      const stored: StoredEscrowState = {
        contractId: 'C_EXACT',
        status: 'created',
        balance: '0.0000000',
        ledgerSeq: 10n,
        network: 'testnet',
      }

      const largePreciseAmount = '9876543210123.1234567'
      const incoming: IncomingEscrowObservation = {
        contractId: 'C_EXACT',
        status: 'funded',
        balance: largePreciseAmount,
        ledgerSeq: 20n,
        network: 'testnet',
      }

      const outcome = evaluateFreshness(stored, incoming)
      expect(outcome.type).toBe('WRITE')
      if (outcome.type === 'WRITE') {
        expect(outcome.balance).toBe(largePreciseAmount)
      }
    })

    it('formats exact balances consistently without floating point rounding', () => {
      expect(formatExactBalance('100.5')).toBe('100.5000000')
      expect(formatExactBalance('0')).toBe('0.0000000')
      expect(formatExactBalance('12345.1234567')).toBe('12345.1234567')
      expect(balancesEqual('100.5', '100.5000000')).toBe(true)
    })
  })

  // ─── 9. Database atomic transaction execution ─────────────────────────────
  describe('9. Database atomic transaction execution (updateEscrowWithFreshness)', () => {
    it('executes atomic BEGIN -> SELECT FOR UPDATE -> UPDATE -> COMMIT pattern', async () => {
      const queryLog: string[] = []
      const fakeClient = {
        query: jest.fn(async (sql: string, params?: any[]) => {
          queryLog.push(sql.trim().split(/\s+/)[0].toUpperCase())
          if (sql.includes('SELECT') && sql.includes('FOR UPDATE')) {
            return {
              rows: [
                {
                  id: 'uuid-1',
                  contract_id: 'C_DB_TEST',
                  status: 'created',
                  balance: '0.0000000',
                  ledger_seq: 100n,
                  network: 'testnet',
                },
              ],
            }
          }
          return { rows: [] }
        }),
        release: jest.fn(),
      }

      const outcome = await updateEscrowWithFreshness(
        'C_DB_TEST',
        {
          status: 'funded',
          balance: '250.0000000',
          ledgerSeq: 110n,
          network: 'testnet',
        },
        fakeClient as any
      )

      expect(outcome.type).toBe('WRITE')
      expect(queryLog).toContain('BEGIN')
      expect(queryLog).toContain('SELECT')
      expect(queryLog).toContain('UPDATE')
      expect(queryLog).toContain('COMMIT')

      const selectCall = fakeClient.query.mock.calls.find((c: any) =>
        c[0].includes('FOR UPDATE')
      )
      expect(selectCall).toBeDefined()

      const updateCall = fakeClient.query.mock.calls.find((c: any) =>
        c[0].trim().startsWith('UPDATE')
      )
      expect(updateCall).toBeDefined()
      expect(updateCall![1]).toEqual([
        'C_DB_TEST',
        'funded',
        '250.0000000',
        '110',
        'testnet',
      ])
    })

    it('rejects stale snapshot and commits without writing', async () => {
      const queryLog: string[] = []
      const fakeClient = {
        query: jest.fn(async (sql: string) => {
          queryLog.push(sql.trim().split(/\s+/)[0].toUpperCase())
          if (sql.includes('FOR UPDATE')) {
            return {
              rows: [
                {
                  id: 'uuid-2',
                  contract_id: 'C_DB_STALE',
                  status: 'funded',
                  balance: '500.0000000',
                  ledger_seq: 200n,
                  network: 'testnet',
                },
              ],
            }
          }
          return { rows: [] }
        }),
        release: jest.fn(),
      }

      const outcome = await updateEscrowWithFreshness(
        'C_DB_STALE',
        {
          status: 'funded',
          balance: '500.0000000',
          ledgerSeq: 150n, // older sequence!
          network: 'testnet',
        },
        fakeClient as any
      )

      expect(outcome.type).toBe('REJECT_STALE')
      expect(queryLog).toContain('BEGIN')
      expect(queryLog).toContain('SELECT')
      expect(queryLog).not.toContain('UPDATE')
      expect(queryLog).toContain('COMMIT')
    })

    it('rejects observation when stored row does not exist rather than creating placeholder identity', async () => {
      const fakeClient = {
        query: jest.fn(async (sql: string) => {
          if (sql.includes('SELECT') && sql.includes('FOR UPDATE')) {
            return { rows: [] } // no matching row
          }
          return { rows: [] }
        }),
        release: jest.fn(),
      }

      const outcome = await updateEscrowWithFreshness(
        'C_MISSING',
        {
          status: 'completed',
          balance: '0.0000000',
          ledgerSeq: 500n,
          network: 'testnet',
        },
        fakeClient as any
      )

      expect(outcome.type).toBe('REJECT_INVALID_TRANSITION')
    })
  })

  // ─── 10. Canonical State Machine Parity ────────────────────────────────────
  describe('10. Canonical State Machine Parity across all status pairs', () => {
    const ALL_STATUSES = [
      'created',
      'pending_funding',
      'funded',
      'active',
      'milestone_approved',
      'completed',
      'disputed',
      'resolved',
      'cancelled',
    ]

    it('verifies canTransitionStatus matches canonical transition rules for all 81 status pairs', () => {
      for (const from of ALL_STATUSES) {
        for (const to of ALL_STATUSES) {
          const result = canTransitionStatus(from, to)
          if (from === to) {
            expect(result).toBe(true)
          } else if (isTerminalStatus(from)) {
            expect(result).toBe(false)
          } else {
            const expected = CANONICAL_TRANSITIONS[from]?.includes(to) ?? false
            expect(result).toBe(expected)
          }
        }
      }
    })
  })
})
