export type ReservationStatus =
  | 'pending'
  | 'escrow_created'
  | 'funded'
  | 'checked_in'
  | 'checked_out'
  | 'completed'
  | 'disputed'
  | 'resolved'
  | 'cancelled'

export type ReservationAction = 'view' | 'view_contract' | 'cancel'

export type Party = 'guest' | 'host' | 'admin'

export interface ReservationDto {
  id: string
  status: ReservationStatus
  checkIn: string
  checkOut: string
  amount: string
  asset: string // decimal as string; never a float
  apartment: {
    id: string
    name: string
  }
  contractId: string | null
  party: 'guest' | 'host'
  allowedActions: ReservationAction[]
}

export function allowedActions(
  status: ReservationStatus,
  party: Party,
  hasContract: boolean
): ReservationAction[] {
  const actions: ReservationAction[] = ['view']
  if (hasContract) actions.push('view_contract')
  if (status === 'pending' || status === 'escrow_created') actions.push('cancel') // guest, host or admin
  return actions
}

export interface ReservationRowInput {
  id: string
  status: string
  check_in_date: Date | string
  check_out_date: Date | string
  total_amount: string | number
  asset_code?: string | null
  guest_id: string
  apartment_id: string
  apartment_name: string
  owner_id: string
  contract_id?: string | null
  cancelled_by?: string | null
  cancelled_at?: Date | string | null
  cancel_reason?: string | null
}

export function toReservationDto(
  row: ReservationRowInput,
  callerId: string
): ReservationDto {
  const party: 'guest' | 'host' = row.guest_id === callerId ? 'guest' : 'host'
  const hasContract = Boolean(row.contract_id)
  const actions = allowedActions(row.status as ReservationStatus, party, hasContract)

  const formatDate = (val: Date | string): string => {
    if (val instanceof Date) return val.toISOString()
    const d = new Date(val)
    return isNaN(d.getTime()) ? String(val) : d.toISOString()
  }

  return {
    id: String(row.id),
    status: row.status as ReservationStatus,
    checkIn: formatDate(row.check_in_date),
    checkOut: formatDate(row.check_out_date),
    amount: String(row.total_amount),
    asset: row.asset_code || 'USDC',
    apartment: {
      id: String(row.apartment_id),
      name: String(row.apartment_name),
    },
    contractId: row.contract_id ? String(row.contract_id) : null,
    party,
    allowedActions: actions,
  }
}
