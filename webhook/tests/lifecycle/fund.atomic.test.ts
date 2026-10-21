'use strict';

import { Request, Response } from 'express';
import { fundEscrowHandler } from '../../src/routes/escrows/fund.handler';
import { releaseFundsHandler } from '../../src/routes/escrows/release-funds.handler';
import {
  fundEscrowTransactional,
  executeEscrowLifecycleTransition,
  EscrowNotFoundError,
  EscrowStateConflictError,
} from '../../src/services/escrow.service';
import { notifyHotelEscrowConversation } from '../../src/services/hotel-conversation-notify';
import { mirrorReservationStatus } from '../../src/repositories/reservation.repository';
import { connect } from '../../src/services/db';
import { FundEscrowPayload, ReleaseFundsPayload } from '@safetrust/types';

jest.mock('../../src/services/hotel-conversation-notify', () => ({
  notifyHotelEscrowConversation: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/db', () => ({
  connect: jest.fn(),
  pool: { connect: jest.fn() },
}));

jest.mock('../../../crates/escrow-state-machine', () => ({
  getValidPriorStates: jest.fn((to: string, _event: string) => {
    if (to === 'funded') return '["created","pending_funding"]';
    if (to === 'completed') return '["milestone_approved"]';
    return '["created"]';
  }),
}), { virtual: true });

const mockedNotify = notifyHotelEscrowConversation as jest.MockedFunction<
  typeof notifyHotelEscrowConversation
>;
const mockedConnect = connect as jest.MockedFunction<typeof connect>;

function makeResponse(): Response {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
}

function makeRequest(body: Partial<FundEscrowPayload>): Request<{}, {}, FundEscrowPayload> {
  return { body } as Request<{}, {}, FundEscrowPayload>;
}

