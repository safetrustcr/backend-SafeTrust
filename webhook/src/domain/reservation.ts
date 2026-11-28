export const RESERVATION_STATUSES = [
  'pending',
  'escrow_created',
  'funded',
  'checked_in',
  'checked_out',
  'completed',
  'disputed',
  'resolved',
  'cancelled',
] as const;

export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export const ReservationStatus = {
  Pending: 'pending',
  EscrowCreated: 'escrow_created',
  Funded: 'funded',
  CheckedIn: 'checked_in',
  CheckedOut: 'checked_out',
  Completed: 'completed',
  Disputed: 'disputed',
  Resolved: 'resolved',
  Cancelled: 'cancelled',
} as const;

export function isReservationStatus(value: unknown): value is ReservationStatus {
  return typeof value === 'string' && (RESERVATION_STATUSES as readonly string[]).includes(value);
}

export interface CreateReservationPayload {
  apartment_id: string;
  check_in_date: string;
  check_out_date: string;
  total_amount: number;
  asset_code?: string;
}

export interface Reservation {
  id: string;
  apartment_id: string;
  guest_id: string;
  status: ReservationStatus;
  check_in_date: string;
  check_out_date: string;
  total_amount: number;
  asset_code: string;
  escrow_id?: string | null;
  created_at?: string;
  tenant_id?: string;
}
