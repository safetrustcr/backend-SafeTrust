import { hasuraRequest } from '../services/hasura'

export type EscrowStatus =
  | 'created'
  | 'funded'
  | 'milestone_approved'
  | 'completed'
  | 'disputed'
  | 'resolved'
  | string

export interface TrustlessWorkEscrow {
  id: string
  contractId: string
  status: EscrowStatus
  balance?: number
  createdAt?: string
}

export interface CreateEscrowInput {
  contractId: string
  marker: string
  approver: string
  releaser: string
  resolver?: string | null
  escrowType: string
  status: string
  assetCode: string
  assetIssuer?: string | null
  amount: number
  balance: number
  bookingId?: string | null
  roomId?: string | null
  hotelId?: string | null
  guestId?: string | null
  tenantId: string
  escrowMetadata?: unknown
  bookingMetadata?: unknown
}

export async function getEscrowByContractId(
  contractId: string
): Promise<TrustlessWorkEscrow | null> {
  const query = `
    query GetEscrowByContractId($contractId: String!) {
      trustless_work_escrows(where: { contractId: { _eq: $contractId } }) {
        id
        contractId
        status
        balance
        createdAt
      }
    }
  `

  const data = await hasuraRequest<{
    trustless_work_escrows?: Array<{
      id: string
      contractId: string
      status: string
      balance?: number
      createdAt?: string
    }>
  }>(query, { contractId })

  const escrow = data?.trustless_work_escrows?.[0]
  if (!escrow) {
    return null
  }

  return {
    id: escrow.id,
    contractId: escrow.contractId,
    status: escrow.status,
    balance: escrow.balance,
    createdAt: escrow.createdAt,
  }
}

export async function updateEscrowStatus(
  contractId: string,
  status: EscrowStatus
): Promise<void> {
  const mutation = `
    mutation UpdateEscrowStatus($contractId: String!, $status: String!) {
      update_trustless_work_escrows(
        where: { contractId: { _eq: $contractId } }
        _set: { status: $status }
      ) {
        affected_rows
      }
    }
  `

  await hasuraRequest(mutation, { contractId, status })
}

export async function createEscrow(
  object: CreateEscrowInput
): Promise<TrustlessWorkEscrow | null> {
  const mutation = `
    mutation InitializeEscrow($object: trustless_work_escrows_insert_input!) {
      insert_trustless_work_escrows_one(object: $object) {
        id
        contractId
        status
        createdAt
      }
    }
  `

  const data = await hasuraRequest<{
    insert_trustless_work_escrows_one?: {
      id: string
      contractId: string
      status: string
      createdAt?: string
    }
  }>(mutation, { object })

  const inserted = data?.insert_trustless_work_escrows_one
  if (!inserted) {
    return null
  }

  return {
    id: inserted.id,
    contractId: inserted.contractId,
    status: inserted.status,
    createdAt: inserted.createdAt,
  }
}

export async function approveMilestone(
  escrowId: string,
  milestoneId: string,
  approver: string,
  approvedAt: string
): Promise<boolean> {
  const mutation = `
    mutation ApproveMilestone(
      $escrowId: uuid!
      $milestoneId: String!
      $approver: String!
      $approvedAt: timestamptz!
    ) {
      update_escrow_milestones(
        where: {
          escrowId: { _eq: $escrowId }
          milestoneId: { _eq: $milestoneId }
        }
        _set: {
          status: "approved"
          approvedBy: $approver
          approvedAt: $approvedAt
          updatedAt: $approvedAt
        }
      ) {
        affected_rows
      }
    }
  `

  const data = await hasuraRequest<{
    update_escrow_milestones?: { affected_rows: number }
  }>(mutation, { escrowId, milestoneId, approver, approvedAt })

  return Boolean(data?.update_escrow_milestones?.affected_rows)
}

export async function approveEscrowStatus(
  escrowId: string,
  approvedAt: string,
  validStates: string[]
): Promise<boolean> {
  const mutation = `
    mutation ApproveEscrow($escrowId: uuid!, $approvedAt: timestamptz!, $validStates: [String!]!) {
      update_trustless_work_escrows(
        where: {
          id: { _eq: $escrowId }
          status: { _in: $validStates }
        }
        _set: {
          status: "milestone_approved"
          updatedAt: $approvedAt
        }
      ) {
        affected_rows
      }
    }
  `

  const data = await hasuraRequest<{
    update_trustless_work_escrows?: { affected_rows: number }
  }>(mutation, { escrowId, approvedAt, validStates })

  return Boolean(data?.update_trustless_work_escrows?.affected_rows)
}

