import {
  ESCROW_STATUSES,
  isEscrowStatus,
  MILESTONE_STATUSES,
  isMilestoneStatus,
  ESCROW_EVENT_TYPES,
  isEscrowEventType,
  ESCROW_TYPES,
  isEscrowType,
} from '../escrow';
import { RESERVATION_STATUSES, isReservationStatus } from '../reservation';
import { USER_ROLES, isUserRole } from '../user';
import { CHAIN_TYPES, isChainType } from '../wallet';
import { REPORT_CATEGORIES, isReportCategory } from '../apartment';

describe('Domain Types & Type Guards', () => {
  describe('EscrowStatus', () => {
    it('accepts all canonical escrow statuses', () => {
      for (const status of ESCROW_STATUSES) {
        expect(isEscrowStatus(status)).toBe(true);
      }
    });

    it('rejects unknown or invalid statuses', () => {
      expect(isEscrowStatus('fundded')).toBe(false);
      expect(isEscrowStatus('unknown_status')).toBe(false);
      expect(isEscrowStatus('')).toBe(false);
      expect(isEscrowStatus(null)).toBe(false);
      expect(isEscrowStatus(undefined)).toBe(false);
      expect(isEscrowStatus(123)).toBe(false);
    });
  });

  describe('MilestoneStatus', () => {
    it('accepts all canonical milestone statuses', () => {
      for (const status of MILESTONE_STATUSES) {
        expect(isMilestoneStatus(status)).toBe(true);
      }
    });

    it('rejects invalid milestone statuses', () => {
      expect(isMilestoneStatus('check_in_invalid')).toBe(false);
      expect(isMilestoneStatus(null)).toBe(false);
    });
  });

  describe('EscrowEventType', () => {
    it('accepts all canonical escrow event types', () => {
      for (const event of ESCROW_EVENT_TYPES) {
        expect(isEscrowEventType(event)).toBe(true);
      }
    });

    it('rejects invalid event types', () => {
      expect(isEscrowEventType('escrow.unknown')).toBe(false);
      expect(isEscrowEventType(null)).toBe(false);
    });
  });

  describe('EscrowType', () => {
    it('accepts all canonical escrow types', () => {
      for (const type of ESCROW_TYPES) {
        expect(isEscrowType(type)).toBe(true);
      }
    });

    it('rejects invalid escrow types', () => {
      expect(isEscrowType('triple_release')).toBe(false);
      expect(isEscrowType(null)).toBe(false);
    });
  });

  describe('ReservationStatus', () => {
    it('accepts all canonical reservation statuses', () => {
      for (const status of RESERVATION_STATUSES) {
        expect(isReservationStatus(status)).toBe(true);
      }
    });

    it('rejects invalid reservation statuses', () => {
      expect(isReservationStatus('pending_approval')).toBe(false);
      expect(isReservationStatus(null)).toBe(false);
    });
  });

  describe('UserRole', () => {
    it('accepts all canonical user roles', () => {
      for (const role of USER_ROLES) {
        expect(isUserRole(role)).toBe(true);
      }
    });

    it('rejects invalid user roles', () => {
      expect(isUserRole('superadmin')).toBe(false);
      expect(isUserRole(null)).toBe(false);
    });
  });

  describe('ChainType', () => {
    it('accepts all canonical chain types', () => {
      for (const chain of CHAIN_TYPES) {
        expect(isChainType(chain)).toBe(true);
      }
    });

    it('rejects invalid chain types', () => {
      expect(isChainType('SOLANA')).toBe(false);
      expect(isChainType(null)).toBe(false);
    });
  });

  describe('ReportCategory', () => {
    it('accepts all canonical report categories', () => {
      for (const cat of REPORT_CATEGORIES) {
        expect(isReportCategory(cat)).toBe(true);
      }
    });

    it('rejects invalid report categories', () => {
      expect(isReportCategory('spam')).toBe(false);
      expect(isReportCategory(null)).toBe(false);
    });
  });

  describe('Boundary validation for Database and Trustless Work responses', () => {
    it('rejects an unknown escrow status from database response', () => {
      const dbRow = { contractId: 'c-1', status: 'bogus_status' };
      expect(isEscrowStatus(dbRow.status)).toBe(false);
    });

    it('rejects an unknown reservation status from database response', () => {
      const dbRow = { id: 'r-1', status: 'not_a_valid_reservation_status' };
      expect(isReservationStatus(dbRow.status)).toBe(false);
    });

    it('rejects an unknown escrow type from Trustless Work payload', () => {
      const twPayload = { contract_id: 'c-2', escrow_type: 'unknown_type' };
      expect(isEscrowType(twPayload.escrow_type)).toBe(false);
    });
  });
});
