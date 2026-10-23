'use strict'

import {
  getValidPriorStates,
  validateTransition,
  assertValidTransition,
  getTransitionTable,
  StateConflictError,
} from '../../src/lib/escrow-transitions'
import { EscrowStatus, EscrowEventType } from '../../src/types/escrow.types'
import { releaseFunds, updateEscrowStatus } from '../../src/repositories/escrow.repository'
import { releaseFundsHandler } from '../../src/routes/escrows/release-funds.handler'
import { hasuraRequest } from '../../src/services/hasura'
import {
  logAndCheckWebhookEvent,
  markWebhookEventProcessed,
  processWebhookEvent,
} from '../../src/repositories/webhook-event.repository'
import {
  mirrorReservationStatus,
  mirrorReservationStatusInTransaction,
} from '../../src/repositories/reservation.repository'
import { notifyHotelEscrowConversation } from '../../src/services/hotel-conversation-notify'
import { Request, Response } from 'express'
import type { PoolClient } from 'pg'

jest.mock('../../src/services/hasura')
jest.mock('../../src/repositories/webhook-event.repository')
jest.mock('../../src/repositories/reservation.repository')
jest.mock('../../src/services/hotel-conversation-notify')

const mockedHasuraRequest = hasuraRequest as jest.MockedFunction<typeof hasuraRequest>
const mockedLogAndCheck = logAndCheckWebhookEvent as jest.MockedFunction<typeof logAndCheckWebhookEvent>
const mockedMarkProcessed = markWebhookEventProcessed as jest.MockedFunction<typeof markWebhookEventProcessed>
const mockedProcessWebhookEvent = processWebhookEvent as jest.MockedFunction<typeof processWebhookEvent>
const mockedMirrorReservation = mirrorReservationStatus as jest.MockedFunction<typeof mirrorReservationStatus>
const mockedMirrorReservationInTx =
  mirrorReservationStatusInTransaction as jest.MockedFunction<typeof mirrorReservationStatusInTransaction>
const mockedNotify = notifyHotelEscrowConversation as jest.MockedFunction<typeof notifyHotelEscrowConversation>

