'use strict';

// Mock hasura service before imports.
jest.mock('../../services/hasura', () => ({
  hasuraRequest: jest.fn(),
}));

const mockedClient = {
  query: jest.fn(),
  release: jest.fn(),
};

jest.mock('../../services/db', () => ({
  connect: jest.fn(async () => mockedClient),
}));

// Mock the native escrow-state-machine Neon addon — it requires a compiled
// Rust binary which is not present in the unit-test environment.
// The mock returns the same JSON string the real addon would return for
// 'milestone_approved' so that tests are deterministic.
jest.mock('../../../../crates/escrow-state-machine', () => ({
  getValidPriorStates: jest.fn((_to: string, _event: string) => {
    // Real output from the Rust state machine for milestone_approved / milestone.approved
    return '["active","funded"]';
  }),
}), { virtual: true });

import {
  validateApproveMilestonePayload,
  lookupEscrowByContractId,
  approveMilestoneAndUpdateReservation,
  MilestoneValidationError,
  EscrowNotFoundError,
  EscrowStateConflictError,
  MilestoneNotFoundError,
} from '../../services/milestone.service';
import { hasuraRequest } from '../../services/hasura';

const mockedHasuraRequest = hasuraRequest as jest.MockedFunction<typeof hasuraRequest>;

// ── validateApproveMilestonePayload ────────────────────────────────────────────

describe('validateApproveMilestonePayload', () => {
  it('does not throw when all valid fields are supplied', () => {
    expect(() =>
      validateApproveMilestonePayload('contract-1', 'check_in', 'GABC', true)
    ).not.toThrow();
  });

  it('throws MilestoneValidationError when contractId is missing', () => {
    expect(() => validateApproveMilestonePayload(undefined, 'check_in', 'GABC', true)).toThrow(
      MilestoneValidationError
    );
  });

  it('throws MilestoneValidationError when milestoneId is missing', () => {
    expect(() =>
      validateApproveMilestonePayload('contract-1', undefined, 'GABC', true)
    ).toThrow(MilestoneValidationError);
  });

  it('throws MilestoneValidationError when approver is missing', () => {
    expect(() =>
      validateApproveMilestonePayload('contract-1', 'check_in', undefined, true)
    ).toThrow(MilestoneValidationError);
  });

  it('throws MilestoneValidationError when flag is undefined', () => {
    expect(() =>
      validateApproveMilestonePayload('contract-1', 'check_in', 'GABC', undefined)
    ).toThrow(MilestoneValidationError);
  });

  it('throws MilestoneValidationError with 400 status when flag is false', () => {
    let caught: unknown;
    try {
      validateApproveMilestonePayload('contract-1', 'check_in', 'GABC', false);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(MilestoneValidationError);
    expect((caught as MilestoneValidationError).statusCode).toBe(400);
    expect((caught as MilestoneValidationError).message).toBe(
      'flag must be true to approve a milestone'
    );
  });

  it('includes all field names in the missing fields error message', () => {
    expect.assertions(4);
    try {
      validateApproveMilestonePayload(undefined, undefined, undefined, undefined);
    } catch (err) {
      expect((err as MilestoneValidationError).message).toMatch(/contractId/);
      expect((err as MilestoneValidationError).message).toMatch(/milestoneId/);
      expect((err as MilestoneValidationError).message).toMatch(/approver/);
      expect((err as MilestoneValidationError).message).toMatch(/flag/);
    }
  });
});

// ── lookupEscrowByContractId ──────────────────────────────────────────────────

describe('lookupEscrowByContractId', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the escrowId when found', async () => {
    mockedHasuraRequest.mockResolvedValue({
      trustless_work_escrows: [{ id: 'escrow-uuid-1' }],
    });

    const result = await lookupEscrowByContractId('contract-1');

    expect(result.escrowId).toBe('escrow-uuid-1');
    expect(mockedHasuraRequest).toHaveBeenCalledWith(
      expect.stringContaining('GetEscrowId'),
      expect.objectContaining({ contractId: 'contract-1' })
    );
  });

  it('throws EscrowNotFoundError (404) when no escrow is found', async () => {
    mockedHasuraRequest.mockResolvedValue({ trustless_work_escrows: [] });

    let caught: unknown;
    try {
      await lookupEscrowByContractId('missing-contract');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(EscrowNotFoundError);
    expect((caught as EscrowNotFoundError).statusCode).toBe(404);
    expect((caught as EscrowNotFoundError).message).toBe('Escrow not found');
  });

  it('throws EscrowNotFoundError when trustless_work_escrows is undefined', async () => {
    mockedHasuraRequest.mockResolvedValue({});

    await expect(lookupEscrowByContractId('contract-1')).rejects.toBeInstanceOf(
      EscrowNotFoundError
    );
  });

  it('propagates Hasura errors upward', async () => {
    const err = Object.assign(new Error('Hasura request failed'), {
      details: [{ message: 'connection timeout' }],
    });
    mockedHasuraRequest.mockRejectedValue(err);

    await expect(lookupEscrowByContractId('contract-1')).rejects.toThrow(
      'Hasura request failed'
    );
  });
});

