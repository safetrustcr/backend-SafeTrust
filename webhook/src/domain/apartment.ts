export const REPORT_CATEGORIES = [
  'inaccurate',
  'scam_or_fraud',
  'offensive',
  'safety',
  'duplicate',
  'other',
] as const;

export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

export const ReportCategory = {
  Inaccurate: 'inaccurate',
  ScamOrFraud: 'scam_or_fraud',
  Offensive: 'offensive',
  Safety: 'safety',
  Duplicate: 'duplicate',
  Other: 'other',
} as const;

export function isReportCategory(value: unknown): value is ReportCategory {
  return typeof value === 'string' && (REPORT_CATEGORIES as readonly string[]).includes(value);
}

export interface Apartment {
  id: string;
  name: string;
  description?: string | null;
  price: number;
  warranty_deposit?: number | null;
  address?: unknown;
  is_available?: boolean;
  available_from?: string | null;
  available_until?: string | null;
  bedrooms?: number | null;
  pet_friendly?: boolean;
  category?: string | null;
  created_at?: string;
  owner_email?: string | null;
  owner_id?: string;
  coordinates?: unknown;
}

export interface ApartmentListQuery {
  location?: string;
  minPrice?: string;
  maxPrice?: string;
  bedrooms?: string;
  petFriendly?: string;
  category?: string;
  page?: string;
  limit?: string;
  sort?: string;
}

export interface ApartmentListResponse {
  apartments: Apartment[];
  total: number;
  page: number;
  totalPages: number;
}

export interface CreateListingReportPayload {
  category: ReportCategory;
  details?: string;
  clientOpId: string;
}

export interface ListingReportResponse {
  id: string;
  status: string;
}
