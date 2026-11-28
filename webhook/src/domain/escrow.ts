export const ESCROW_STATUSES = [
  'created',
  'pending_funding',
  'funded',
  'active',
  'milestone_approved',
  'completed',
  'disputed',
  'resolved',
  'cancelled',
] as const;

export type EscrowStatus = (typeof ESCROW_STATUSES)[number];

export const EscrowStatus = {
  Created: 'created',
  PendingFunding: 'pending_funding',
  Funded: 'funded',
  Active: 'active',
  MilestoneApproved: 'milestone_approved',
  Completed: 'completed',
  Disputed: 'disputed',
  Resolved: 'resolved',
  Cancelled: 'cancelled',
} as const;

export function isEscrowStatus(value: unknown): value is EscrowStatus {
  return typeof value === 'string' && (ESCROW_STATUSES as readonly string[]).includes(value);
}

export const MILESTONE_STATUSES = ['check_in', 'check_out'] as const;

export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

export const MilestoneStatus = {
  CheckIn: 'check_in',
  CheckOut: 'check_out',
} as const;

export function isMilestoneStatus(value: unknown): value is MilestoneStatus {
  return typeof value === 'string' && (MILESTONE_STATUSES as readonly string[]).includes(value);
}

export const ESCROW_EVENT_TYPES = [
  'escrow.initialized',
  'escrow.funded',
  'milestone.approved',
  'funds.released',
  'dispute.raised',
  'dispute.resolved',
  'escrow.cancelled',
] as const;

export type EscrowEventType = (typeof ESCROW_EVENT_TYPES)[number];

export const EscrowEventType = {
  Initialized: 'escrow.initialized',
  Funded: 'escrow.funded',
  MilestoneApproved: 'milestone.approved',
  FundsReleased: 'funds.released',
  DisputeOpened: 'dispute.raised',
  DisputeResolved: 'dispute.resolved',
  Cancelled: 'escrow.cancelled',
} as const;

export function isEscrowEventType(value: unknown): value is EscrowEventType {
  return typeof value === 'string' && (ESCROW_EVENT_TYPES as readonly string[]).includes(value);
}

export const ESCROW_TYPES = ['single_release', 'multi_release'] as const;

export type EscrowType = (typeof ESCROW_TYPES)[number];

export const EscrowType = {
  SingleRelease: 'single_release',
  MultiRelease: 'multi_release',
} as const;

export function isEscrowType(value: unknown): value is EscrowType {
  return typeof value === 'string' && (ESCROW_TYPES as readonly string[]).includes(value);
}

export interface InitializeEscrowPayload {
  contract_id: string;
  marker: string;
  approver: string;
  releaser: string;
  resolver?: string | null;
  amount: number;
  escrow_type: EscrowType;
  asset_code?: string;
  asset_issuer?: string | null;
  reservation_id?: string | null;
  booking_metadata?: {
    reservation_id?: string;
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
}

export interface TrustlessWorkEscrow {
  id: string;
  contractId: string;
  marker: string;
  approver: string;
  releaser: string;
  resolver?: string | null;
  escrowType: EscrowType;
  status: EscrowStatus;
  assetCode: string;
  assetIssuer?: string | null;
  amount: number;
  balance: number;
  ledgerSeq?: bigint | number | string | null;
  network?: string | null;
  txHash?: string | null;
  escrowMetadata?: unknown;
  createdAt: string;
  updatedAt: string;
  tenantId: string;
}

export const ESCROW_TRANSACTION_KINDS = ['deploy', 'fund', 'approve', 'release'] as const;
export type EscrowTransactionKind = (typeof ESCROW_TRANSACTION_KINDS)[number];
export function isEscrowTransactionKind(value: unknown): value is EscrowTransactionKind {
  return typeof value === 'string' && (ESCROW_TRANSACTION_KINDS as readonly string[]).includes(value);
}

export const ESCROW_TRANSACTION_STATUSES = ['pending_signature', 'submitted', 'confirmed', 'failed'] as const;
export type EscrowTransactionStatus = (typeof ESCROW_TRANSACTION_STATUSES)[number];
export function isEscrowTransactionStatus(value: unknown): value is EscrowTransactionStatus {
  return typeof value === 'string' && (ESCROW_TRANSACTION_STATUSES as readonly string[]).includes(value);
}

export interface EscrowTransaction {
  id: string;
  escrowId: string;
  kind: EscrowTransactionKind;
  unsignedXdr?: string | null;
  txHash?: string | null;
  status: EscrowTransactionStatus;
  createdAt: string;
  updatedAt: string;
  tenantId: string;
}

export interface FundEscrowPayload {
  contractId: string;
  signer: string;
  amount: number;
}

export interface ApproveMilestonePayload {
  contractId: string;
  milestoneId: string;
  approver: string;
  flag: boolean;
}

export interface ReleaseFundsPayload {
  contractId: string;
  releaseSigner: string;
}

export interface DisputeEscrowPayload {
  contractId: string;
  disputeFlag: boolean;
  disputer: string;
}

export interface ResolveDisputePayload {
  contractId: string;
  resolver: string;
  resolutionNote?: string;
}
