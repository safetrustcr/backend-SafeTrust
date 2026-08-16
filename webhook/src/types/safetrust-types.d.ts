declare module '@safetrust/types' {
  export interface ApartmentListQuery {
    location?: string
    minPrice?: string
    maxPrice?: string
    bedrooms?: string
    petFriendly?: string
    category?: string
    page?: string
    limit?: string
    sort?: 'price_asc' | 'price_desc' | 'created_at' | string
  }

  export interface Apartment {
    id: string
    name: string
    description?: string
    price: number
    warranty_deposit?: number
    address?: Record<string, unknown> | string
    is_available?: boolean
    available_from?: string
    available_until?: string
    bedrooms?: number
    pet_friendly?: boolean
    category?: string
    created_at?: string
    owner_email?: string
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
    created_at: string
  }
}
