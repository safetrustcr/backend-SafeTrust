declare module '@safetrust/types' {
  export type UserRole = 'admin' | 'host' | 'guest' | string

  export interface MeUser {
    id: string
    email: string
    roles: UserRole[]
  }

  export interface MeResponse {
    user: MeUser
    redirect: string
  }

  export type ChainType = 'ETH' | 'STELLAR' | 'BSC'

  export interface SyncWalletPayload {
    wallet_address: string
    chain_type: ChainType
    is_primary?: boolean
  }

  export interface SyncWalletResponse {
    success: boolean
    wallet_address: string
  }

  export interface Apartment {
    id: string
    name: string
    description?: string | null
    price: number
    warranty_deposit?: number | null
    address?: unknown
    is_available?: boolean
    available_from?: string | null
    available_until?: string | null
    bedrooms?: number | null
    pet_friendly?: boolean
    category?: string | null
    created_at?: string
    owner_email?: string | null
    owner_id?: string
    coordinates?: unknown
  }

  export interface ApartmentListQuery {
    location?: string
    minPrice?: string
    maxPrice?: string
    bedrooms?: string
    petFriendly?: string
    category?: string
    page?: string
    limit?: string
    sort?: string
  }

  export interface ApartmentListResponse {
    apartments: Apartment[]
    total: number
    page: number
    totalPages: number
  }

  export interface CreateReservationPayload {
    apartment_id: string
    check_in_date: string
    check_out_date: string
    total_amount: number
    asset_code?: string
  }

  export interface Reservation {
    id: string
    apartment_id: string
    guest_id: string
    status: string
    check_in_date: string
    check_out_date: string
    total_amount: number
    asset_code: string
    escrow_id?: string | null
    created_at?: string
    tenant_id?: string
  }
}