export async function fundEscrow(
  contractId: string,
  amount: number,
  validStates: string[]
): Promise<TrustlessWorkEscrow | null> {
  const mutation = `
    mutation FundEscrow($contractId: String!, $amount: numeric!, $validStates: [String!]!) {
      update_trustless_work_escrows(
        where: {
          contractId: { _eq: $contractId }
          status: { _in: $validStates }
        }
        _set: {
          status: "funded"
          balance: $amount
        }
      ) {
        returning {
          id
          contractId
          status
          balance
        }
      }
    }
  `

  const data = await hasuraRequest<{
    update_trustless_work_escrows?: {
      returning: Array<{ id: string; contractId: string; status: string; balance: number }>
    }
  }>(mutation, { contractId, amount, validStates })

  const updated = data?.update_trustless_work_escrows?.returning?.[0]
  if (!updated) {
    return null
  }

  return {
    id: updated.id,
    contractId: updated.contractId,
    status: updated.status,
    balance: updated.balance,
  }
}

export async function releaseFunds(
  contractId: string
): Promise<TrustlessWorkEscrow | null> {
  const mutation = `
    mutation ReleaseFunds($contractId: String!) {
      update_trustless_work_escrows(
        where: { contractId: { _eq: $contractId } }
        _set: {
          status: "completed"
          balance: 0
        }
      ) {
        returning { id contractId status balance }
      }
    }
  `

  const data = await hasuraRequest<{
    update_trustless_work_escrows?: {
      returning: Array<{ id: string; contractId: string; status: string; balance: number }>
    }
  }>(mutation, { contractId })

  const updated = data?.update_trustless_work_escrows?.returning?.[0]
  if (!updated) {
    return null
  }

  return {
    id: updated.id,
    contractId: updated.contractId,
    status: updated.status,
    balance: updated.balance,
  }
}

export async function disputeEscrow(
  contractId: string,
  validStates: string[]
): Promise<TrustlessWorkEscrow | null> {
  const mutation = `
    mutation DisputeEscrow($contractId: String!, $validStates: [String!]!) {
      update_trustless_work_escrows(
        where: {
          contractId: { _eq: $contractId }
          status: { _in: $validStates }
        }
        _set: {
          status: "disputed"
        }
      ) {
        returning { id contractId status }
      }
    }
  `

  const data = await hasuraRequest<{
    update_trustless_work_escrows?: {
      returning: Array<{ id: string; contractId: string; status: string }>
    }
  }>(mutation, { contractId, validStates })

  const updated = data?.update_trustless_work_escrows?.returning?.[0]
  if (!updated) {
    return null
  }

  return {
    id: updated.id,
    contractId: updated.contractId,
    status: updated.status,
  }
}

export async function resolveDispute(
  contractId: string,
  validStates: string[]
): Promise<TrustlessWorkEscrow | null> {
  const mutation = `
    mutation ResolveDispute($contractId: String!, $validStates: [String!]!) {
      update_trustless_work_escrows(
        where: {
          contractId: { _eq: $contractId }
          status: { _in: $validStates }
        }
        _set: {
          status: "resolved"
          balance: 0
        }
      ) {
        returning { id contractId status balance }
      }
    }
  `

  const data = await hasuraRequest<{
    update_trustless_work_escrows?: {
      returning: Array<{ id: string; contractId: string; status: string; balance: number }>
    }
  }>(mutation, { contractId, validStates })

  const updated = data?.update_trustless_work_escrows?.returning?.[0]
  if (!updated) {
    return null
  }

  return {
    id: updated.id,
    contractId: updated.contractId,
    status: updated.status,
    balance: updated.balance,
  }
}

export async function appendResolutionNote(
  contractId: string,
  note: Record<string, unknown>
): Promise<boolean> {
  const mutation = `
    mutation AppendResolutionNote($contractId: String!, $note: jsonb!) {
      update_trustless_work_escrows(
        where: { contractId: { _eq: $contractId } }
        _append: { escrowMetadata: $note }
      ) {
        affected_rows
      }
    }
  `

  const data = await hasuraRequest<{
    update_trustless_work_escrows?: { affected_rows: number }
  }>(mutation, { contractId, note })

  return Boolean(data?.update_trustless_work_escrows?.affected_rows)
}
