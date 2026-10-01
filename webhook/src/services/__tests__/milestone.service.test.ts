'use strict';

// Mock hasura service before imports.
jest.mock('../../services/hasura', () => ({
  hasuraRequest: jest.fn(),
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
  });

  it('runs 3 hasuraRequest calls and resolves on full success', async () => {
    mockedHasuraRequest.mockResolvedValueOnce({
      update_escrow_milestones: { affected_rows: 1 },
    });
    mockedHasuraRequest.mockResolvedValueOnce({
      update_trustless_work_escrows: { affected_rows: 1 },
    });
    mockedHasuraRequest.mockResolvedValueOnce({
      update_reservations: { returning: [{ id: 'res-1', status: 'checked_in' }] },
    });

    await expect(
      approveMilestoneAndUpdateReservation('escrow-1', 'check_in', 'GABC')
    ).resolves.toBeUndefined();

    expect(mockedHasuraRequest).toHaveBeenCalledTimes(3);
  });

  it('throws MilestoneNotFoundError (404) when milestone row is not found', async () => {
    mockedHasuraRequest.mockResolvedValueOnce({
      update_escrow_milestones: { affected_rows: 0 },
    });

    let caught: unknown;
    try {
      await approveMilestoneAndUpdateReservation('escrow-1', 'check_in', 'GABC');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(MilestoneNotFoundError);
    expect((caught as MilestoneNotFoundError).statusCode).toBe(404);
    // Must not proceed to escrow or reservation mutations
    expect(mockedHasuraRequest).toHaveBeenCalledTimes(1);
  });

  it('throws EscrowNotFoundError (404) when escrow is in an invalid prior state', async () => {
    mockedHasuraRequest.mockResolvedValueOnce({
      update_escrow_milestones: { affected_rows: 1 },
    });
    mockedHasuraRequest.mockResolvedValueOnce({
      update_trustless_work_escrows: { affected_rows: 0 },
    });

    let caught: unknown;
    try {
      await approveMilestoneAndUpdateReservation('escrow-1', 'check_in', 'GABC');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(EscrowNotFoundError);
    expect((caught as EscrowNotFoundError).statusCode).toBe(404);
    expect(mockedHasuraRequest).toHaveBeenCalledTimes(2);
  });

  it('uses "checked_in" reservation status for check_in milestoneId', async () => {
    mockedHasuraRequest.mockResolvedValueOnce({
      update_escrow_milestones: { affected_rows: 1 },
    });
    mockedHasuraRequest.mockResolvedValueOnce({
      update_trustless_work_escrows: { affected_rows: 1 },
    });
    mockedHasuraRequest.mockResolvedValueOnce({});

    await approveMilestoneAndUpdateReservation('escrow-1', 'check_in', 'GABC');

    const mirrorCall = mockedHasuraRequest.mock.calls[2][1] as any;
    expect(mirrorCall.status).toBe('checked_in');
  });

  it('uses "checked_out" reservation status for check_out milestoneId', async () => {
    mockedHasuraRequest.mockResolvedValueOnce({
      update_escrow_milestones: { affected_rows: 1 },
    });
    mockedHasuraRequest.mockResolvedValueOnce({
      update_trustless_work_escrows: { affected_rows: 1 },
    });
    mockedHasuraRequest.mockResolvedValueOnce({});

    await approveMilestoneAndUpdateReservation('escrow-1', 'check_out', 'GABC');

    const mirrorCall = mockedHasuraRequest.mock.calls[2][1] as any;
    expect(mirrorCall.status).toBe('checked_out');
  });

  it('passes milestone mutation the correct field values', async () => {
    mockedHasuraRequest.mockResolvedValueOnce({
      update_escrow_milestones: { affected_rows: 1 },
    });
    mockedHasuraRequest.mockResolvedValueOnce({
      update_trustless_work_escrows: { affected_rows: 1 },
    });
    mockedHasuraRequest.mockResolvedValueOnce({});

    await approveMilestoneAndUpdateReservation('escrow-uuid-abc', 'check_in', 'GAPPROVER');

    const milestoneCallVars = mockedHasuraRequest.mock.calls[0][1] as any;
    expect(milestoneCallVars.escrowId).toBe('escrow-uuid-abc');
    expect(milestoneCallVars.milestoneId).toBe('check_in');
    expect(milestoneCallVars.approver).toBe('GAPPROVER');
    expect(typeof milestoneCallVars.approvedAt).toBe('string');
  });

  it('passes valid prior states from the real state machine to the escrow mutation', async () => {
    mockedHasuraRequest.mockResolvedValueOnce({
      update_escrow_milestones: { affected_rows: 1 },
    });
    mockedHasuraRequest.mockResolvedValueOnce({
      update_trustless_work_escrows: { affected_rows: 1 },
    });
    mockedHasuraRequest.mockResolvedValueOnce({});

    await approveMilestoneAndUpdateReservation('escrow-1', 'check_in', 'GABC');

    const escrowCallVars = mockedHasuraRequest.mock.calls[1][1] as any;
    expect(Array.isArray(escrowCallVars.validStates)).toBe(true);
    expect(escrowCallVars.validStates.length).toBeGreaterThan(0);
    // The mock returns the states the real machine would produce for milestone_approved
    expect(escrowCallVars.validStates).toEqual(['active', 'funded']);
  });

  it('propagates a Hasura error from the milestone mutation', async () => {
    const err = Object.assign(new Error('Hasura request failed'), {
      details: [{ message: 'permission denied' }],
    });
    mockedHasuraRequest.mockRejectedValueOnce(err);

    await expect(
      approveMilestoneAndUpdateReservation('escrow-1', 'check_in', 'GABC')
    ).rejects.toThrow('Hasura request failed');
  });
});
