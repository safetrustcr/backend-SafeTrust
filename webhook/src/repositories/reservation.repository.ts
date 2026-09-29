import { hasuraRequest } from '../services/hasura'

export async function linkEscrowToReservation(
  reservationId: string,
  escrowId: string
): Promise<void> {
  const mutation = `
    mutation LinkEscrowToReservation($reservationId: uuid!, $escrowId: uuid!) {
      update_reservations_by_pk(
        pk_columns: { id: $reservationId }
        _set: {
          escrow_id: $escrowId,
          status: "escrow_created",
          updatedAt: "now()"
        }
      ) {
        id status escrow_id
      }
    }
  `

  await hasuraRequest(mutation, {
    reservationId,
    escrowId,
  })
}

export async function mirrorReservationStatus(
  escrowId: string,
  status: string
): Promise<void> {
  const mutation = `
    mutation MirrorStatusToReservation($escrowId: uuid!, $status: String!) {
      update_reservations(
        where: { escrowId: { _eq: $escrowId } }
        _set: {
          status: $status
          updatedAt: "now()"
        }
      ) {
        returning { id status }
      }
    }
  `

  await hasuraRequest(mutation, { escrowId, status })
}