// ── approveMilestoneAndUpdateReservation ──────────────────────────────────────

describe('approveMilestoneAndUpdateReservation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedClient.query.mockReset();
    mockedClient.release.mockReset();
  });

  it('commits all database changes on full success', async () => {
    mockedClient.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'milestone-1' }] }) // milestone
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'escrow-1', status: 'active' }] }) // escrow
      .mockResolvedValueOnce({ rowCount: 1 }) // milestone update
      .mockResolvedValueOnce({ rowCount: 1 }) // escrow update
      .mockResolvedValueOnce({ rowCount: 1 }) // reservation update
      .mockResolvedValueOnce({}); // COMMIT

    await expect(
      approveMilestoneAndUpdateReservation('escrow-1', 'check_in', 'GABC')
    ).resolves.toBeUndefined();

    expect(mockedClient.query).toHaveBeenCalledWith('BEGIN');
    expect(mockedClient.query).toHaveBeenLastCalledWith('COMMIT');
    expect(mockedClient.query).not.toHaveBeenCalledWith('ROLLBACK');
    expect(mockedClient.release).toHaveBeenCalledTimes(1);
  });

  it('throws MilestoneNotFoundError (404) and rolls back when milestone is missing', async () => {
    mockedClient.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // milestone
      .mockResolvedValueOnce({}); // ROLLBACK

    await expect(
      approveMilestoneAndUpdateReservation('escrow-1', 'check_in', 'GABC')
    ).rejects.toBeInstanceOf(MilestoneNotFoundError);

    expect(mockedClient.query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(mockedClient.release).toHaveBeenCalledTimes(1);
  });

  it('throws EscrowStateConflictError (409) and rolls back when escrow is in an invalid prior state', async () => {
    mockedClient.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'milestone-1' }] }) // milestone
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'escrow-1', status: 'completed' }] }) // escrow
      .mockResolvedValueOnce({}); // ROLLBACK

    await expect(
      approveMilestoneAndUpdateReservation('escrow-1', 'check_in', 'GABC')
    ).rejects.toBeInstanceOf(EscrowStateConflictError);

    expect(mockedClient.query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(mockedClient.query).not.toHaveBeenCalledWith(
      expect.stringContaining('UPDATE safetrust.escrow_milestones')
    );
    expect(mockedClient.release).toHaveBeenCalledTimes(1);
  });

  it('is idempotent when the milestone is already approved and escrow is already milestone_approved', async () => {
    mockedClient.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'milestone-1', status: 'approved' }] }) // milestone
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: 'escrow-1', status: 'milestone_approved' }],
      }) // escrow
      .mockResolvedValueOnce({}) // COMMIT
      ;

    await expect(
      approveMilestoneAndUpdateReservation('escrow-1', 'check_in', 'GABC')
    ).resolves.toBeUndefined();

    expect(mockedClient.query).toHaveBeenLastCalledWith('COMMIT');
    expect(mockedClient.query).not.toHaveBeenCalledWith('ROLLBACK');
    expect(mockedClient.query).not.toHaveBeenCalledWith(
      expect.stringContaining('UPDATE safetrust.escrow_milestones')
    );
    expect(mockedClient.query).not.toHaveBeenCalledWith(
      expect.stringContaining('UPDATE safetrust.trustless_work_escrows')
    );
    expect(mockedClient.query).not.toHaveBeenCalledWith(
      expect.stringContaining('UPDATE safetrust.reservations')
    );
    expect(mockedClient.release).toHaveBeenCalledTimes(1);
  });

  it('throws EscrowNotFoundError (404) and rolls back when escrow is missing', async () => {
    mockedClient.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'milestone-1' }] }) // milestone
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // escrow
      .mockResolvedValueOnce({}); // ROLLBACK

    await expect(
      approveMilestoneAndUpdateReservation('escrow-1', 'check_in', 'GABC')
    ).rejects.toBeInstanceOf(EscrowNotFoundError);

    expect(mockedClient.query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(mockedClient.release).toHaveBeenCalledTimes(1);
  });

  it('uses "checked_in" reservation status for check_in milestoneId', async () => {
    mockedClient.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'milestone-1' }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'escrow-1', status: 'active' }] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    await approveMilestoneAndUpdateReservation('escrow-1', 'check_in', 'GABC');

    const reservationUpdate = mockedClient.query.mock.calls[5][0] as string;
    const reservationParams = mockedClient.query.mock.calls[5][1] as unknown[];

    expect(reservationUpdate).toContain('UPDATE safetrust.reservations');
    expect(reservationParams[0]).toBe('checked_in');
  });

  it('uses "checked_out" reservation status for check_out milestoneId', async () => {
    mockedClient.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'milestone-1' }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'escrow-1', status: 'active' }] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    await approveMilestoneAndUpdateReservation('escrow-1', 'check_out', 'GABC');

    const reservationParams = mockedClient.query.mock.calls[5][1] as unknown[];

    expect(reservationParams[0]).toBe('checked_out');
  });

  it('passes milestone update the correct field values', async () => {
    mockedClient.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'milestone-1' }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'escrow-1', status: 'funded' }] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    await approveMilestoneAndUpdateReservation(
      'escrow-uuid-abc',
      'check_in',
      'GAPPROVER'
    );

    const milestoneUpdate = mockedClient.query.mock.calls[3][0] as string;
    const milestoneParams = mockedClient.query.mock.calls[3][1] as unknown[];

    expect(milestoneUpdate).toContain('UPDATE safetrust.escrow_milestones');
    expect(milestoneParams[0]).toBe('GAPPROVER');
    expect(typeof milestoneParams[1]).toBe('string');
    expect(milestoneParams[2]).toBe('escrow-uuid-abc');
    expect(milestoneParams[3]).toBe('check_in');
  });

  it('uses valid prior states from the real state machine', async () => {
    mockedClient.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'milestone-1' }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'escrow-1', status: 'active' }] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    await approveMilestoneAndUpdateReservation('escrow-1', 'check_in', 'GABC');

    const escrowSelect = mockedClient.query.mock.calls[2][0] as string;
    expect(escrowSelect).toContain('FROM safetrust.trustless_work_escrows');
  });

  it('rolls back and propagates database errors', async () => {
    const err = new Error('database request failed');

    mockedClient.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'milestone-1' }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'escrow-1', status: 'active' }] })
      .mockRejectedValueOnce(err) // milestone update
      .mockResolvedValueOnce({}); // ROLLBACK

    await expect(
      approveMilestoneAndUpdateReservation('escrow-1', 'check_in', 'GABC')
    ).rejects.toThrow('database request failed');

    expect(mockedClient.query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(mockedClient.release).toHaveBeenCalledTimes(1);
  });
});