describe('Issue #705: Atomic Escrow Lifecycle & Rollback', () => {
  let timeline: string[];
  let queryLog: Array<{ text: string; params?: unknown[] }>;
  let mockClient: {
    query: jest.Mock;
    release: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    timeline = [];
    queryLog = [];

    mockedNotify.mockImplementation(async () => {
      timeline.push('NOTIFY');
    });

    mockClient = {
      query: jest.fn(),
      release: jest.fn(() => {
        timeline.push('CLIENT_RELEASE');
      }),
    };

    mockedConnect.mockResolvedValue(mockClient as any);
  });

  describe('Reservation mirror failure mid-transaction (full rollback)', () => {
    it('simulates reservation mirror failure mid-transaction and asserts full rollback with uncommitted escrow state', async () => {
      // Setup queries:
      // 1. BEGIN
      // 2. Advisory lock
      // 3. Webhook event duplicate check (not found)
      // 4. Webhook event claim (INSERT)
      // 5. Escrow row lock & select (found, created status)
      // 6. Escrow status update (UPDATE safetrust.trustless_work_escrows)
      // 7. Reservation mirror update -> FAILS!
      // 8. ROLLBACK
      mockClient.query.mockImplementation(async (sql: string, params?: unknown[]) => {
        queryLog.push({ text: sql, params });

        if (sql === 'BEGIN') {
          timeline.push('BEGIN');
          return {};
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          timeline.push('LOCK');
          return {};
        }
        if (sql.includes('FROM safetrust.trustless_work_webhook_events') && sql.includes('processed   = true')) {
          timeline.push('CHECK_DUPLICATE');
          return { rows: [] };
        }
        if (sql.includes('INSERT INTO safetrust.trustless_work_webhook_events')) {
          timeline.push('CLAIM_EVENT');
          return { rows: [{ id: 'event-uuid-1' }] };
        }
        if (sql.includes('FROM safetrust.trustless_work_escrows') && sql.includes('FOR UPDATE')) {
          timeline.push('LOCK_ESCROW');
          return {
            rowCount: 1,
            rows: [{ id: 'escrow-uuid-1', status: 'created', balance: 0 }],
          };
        }
        if (sql.includes('UPDATE safetrust.trustless_work_escrows')) {
          timeline.push('UPDATE_ESCROW');
          return { rowCount: 1 };
        }
        if (sql.includes('UPDATE safetrust.reservations')) {
          timeline.push('UPDATE_RESERVATION_FAIL');
          throw new Error('Database connection reset during reservation mirror');
        }
        if (sql === 'ROLLBACK') {
          timeline.push('ROLLBACK');
          return {};
        }
        if (sql === 'COMMIT') {
          timeline.push('COMMIT');
          return {};
        }
        return { rows: [] };
      });

      const req = makeRequest({
        contractId: 'contract-fail-1',
        signer: 'GUSER',
        amount: 250,
      });
      const res = makeResponse();

      await fundEscrowHandler(req, res);

      // Asserts 500 server error was returned to caller
      expect(res.status).toHaveBeenCalledWith(500);

      // Asserts escrow state was NOT committed: ROLLBACK was executed, COMMIT was NEVER called
      expect(timeline).toContain('BEGIN');
      expect(timeline).toContain('UPDATE_ESCROW');
      expect(timeline).toContain('UPDATE_RESERVATION_FAIL');
      expect(timeline).toContain('ROLLBACK');
      expect(timeline).not.toContain('COMMIT');

      // Asserts notifications were NOT dispatched on rollback
      expect(mockedNotify).not.toHaveBeenCalled();
      expect(timeline).not.toContain('NOTIFY');

      // Asserts client was released
      expect(mockClient.release).toHaveBeenCalledTimes(1);
    });

    it('asserts the event remains claimable for retry after rollback', async () => {
      let isFirstAttempt = true;

      mockClient.query.mockImplementation(async (sql: string, params?: unknown[]) => {
        queryLog.push({ text: sql, params });

        if (sql === 'BEGIN') {
          timeline.push(isFirstAttempt ? 'ATTEMPT_1:BEGIN' : 'ATTEMPT_2:BEGIN');
          return {};
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          timeline.push(isFirstAttempt ? 'ATTEMPT_1:LOCK' : 'ATTEMPT_2:LOCK');
          return {};
        }
        if (sql.includes('FROM safetrust.trustless_work_webhook_events') && sql.includes('processed   = true')) {
          // After rollback of attempt 1, the event is NOT marked processed, so retry finds 0 processed rows
          timeline.push(isFirstAttempt ? 'ATTEMPT_1:CHECK_DUPLICATE' : 'ATTEMPT_2:CHECK_DUPLICATE');
          return { rows: [] };
        }
        if (sql.includes('INSERT INTO safetrust.trustless_work_webhook_events')) {
          timeline.push(isFirstAttempt ? 'ATTEMPT_1:CLAIM_EVENT' : 'ATTEMPT_2:CLAIM_EVENT');
          return { rows: [{ id: isFirstAttempt ? 'event-attempt-1' : 'event-attempt-2' }] };
        }
        if (sql.includes('FROM safetrust.trustless_work_escrows') && sql.includes('FOR UPDATE')) {
          return {
            rowCount: 1,
            rows: [{ id: 'escrow-uuid-1', status: 'created', balance: 0 }],
          };
        }
        if (sql.includes('UPDATE safetrust.trustless_work_escrows')) {
          timeline.push(isFirstAttempt ? 'ATTEMPT_1:UPDATE_ESCROW' : 'ATTEMPT_2:UPDATE_ESCROW');
          return { rowCount: 1 };
        }
        if (sql.includes('UPDATE safetrust.reservations')) {
          if (isFirstAttempt) {
            timeline.push('ATTEMPT_1:UPDATE_RESERVATION_FAIL');
            throw new Error('Deadlock detected in reservations table');
          }
          timeline.push('ATTEMPT_2:UPDATE_RESERVATION_SUCCESS');
          return { rowCount: 1 };
        }
        if (sql.includes('UPDATE safetrust.trustless_work_webhook_events') && sql.includes('processed = true')) {
          timeline.push('ATTEMPT_2:MARK_PROCESSED');
          return { rowCount: 1 };
        }
        if (sql === 'ROLLBACK') {
          timeline.push('ATTEMPT_1:ROLLBACK');
          return {};
        }
        if (sql === 'COMMIT') {
          timeline.push('ATTEMPT_2:COMMIT');
          return {};
        }
        return { rows: [] };
      });

      const req = makeRequest({
        contractId: 'contract-retry-1',
        signer: 'GUSER',
        amount: 300,
      });

      // ── Attempt 1: Fails mid-transaction on reservation mirror ──
      const res1 = makeResponse();
      await fundEscrowHandler(req, res1);
      expect(res1.status).toHaveBeenCalledWith(500);
      expect(timeline).toContain('ATTEMPT_1:ROLLBACK');
      expect(timeline).not.toContain('NOTIFY');

      // ── Attempt 2: Retry succeeds ──
      isFirstAttempt = false;
      const res2 = makeResponse();
      await fundEscrowHandler(req, res2);

      // Asserts the event was claimable and succeeded on retry
      expect(res2.status).toHaveBeenCalledWith(200);
      expect(timeline).toContain('ATTEMPT_2:CHECK_DUPLICATE');
      expect(timeline).toContain('ATTEMPT_2:CLAIM_EVENT');
      expect(timeline).toContain('ATTEMPT_2:UPDATE_ESCROW');
      expect(timeline).toContain('ATTEMPT_2:UPDATE_RESERVATION_SUCCESS');
      expect(timeline).toContain('ATTEMPT_2:MARK_PROCESSED');
      expect(timeline).toContain('ATTEMPT_2:COMMIT');
      expect(timeline).toContain('NOTIFY');
    });
  });

  describe('Atomic commit when all steps succeed', () => {
    it('commits all three state changes atomically and dispatches notifications strictly after commit', async () => {
      mockClient.query.mockImplementation(async (sql: string, params?: unknown[]) => {
        queryLog.push({ text: sql, params });

        if (sql === 'BEGIN') {
          timeline.push('BEGIN');
          return {};
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          timeline.push('LOCK');
          return {};
        }
        if (sql.includes('FROM safetrust.trustless_work_webhook_events') && sql.includes('processed   = true')) {
          timeline.push('CHECK_DUPLICATE');
          return { rows: [] };
        }
        if (sql.includes('INSERT INTO safetrust.trustless_work_webhook_events')) {
          timeline.push('CLAIM_EVENT');
          return { rows: [{ id: 'event-uuid-success' }] };
        }
        if (sql.includes('FROM safetrust.trustless_work_escrows') && sql.includes('FOR UPDATE')) {
          timeline.push('LOCK_ESCROW');
          return {
            rowCount: 1,
            rows: [{ id: 'escrow-uuid-success', status: 'created', balance: 0 }],
          };
        }
        if (sql.includes('UPDATE safetrust.trustless_work_escrows')) {
          timeline.push('UPDATE_ESCROW');
          return { rowCount: 1 };
        }
        if (sql.includes('UPDATE safetrust.reservations')) {
          timeline.push('UPDATE_RESERVATION');
          return { rowCount: 1 };
        }
        if (sql.includes('UPDATE safetrust.trustless_work_webhook_events') && sql.includes('processed = true')) {
          timeline.push('MARK_PROCESSED');
          return { rowCount: 1 };
        }
        if (sql === 'COMMIT') {
          timeline.push('COMMIT');
          return {};
        }
        if (sql === 'ROLLBACK') {
          timeline.push('ROLLBACK');
          return {};
        }
        return { rows: [] };
      });

      const req = makeRequest({
        contractId: 'contract-success-1',
        signer: 'GUSER',
        amount: 500,
      });
      const res = makeResponse();

      await fundEscrowHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);

      // Asserts that all three state changes happened inside the transaction:
      // 1. Webhook event claimed
      // 2. Escrow status updated to 'funded'
      // 3. Reservation status mirrored to 'funded'
      // 4. Webhook event marked processed
      // 5. COMMIT
      const beginIdx = timeline.indexOf('BEGIN');
      const claimEventIdx = timeline.indexOf('CLAIM_EVENT');
      const updateEscrowIdx = timeline.indexOf('UPDATE_ESCROW');
      const updateResIdx = timeline.indexOf('UPDATE_RESERVATION');
      const markProcessedIdx = timeline.indexOf('MARK_PROCESSED');
      const commitIdx = timeline.indexOf('COMMIT');
      const notifyIdx = timeline.indexOf('NOTIFY');

      expect(beginIdx).toBe(0);
      expect(beginIdx).toBeLessThan(claimEventIdx);
      expect(claimEventIdx).toBeLessThan(updateEscrowIdx);
      expect(updateEscrowIdx).toBeLessThan(updateResIdx);
      expect(updateResIdx).toBeLessThan(markProcessedIdx);
      expect(markProcessedIdx).toBeLessThan(commitIdx);

      // Asserts notifications are dispatched strictly AFTER commit, not inside the transaction
      expect(commitIdx).toBeLessThan(notifyIdx);

      // Asserts ROLLBACK was never called
      expect(timeline).not.toContain('ROLLBACK');

      // Asserts notification was called with correct payload
      expect(mockedNotify).toHaveBeenCalledWith({
        contractId: 'contract-success-1',
        eventType: 'escrow_funded',
        body: expect.stringContaining('confirmed on the Stellar network'),
      });
    });

    it('treats notification failure as non-fatal without rolling back state', async () => {
      mockClient.query.mockImplementation(async (sql: string) => {
        if (sql === 'BEGIN') return {};
        if (sql.includes('pg_advisory_xact_lock')) return {};
        if (sql.includes('FROM safetrust.trustless_work_webhook_events') && sql.includes('processed   = true')) {
          return { rows: [] };
        }
        if (sql.includes('INSERT INTO safetrust.trustless_work_webhook_events')) {
          return { rows: [{ id: 'event-uuid-notify-fail' }] };
        }
        if (sql.includes('FROM safetrust.trustless_work_escrows') && sql.includes('FOR UPDATE')) {
          return {
            rowCount: 1,
            rows: [{ id: 'escrow-uuid-notify-fail', status: 'created', balance: 0 }],
          };
        }
        if (sql.includes('UPDATE safetrust.trustless_work_escrows')) return { rowCount: 1 };
        if (sql.includes('UPDATE safetrust.reservations')) return { rowCount: 1 };
        if (sql.includes('UPDATE safetrust.trustless_work_webhook_events')) return { rowCount: 1 };
        if (sql === 'COMMIT') return {};
        return { rows: [] };
      });

      // Notification service encounters network timeout
      mockedNotify.mockRejectedValueOnce(new Error('Push notification service timeout'));

      const req = makeRequest({
        contractId: 'contract-notify-fail',
        signer: 'GUSER',
        amount: 150,
      });
      const res = makeResponse();

      await fundEscrowHandler(req, res);

      // Notification failure must not fail the handler response
      expect(res.status).toHaveBeenCalledWith(200);
      // COMMIT was executed successfully
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
      expect(mockClient.query).not.toHaveBeenCalledWith('ROLLBACK');
    });
  });

  describe('Conflict & Idempotency guards', () => {
    it('returns duplicate (200) without modifying state if event was already processed', async () => {
      mockClient.query.mockImplementation(async (sql: string) => {
        if (sql === 'BEGIN') return {};
        if (sql.includes('pg_advisory_xact_lock')) return {};
        if (sql.includes('FROM safetrust.trustless_work_webhook_events') && sql.includes('processed   = true')) {
          return { rows: [{ id: 'existing-processed-event-1' }] };
        }
        if (sql === 'COMMIT') return {};
        return { rows: [] };
      });

      const req = makeRequest({
        contractId: 'contract-dup',
        signer: 'GUSER',
        amount: 100,
      });
      const res = makeResponse();

      await fundEscrowHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ duplicate: true, eventId: 'existing-processed-event-1' })
      );
      expect(mockClient.query).not.toHaveBeenCalledWith(
        expect.stringContaining('UPDATE safetrust.trustless_work_escrows')
      );
      expect(mockedNotify).not.toHaveBeenCalled();
    });

    it('returns conflict (409) and rolls back if escrow is in an invalid prior state', async () => {
      mockClient.query.mockImplementation(async (sql: string) => {
        if (sql === 'BEGIN') return {};
        if (sql.includes('pg_advisory_xact_lock')) return {};
        if (sql.includes('FROM safetrust.trustless_work_webhook_events') && sql.includes('processed   = true')) {
          return { rows: [] };
        }
        if (sql.includes('INSERT INTO safetrust.trustless_work_webhook_events')) {
          return { rows: [{ id: 'event-uuid-conflict' }] };
        }
        if (sql.includes('FROM safetrust.trustless_work_escrows') && sql.includes('FOR UPDATE')) {
          // 'completed' is NOT a valid prior state for 'funded'
          return {
            rowCount: 1,
            rows: [{ id: 'escrow-uuid-conflict', status: 'completed', balance: 0 }],
          };
        }
        if (sql === 'ROLLBACK') return {};
        return { rows: [] };
      });

      const req = makeRequest({
        contractId: 'contract-conflict',
        signer: 'GUSER',
        amount: 100,
      });
      const res = makeResponse();

      await fundEscrowHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.query).not.toHaveBeenCalledWith('COMMIT');
      expect(mockedNotify).not.toHaveBeenCalled();
    });

    it('returns notFound (404) and rolls back if escrow does not exist', async () => {
      mockClient.query.mockImplementation(async (sql: string) => {
        if (sql === 'BEGIN') return {};
        if (sql.includes('pg_advisory_xact_lock')) return {};
        if (sql.includes('FROM safetrust.trustless_work_webhook_events') && sql.includes('processed   = true')) {
          return { rows: [] };
        }
        if (sql.includes('INSERT INTO safetrust.trustless_work_webhook_events')) {
          return { rows: [{ id: 'event-uuid-not-found' }] };
        }
        if (sql.includes('FROM safetrust.trustless_work_escrows') && sql.includes('FOR UPDATE')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql === 'ROLLBACK') return {};
        return { rows: [] };
      });

      const req = makeRequest({
        contractId: 'non-existent-contract',
        signer: 'GUSER',
        amount: 100,
      });
      const res = makeResponse();

      await fundEscrowHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.query).not.toHaveBeenCalledWith('COMMIT');
      expect(mockedNotify).not.toHaveBeenCalled();
    });
  });
  describe('Release-funds lifecycle atomic transaction', () => {
    it('commits all state changes atomically on release-funds success', async () => {
      mockClient.query.mockImplementation(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN') {
          timeline.push('BEGIN');
          return {};
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          timeline.push('LOCK');
          return {};
        }
        if (sql.includes('FROM safetrust.trustless_work_webhook_events') && sql.includes('processed   = true')) {
          return { rows: [] };
        }
        if (sql.includes('INSERT INTO safetrust.trustless_work_webhook_events')) {
          timeline.push('CLAIM_EVENT');
          return { rows: [{ id: 'event-uuid-release' }] };
        }
        if (sql.includes('FROM safetrust.trustless_work_escrows') && sql.includes('FOR UPDATE')) {
          return {
            rowCount: 1,
            rows: [{ id: 'escrow-uuid-release', status: 'milestone_approved', balance: 500 }],
          };
        }
        if (sql.includes('UPDATE safetrust.trustless_work_escrows')) {
          timeline.push('UPDATE_ESCROW_COMPLETED');
          return { rowCount: 1 };
        }
        if (sql.includes('UPDATE safetrust.reservations')) {
          timeline.push('UPDATE_RESERVATION_COMPLETED');
          return { rowCount: 1 };
        }
        if (sql.includes('UPDATE safetrust.trustless_work_webhook_events') && sql.includes('processed = true')) {
          timeline.push('MARK_PROCESSED');
          return { rowCount: 1 };
        }
        if (sql === 'COMMIT') {
          timeline.push('COMMIT');
          return {};
        }
        return { rows: [] };
      });

      const req = {
        body: {
          contractId: 'contract-release-1',
          releaseSigner: 'GRELEASER',
        },
      } as Request<{}, {}, ReleaseFundsPayload>;
      const res = makeResponse();

      await releaseFundsHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);

      const commitIdx = timeline.indexOf('COMMIT');
      const notifyIdx = timeline.indexOf('NOTIFY');
      expect(commitIdx).toBeGreaterThan(-1);
      expect(commitIdx).toBeLessThan(notifyIdx);

      expect(mockedNotify).toHaveBeenCalledWith({
        contractId: 'contract-release-1',
        eventType: 'escrow_completed',
        body: expect.stringContaining('Funds have been released'),
      });
    });

    it('rolls back completely when reservation mirror fails during release-funds', async () => {
      mockClient.query.mockImplementation(async (sql: string) => {
        if (sql === 'BEGIN') return {};
        if (sql.includes('pg_advisory_xact_lock')) return {};
        if (sql.includes('FROM safetrust.trustless_work_webhook_events') && sql.includes('processed   = true')) {
          return { rows: [] };
        }
        if (sql.includes('INSERT INTO safetrust.trustless_work_webhook_events')) {
          return { rows: [{ id: 'event-uuid-release-fail' }] };
        }
        if (sql.includes('FROM safetrust.trustless_work_escrows') && sql.includes('FOR UPDATE')) {
          return {
            rowCount: 1,
            rows: [{ id: 'escrow-uuid-release-fail', status: 'milestone_approved', balance: 500 }],
          };
        }
        if (sql.includes('UPDATE safetrust.trustless_work_escrows')) return { rowCount: 1 };
        if (sql.includes('UPDATE safetrust.reservations')) {
          throw new Error('Disk full on reservation mirror');
        }
        if (sql === 'ROLLBACK') {
          timeline.push('ROLLBACK');
          return {};
        }
        return { rows: [] };
      });

      const req = {
        body: {
          contractId: 'contract-release-fail',
          releaseSigner: 'GRELEASER',
        },
      } as Request<{}, {}, ReleaseFundsPayload>;
      const res = makeResponse();

      await releaseFundsHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(timeline).toContain('ROLLBACK');
      expect(timeline).not.toContain('COMMIT');
      expect(mockedNotify).not.toHaveBeenCalled();
    });
  });
});
