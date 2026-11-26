import { z } from 'zod'
import { amountToStroops } from '../lib/stellar-amounts'

const nonEmptyString = z.string().trim().min(1)
const positiveNumber = z.union([z.number(), z.string()]).refine((value) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0
}, 'Must be a positive number')
const uuid = z.string().uuid()
const databaseUuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)

export const emptyBodySchema = z.object({}).passthrough().optional()

export const syncWalletSchema = z.object({
  wallet_address: nonEmptyString,
  chain_type: z.enum(['ETH', 'STELLAR', 'BSC']),
  is_primary: z.boolean().optional().default(false),
}).passthrough()
export type SyncWalletBody = z.infer<typeof syncWalletSchema>

export const createWalletChallengeSchema = z.object({
  wallet_address: nonEmptyString,
}).passthrough()
export type CreateWalletChallengeBody = z.infer<typeof createWalletChallengeSchema>

export const verifyWalletChallengeSchema = z.object({
  challengeId: uuid,
  signature: z.string().regex(/^[a-fA-F0-9]{128}$/),
  is_primary: z.boolean().optional().default(false),
}).passthrough()
export type VerifyWalletChallengeBody = z.infer<typeof verifyWalletChallengeSchema>

const apartmentListQuerySchema = z.object({
  location: z.string().optional(),
  minPrice: z.string().regex(/^\d+(\.\d+)?$/).optional(),
  maxPrice: z.string().regex(/^\d+(\.\d+)?$/).optional(),
  bedrooms: z.string().regex(/^\d+$/).optional(),
  petFriendly: z.preprocess(
    (value) => typeof value === 'string' ? value.toLowerCase() : value,
    z.enum(['true', 'false', '1', '0', 'yes', 'no'])
  ).optional(),
  category: z.string().optional(),
  checkIn: z.string().optional(),
  checkOut: z.string().optional(),
  page: z.string().regex(/^[1-9]\d*$/).optional(),
  limit: z.string().regex(/^[1-9]\d*$/).optional(),
  sort: z.enum(['price_asc', 'price_desc', 'created_at']).optional(),
})
.refine((query) => query.limit === undefined || Number(query.limit) <= 100, {
  path: ['limit'],
  message: 'Must be 100 or less',
})
export { apartmentListQuerySchema }
export type ApartmentListQuery = z.infer<typeof apartmentListQuerySchema>

export const createApartmentSchema = z.object({
  name: nonEmptyString,
  location: nonEmptyString,
  pricePerMonth: positiveNumber,
  promotionPercent: z.union([z.number(), z.string()]).nullable().optional()
    .refine((value) => value == null || (
      Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100
    ), 'Must be between 0 and 100'),
  rooms: z.union([z.number(), z.string()]).optional().default(1)
    .refine((value) => Number.isInteger(Number(value)) && Number(value) >= 1, 'Must be a positive integer'),
  bathrooms: z.union([z.number(), z.string()]).optional().default(1)
    .refine((value) => Number.isFinite(Number(value)) && Number(value) >= 1, 'Must be at least 1'),
  petFriendly: z.boolean().optional().default(false),
  description: z.string().optional().default(''),
}).passthrough()
export type CreateApartmentBody = z.infer<typeof createApartmentSchema>

export const createListingReportSchema = z.object({
  category: z.enum(['inaccurate', 'scam_or_fraud', 'offensive', 'safety', 'duplicate', 'other']),
  details: z.string().trim().max(1000).optional().nullable(),
  clientOpId: databaseUuid,
}).passthrough().superRefine((value, context) => {
  if (value.category === 'other' && (value.details ?? '').trim().length < 10) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['details'],
      message: 'Details must be at least 10 characters for the other category',
    })
  }
})
export type CreateListingReportBody = z.infer<typeof createListingReportSchema>

const calendarDate = z.string().refine((value) => {
  const parsed = new Date(value)
  if (!value.trim() || Number.isNaN(parsed.getTime())) return false
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return true
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  return month >= 1 && month <= 12 && day >= 1 &&
    day <= new Date(Date.UTC(year, month, 0)).getUTCDate()
}, 'Must be a valid calendar date')

export const createBidRequestSchema = z.object({
  apartmentId: databaseUuid.optional(),
  apartment_id: databaseUuid.optional(),
  proposedPrice: positiveNumber.optional(),
  proposed_price: positiveNumber.optional(),
  desiredMoveIn: calendarDate.optional(),
  desired_move_in: calendarDate.optional(),
}).passthrough().superRefine((value, context) => {
  if (!value.apartmentId && !value.apartment_id) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['apartmentId'], message: 'Required' })
  }
  if (value.proposedPrice === undefined && value.proposed_price === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['proposedPrice'], message: 'Required' })
  }
  if (!value.desiredMoveIn && !value.desired_move_in) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['desiredMoveIn'], message: 'Required' })
  }
})
export type CreateBidRequestBody = z.infer<typeof createBidRequestSchema>

