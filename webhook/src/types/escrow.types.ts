/** Canonical database values for the SafeTrust escrow lifecycle. */
export enum EscrowStatus {
  Created = 'created',
  PendingFunding = 'pending_funding',
  Funded = 'funded',
  Active = 'active',
  MilestoneApproved = 'milestone_approved',
  Completed = 'completed',
  Disputed = 'disputed',
  Resolved = 'resolved',
  Cancelled = 'cancelled',
}

/** Milestone identifiers emitted by the escrow contract. */
export enum MilestoneStatus {
  CheckIn = 'check_in',
  CheckOut = 'check_out',
}

/** Canonical webhook event names used for idempotency. */
export enum EscrowEventType {
  Initialized = 'escrow.initialized',
  Funded = 'escrow.funded',
  MilestoneApproved = 'milestone.approved',
  FundsReleased = 'funds.released',
  DisputeOpened = 'dispute.raised',
  DisputeResolved = 'dispute.resolved',
}