describe('Escrow Transition Guard and Replay Protection (ARCH-A5)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  // ── 1. Shared Transition Module Validation ───────────────────────────────────
  describe('Shared transition module (escrow-state-machine delegation)', () => {
    it('returns canonical valid prior states for release', () => {
      const priorStates = getValidPriorStates(
        EscrowStatus.Completed,
        EscrowEventType.FundsReleased
      )
      expect(priorStates).toContain('funded')
      expect(priorStates).toContain('milestone_approved')
      expect(priorStates).not.toContain('created')
      expect(priorStates).not.toContain('completed')
    })

    it('returns canonical valid prior states for funding', () => {
      const priorStates = getValidPriorStates(
        EscrowStatus.Funded,
        EscrowEventType.Funded
      )
      expect(priorStates).toEqual(['created', 'pending_funding'])
    })

    it('validates legal transitions successfully', () => {
      expect(validateTransition(EscrowStatus.Funded, EscrowStatus.Completed, EscrowEventType.FundsReleased)).toBe(true)
      expect(validateTransition(EscrowStatus.MilestoneApproved, EscrowStatus.Completed, EscrowEventType.FundsReleased)).toBe(true)
      expect(validateTransition(EscrowStatus.Created, EscrowStatus.Funded, EscrowEventType.Funded)).toBe(true)
      expect(validateTransition(EscrowStatus.Disputed, EscrowStatus.Resolved, EscrowEventType.DisputeResolved)).toBe(true)
    })

    it('rejects illegal transitions via validateTransition and assertValidTransition', () => {
      expect(validateTransition(EscrowStatus.Created, EscrowStatus.Completed, EscrowEventType.FundsReleased)).toBe(false)
      expect(validateTransition(EscrowStatus.Completed, EscrowStatus.Completed, EscrowEventType.FundsReleased)).toBe(false)
      expect(validateTransition(EscrowStatus.Completed, EscrowStatus.Cancelled, EscrowEventType.Cancelled)).toBe(false)

      expect(() => {
        assertValidTransition(EscrowStatus.Created, EscrowStatus.Completed, EscrowEventType.FundsReleased)
      }).toThrow(StateConflictError)
    })

    it('exposes the complete canonical transition table', () => {
      const table = getTransitionTable()
      expect(Array.isArray(table)).toBe(true)
      expect(table.length).toBeGreaterThanOrEqual(8)
      const releaseRule = table.find(
        (r) => r.to === 'completed' && r.event === 'funds.released'
      )
      expect(releaseRule).toBeDefined()
      expect(releaseRule?.from).toContain('funded')
    })
  })

  // ── 2. Invalid-Prior-State Rejection Tests ──────────────────────────────────
  describe('Invalid-prior-state rejection (release non-funded escrow)', () => {
    it('attempts to release a non-funded (created) escrow and asserts rejection via StateConflictError', async () => {
      // When escrow is in 'created' state, Hasura status IN ($validStates) matches 0 rows
      mockedHasuraRequest.mockResolvedValueOnce({
        update_trustless_work_escrows: { returning: [] },
      })

      // Attempting to release a non-funded escrow must throw StateConflictError
      await expect(releaseFunds('contract-non-funded', ['funded'])).rejects.toThrow(
        StateConflictError
      )

      expect(mockedHasuraRequest).toHaveBeenCalledWith(
        expect.stringContaining('ReleaseFunds'),
        expect.objectContaining({
          contractId: 'contract-non-funded',
          validStates: ['funded'],
        })
      )
    })

    it('rejects release of non-funded escrow using default canonical prior states', async () => {
      mockedHasuraRequest.mockResolvedValueOnce({
        update_trustless_work_escrows: { returning: [] },
      })

      await expect(releaseFunds('contract-unfunded')).rejects.toThrow(
        StateConflictError
      )

      expect(mockedHasuraRequest).toHaveBeenCalledWith(
        expect.stringContaining('ReleaseFunds'),
        expect.objectContaining({
          contractId: 'contract-unfunded',
          validStates: expect.arrayContaining(['funded', 'milestone_approved']),
        })
      )
    })

    it('rejects status update via generic updater when status guard fails', async () => {
      mockedHasuraRequest.mockResolvedValueOnce({
        update_trustless_work_escrows: { affected_rows: 0 },
      })

      await expect(
        updateEscrowStatus('contract-xyz', 'completed', ['funded'])
      ).rejects.toThrow(StateConflictError)
    })
  })

  // ── 3. Replay Protection and Idempotency Tests ──────────────────────────────
  describe('Replay protection and idempotent rejection', () => {
    it('attempts to replay an already-completed release against DB and asserts rejection with StateConflictError', async () => {
      // Escrow is already 'completed', so status IN ('funded', 'milestone_approved') returns 0 rows
      mockedHasuraRequest.mockResolvedValueOnce({
        update_trustless_work_escrows: { returning: [] },
      })

      await expect(releaseFunds('contract-already-completed')).rejects.toThrow(
        StateConflictError
      )
    })

    it('handles duplicate replay idempotently via webhook event log in releaseFundsHandler', async () => {
      mockedProcessWebhookEvent.mockResolvedValueOnce({
        isDuplicate: true,
        eventId: 'event-dup-123',
        result: null,
      })

      const req = {
        body: {
          contractId: 'contract-123',
          releaseSigner: 'signer-abc',
        },
      } as unknown as Request

      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
      } as unknown as Response

      await releaseFundsHandler(req, res)

      expect(mockedProcessWebhookEvent).toHaveBeenCalledWith(
        'contract-123',
        EscrowEventType.FundsReleased,
        req.body,
        expect.any(Function)
      )
      expect(res.status).toHaveBeenCalledWith(200)
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          duplicate: true,
          eventId: 'event-dup-123',
        })
      )
      // No side effect should occur on duplicate replay
      expect(mockedNotify).not.toHaveBeenCalled()
    })

    it('returns 409 Conflict when releaseFunds throws StateConflictError in handler', async () => {
      mockedProcessWebhookEvent.mockRejectedValueOnce(
        new StateConflictError(
          "Escrow cannot transition to completed: contractId 'contract-invalid-state' current status 'created' not in [funded, milestone_approved]"
        )
      )

      const req = {
        body: {
          contractId: 'contract-invalid-state',
          releaseSigner: 'signer-abc',
        },
      } as unknown as Request

      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
      } as unknown as Response

      await releaseFundsHandler(req, res)

      expect(res.status).toHaveBeenCalledWith(409)
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.stringContaining('Escrow cannot transition to completed'),
        })
      )
      expect(mockedNotify).not.toHaveBeenCalled()
    })

    it('successfully releases funds when escrow is in valid prior state', async () => {
      mockedProcessWebhookEvent.mockResolvedValueOnce({
        isDuplicate: false,
        eventId: 'event-fresh-789',
        result: {
          escrow: {
            id: 'escrow-uuid-789',
            contractId: 'contract-valid',
            status: 'completed',
            balance: 0,
          },
          alreadyCompleted: false,
        },
      })

      const req = {
        body: {
          contractId: 'contract-valid',
          releaseSigner: 'signer-abc',
        },
      } as unknown as Request

      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
      } as unknown as Response

      await releaseFundsHandler(req, res)

      expect(res.status).toHaveBeenCalledWith(200)
      expect(res.json).toHaveBeenCalledWith({ success: true })
      expect(mockedNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          contractId: 'contract-valid',
          eventType: 'escrow_completed',
        })
      )
    })

    it('recovers and completes release when retried on an already completed escrow', async () => {
      const fakeClient = {
        query: jest
          .fn()
          // First query: releaseFundsInTransaction UPDATE matches 0 rows
          .mockResolvedValueOnce({ rows: [] })
          // Second query: lookup returns an already-completed escrow
          .mockResolvedValueOnce({
            rows: [
              {
                id: 'escrow-uuid-101',
                contract_id: 'contract-already-completed',
                status: 'completed',
                balance: 0,
              },
            ],
          }),
      } as unknown as PoolClient

      mockedProcessWebhookEvent.mockImplementationOnce(
        async (_cid, _etype, _payload, callback) => {
          const result = await callback(fakeClient)
          return {
            isDuplicate: false,
            eventId: 'event-retry-101',
            result,
          }
        }
      )

      const req = {
        body: {
          contractId: 'contract-already-completed',
          releaseSigner: 'signer-abc',
        },
      } as unknown as Request

      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
      } as unknown as Response

      await releaseFundsHandler(req, res)

      expect(res.status).toHaveBeenCalledWith(200)
      expect(res.json).toHaveBeenCalledWith({ success: true })
      expect(mockedMirrorReservationInTx).toHaveBeenCalledWith(
        fakeClient,
        'escrow-uuid-101',
        'completed'
      )
      // Notification is skipped on replay of already-completed escrow
      expect(mockedNotify).not.toHaveBeenCalled()
    })

    it('throws StateConflictError in callback when retried escrow is in an invalid prior state (created)', async () => {
      const fakeClient = {
        query: jest
          .fn()
          // First query: releaseFundsInTransaction UPDATE matches 0 rows
          .mockResolvedValueOnce({ rows: [] })
          // Second query: lookup returns an escrow in 'created' state
          .mockResolvedValueOnce({
            rows: [
              {
                id: 'escrow-uuid-created',
                contract_id: 'contract-created',
                status: 'created',
                balance: 100,
              },
            ],
          }),
      } as unknown as PoolClient

      mockedProcessWebhookEvent.mockImplementationOnce(
        async (_cid, _etype, _payload, callback) => {
          const result = await callback(fakeClient)
          return {
            isDuplicate: false,
            eventId: 'event-fail',
            result,
          }
        }
      )

      const req = {
        body: {
          contractId: 'contract-created',
          releaseSigner: 'signer-abc',
        },
      } as unknown as Request

      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
      } as unknown as Response

      await releaseFundsHandler(req, res)

      expect(res.status).toHaveBeenCalledWith(409)
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.stringContaining('Escrow cannot transition to completed'),
        })
      )
      expect(mockedNotify).not.toHaveBeenCalled()
    })
  })
})