export const updateBidRequestSchema = z.object({
  status: z.enum(['APPROVED', 'CANCELLED', 'CONFIRMED']),
}).passthrough()
export type UpdateBidRequestBody = z.infer<typeof updateBidRequestSchema>

export const createReservationSchema = z.object({
  apartment_id: nonEmptyString,
  check_in_date: z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'Must be a valid date'),
  check_out_date: z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'Must be a valid date'),
  total_amount: z.number().finite().positive(),
  asset_code: z.string().optional(),
  tenant_id: z.string().optional(),
}).passthrough().superRefine((value, context) => {
  if (Date.parse(value.check_out_date) <= Date.parse(value.check_in_date)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['check_out_date'],
      message: 'Must be after check_in_date',
    })
  }
})
export type CreateReservationBody = z.infer<typeof createReservationSchema>

export const reservationListQuerySchema = z.object({
  role: z.enum(['guest', 'host', 'both']).optional(),
  limit: z.string().regex(/^[1-9]\d*$/).optional(),
  offset: z.string().regex(/^\d+$/).optional(),
  page: z.string().regex(/^[1-9]\d*$/).optional(),
})
export type ReservationListQuery = z.infer<typeof reservationListQuerySchema>

export const cancelReservationSchema = z.object({
  reason: z.string().max(500).nullable().optional(),
}).passthrough().default({})
export type CancelReservationBody = z.infer<typeof cancelReservationSchema>

export const createEscrowClaimSchema = z.object({
  body: z.string().trim().min(10).max(2000),
  clientOpId: uuid,
}).passthrough()
export type CreateEscrowClaimBody = z.infer<typeof createEscrowClaimSchema>

const initializeEscrowBaseSchema = z.object({
  contract_id: nonEmptyString,
  marker: nonEmptyString,
  approver: nonEmptyString,
  releaser: nonEmptyString,
  resolver: z.string().nullable().optional(),
  amount: positiveNumber.refine((value) => amountToStroops(value) !== null, {
    message: 'Must be a positive finite numeric value',
  }),
  escrow_type: z.enum(['single_release', 'multi_release']),
  asset_code: z.string().optional(),
  asset_issuer: z.string().nullable().optional(),
  booking_id: z.string().nullable().optional(),
  room_id: z.string().nullable().optional(),
  hotel_id: z.string().nullable().optional(),
  guest_id: z.string().nullable().optional(),
  booking_metadata: z.object({ reservation_id: z.string().optional() }).passthrough().nullable().optional(),
}).passthrough()

export const escrowInitializationSchema = initializeEscrowBaseSchema
export type EscrowInitializationPayload = z.infer<typeof escrowInitializationSchema>

export const confirmTransactionSchema = z.object({
  submissionPath: z.enum(['helper', 'external']).optional(),
  txHash: z.string().optional(),
  signedXdr: z.string().optional(),
  escrowId: nonEmptyString,
  action: z.enum(['deploy', 'fund']),
  network: z.enum(['testnet', 'mainnet']).optional(),
  isTWGenerated: z.boolean().optional(),
  signingOnly: z.boolean().optional(),
}).passthrough().superRefine((value, context) => {
  const submissionPath = value.submissionPath ?? 'external'
  if (submissionPath === 'helper' && !value.signedXdr) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['signedXdr'], message: 'Required for helper submission' })
  }
  if (submissionPath === 'external' && !value.txHash) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['txHash'], message: 'Required for external submission' })
  }
  if (value.signingOnly) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['signingOnly'], message: 'Cannot advance escrow status by signing alone' })
  }
})
export type ConfirmTransactionBody = z.infer<typeof confirmTransactionSchema>

export const fundEscrowSchema = z.object({
  contractId: nonEmptyString,
  signer: nonEmptyString,
  amount: z.union([z.number(), z.string()])
    .refine((value) => Number.isFinite(Number(value)) && Number(value) > 0, 'Must be a positive number')
    .transform(Number),
}).passthrough()
export type FundEscrowBody = z.infer<typeof fundEscrowSchema>

export const approveMilestoneSchema = z.object({
  contractId: nonEmptyString,
  milestoneId: nonEmptyString,
  approver: nonEmptyString,
  flag: z.literal(true),
}).passthrough()
export type ApproveMilestoneBody = z.infer<typeof approveMilestoneSchema>

export const releaseFundsSchema = z.object({
  contractId: nonEmptyString,
  releaseSigner: nonEmptyString,
}).passthrough()
export type ReleaseFundsBody = z.infer<typeof releaseFundsSchema>

export const disputeEscrowSchema = z.object({
  contractId: nonEmptyString,
  disputeFlag: z.literal(true),
  disputer: nonEmptyString,
}).passthrough()
export type DisputeEscrowBody = z.infer<typeof disputeEscrowSchema>

export const resolveDisputeSchema = z.object({
  contractId: nonEmptyString,
  resolver: nonEmptyString,
  resolutionNote: z.string().optional(),
}).passthrough()
export type ResolveDisputeBody = z.infer<typeof resolveDisputeSchema>

export const reconciliationSyncSchema = z.object({}).passthrough().optional()
