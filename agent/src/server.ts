import { randomBytes } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  DepositSubmissionError,
  SafeTrustApiClient,
  type BookingRecord,
} from './api';
import {
  DepositVerificationError,
  formatExactUsdc,
  verifyAndSignDeposit,
} from './deposit';
import {
  PendingPaymentSettlementError,
  SpendingLedger,
  SpendingLimitError,
  isExact7DecimalAmount,
  loadSpendingConfigFromEnv,
  usdcToAtomic,
  type AgentSpendingConfig,
  type FeeSettlementResolver,
} from './payments';

export interface PendingDepositConfirmation {
  confirmationId: string;
  bookingId: string;
  contractId: string;
  assetContract: string;
  amountUsdc: number;
  propertyName?: string;
  createdAt: string;
  expiresAt: string;
}

export interface CreateBookingAgentServerOptions {
  /** Stellar secret key (S...) from STELLAR_SECRET_KEY — never logged or returned */
  secretKey: string;
  /** SafeTrust API base URL (default: http://localhost:3001) */
  apiBaseUrl?: string;
  /** Optional spending config override (defaults to env vars + testnet) */
  spendingConfig?: AgentSpendingConfig;
  /** Optional custom fetch function (for testing) */
  baseFetch?: typeof globalThis.fetch;
  /** Optional pre-existing API client (for testing) */
  apiClient?: SafeTrustApiClient;
  /** Optional pre-existing SpendingLedger (for testing) */
  ledger?: SpendingLedger;
  /** Optional pre-existing session token */
  sessionToken?: string;
  /** Confirmation TTL in milliseconds for two-step prepare_deposit/confirm_deposit (default: 5 min) */
  confirmationTtlMs?: number;
  /**
   * Optional server-verifiable human approval hook for non-elicitation fallback confirmations.
   * When provided, both `confirm_deposit` and `fund_deposit(confirmation_id)` invoke this
   * callback to independently verify human consent before signing.
   */
  verifyHumanApproval?: (
    pending: PendingDepositConfirmation
  ) => Promise<boolean> | boolean;
  /**
   * Explicit opt-in acknowledging that the MCP host enforces human approval before
   * calling `confirm_deposit` or `fund_deposit` with a `confirmation_id`.
   * Defaults to `process.env.AGENT_ALLOW_HOST_FALLBACK_CONFIRMATION === 'true'` (false by default).
   */
  allowFallbackConfirmation?: boolean;
  /**
   * Optional custom settlement query callback for reconciling pending x402 fee reservations.
   */
  queryFeeSettlement?: FeeSettlementResolver;
}

export interface BookingAgentContext {
  server: McpServer;
  ledger: SpendingLedger;
  api: SafeTrustApiClient;
  pendingConfirmations: Map<string, PendingDepositConfirmation>;
}

function redactSecret(message: string, secretKey: string): string {
  if (!secretKey) return message;
  return message.split(secretKey).join('[REDACTED_SECRET_KEY]');
}

function formatToolResult(
  data: unknown,
  secretKey: string,
  isError = false
) {
  return {
    isError,
    content: [
      {
        type: 'text' as const,
        text: redactSecret(JSON.stringify(data, null, 2), secretKey),
      },
    ],
  };
}

function formatToolError(err: unknown, secretKey: string) {
  const rawMessage = err instanceof Error ? err.message : String(err);
  const safeMessage = redactSecret(rawMessage, secretKey);
  const code =
    err instanceof SpendingLimitError ||
    err instanceof DepositVerificationError ||
    err instanceof PendingPaymentSettlementError
      ? err.code
      : 'AGENT_ERROR';

  const payload: Record<string, unknown> = {
    error: safeMessage,
    code,
  };
  if (err instanceof PendingPaymentSettlementError) {
    payload.reservation_id = err.reservationId;
  }

  return formatToolResult(payload, secretKey, true);
}

/**
 * Create and configure the SafeTrust MCP booking agent server with all 7 core tools
 * (`search_properties`, `check_availability`, `hold_dates`, `release_hold`,
 * `create_booking`, `fund_deposit`, `spending_summary`) plus the two-step
 * fallback tools (`prepare_deposit`, `confirm_deposit`) for MCP clients that
 * do not support elicitation.
 */
export function createBookingAgentServer(
  options: CreateBookingAgentServerOptions
): BookingAgentContext {
  const secretKey = options.secretKey?.trim();
  if (!secretKey) {
    throw new Error(
      'STELLAR_SECRET_KEY environment variable is required to start the SafeTrust booking agent.'
    );
  }

  const spendingConfig = options.spendingConfig ?? loadSpendingConfigFromEnv();
  const ledger = options.ledger ?? new SpendingLedger(spendingConfig);
  const api =
    options.apiClient ??
    new SafeTrustApiClient({
      baseUrl: options.apiBaseUrl,
      ledger,
      secretKey,
      baseFetch: options.baseFetch,
      sessionToken: options.sessionToken,
      queryFeeSettlement: options.queryFeeSettlement,
    });

  const confirmationTtlMs = options.confirmationTtlMs ?? 5 * 60 * 1000;
  const pendingConfirmations = new Map<string, PendingDepositConfirmation>();
  const verifyHumanApproval = options.verifyHumanApproval;
  const allowFallbackConfirmation =
    options.allowFallbackConfirmation ??
    process.env.AGENT_ALLOW_HOST_FALLBACK_CONFIRMATION === 'true';

  type BookingFundingState =
    | { status: 'in_flight' }
    | { status: 'funded'; txHash: string }
    | {
        status: 'uncertain';
        txHash: string;
        contractId: string;
        amountUsdc: number;
        assetContract: string;
      };
  const bookingFundingState = new Map<string, BookingFundingState>();

  const toolOk = (data: unknown) => formatToolResult(data, secretKey, false);

  const server = new McpServer({
    name: 'safetrust-booking-agent',
    version: '0.1.0',
  });

  // Helper to avoid TS2589 deep Zod generic instantiation in McpServer.registerTool
  // while preserving full runtime Zod schema validation and strong handler arg types.
  const registerTool = <TArgs extends z.ZodRawShape>(
    name: string,
    config: {
      title?: string;
      description?: string;
      inputSchema: TArgs;
    },
    handler: (args: z.infer<z.ZodObject<TArgs>>) => Promise<ReturnType<typeof formatToolResult>>
  ) => {
    (
      server.registerTool as unknown as (
        n: string,
        c: unknown,
        cb: (a: unknown) => Promise<unknown>
      ) => void
    )(name, config, (a) => handler(a as z.infer<z.ZodObject<TArgs>>));
  };

  // ── 1. search_properties (FREE session) ─────────────────────────────────────
  registerTool(
    'search_properties',
    {
      title: 'Search SafeTrust Properties',
      description:
        'Search available SafeTrust properties by location, dates, guests, bedrooms, or price. Free with wallet session.',
      inputSchema: {
        location: z.string().optional().describe('City, region, or property name filter'),
        check_in: z.string().optional().describe('Check-in date (YYYY-MM-DD)'),
        check_out: z.string().optional().describe('Check-out date (YYYY-MM-DD)'),
        guests: z.number().int().positive().optional().describe('Number of guests'),
        min_bedrooms: z.number().int().positive().optional().describe('Minimum bedrooms'),
        min_price: z.number().positive().optional().describe('Minimum price in USDC'),
        max_price: z.number().positive().optional().describe('Maximum price in USDC'),
        pet_friendly: z.boolean().optional().describe('Filter by pet-friendly properties'),
        limit: z.number().int().positive().max(50).optional().describe('Max results to return'),
      },
    },
    async (args) => {
      try {
        const result = await api.searchProperties({
          location: args.location,
          checkIn: args.check_in,
          checkOut: args.check_out,
          guests: args.guests,
          minBedrooms: args.min_bedrooms,
          minPrice: args.min_price,
          maxPrice: args.max_price,
          petFriendly: args.pet_friendly,
          limit: args.limit,
        });
        return toolOk({
          fee_usdc: 0,
          billing: 'FREE (session)',
          total: result.total,
          properties: result.properties,
        });
      } catch (err) {
        return formatToolError(err, secretKey);
      }
    }
  );

  // ── 2. check_availability (FREE session) ────────────────────────────────────
  registerTool(
    'check_availability',
    {
      title: 'Check Property Availability & Quote',
      description:
        'Check availability and get total + USDC deposit quote for a property and date range. Free with wallet session.',
      inputSchema: {
        property_id: z.string().min(1).describe('Property ID'),
        check_in: z.string().min(1).describe('Check-in date (YYYY-MM-DD)'),
        check_out: z.string().min(1).describe('Check-out date (YYYY-MM-DD)'),
        guests: z.number().int().positive().optional().describe('Number of guests'),
      },
    },
    async (args) => {
      try {
        const quote = await api.checkAvailability({
          propertyId: args.property_id,
          checkIn: args.check_in,
          checkOut: args.check_out,
          guests: args.guests,
        });
        return toolOk({
          fee_usdc: 0,
          billing: 'FREE (session)',
          ...quote,
        });
      } catch (err) {
        return formatToolError(err, secretKey);
      }
    }
  );

  // ── 3. hold_dates (PAID x402) ───────────────────────────────────────────────
  registerTool(
    'hold_dates',
    {
      title: 'Hold Property Dates',
      description:
        'Place a temporary hold on dates for a property. Pays the x402 fee automatically if within AGENT_MAX_FEE_PER_CALL and AGENT_FEE_BUDGET.',
      inputSchema: {
        property_id: z.string().min(1).describe('Property ID'),
        check_in: z.string().min(1).describe('Check-in date (YYYY-MM-DD)'),
        check_out: z.string().min(1).describe('Check-out date (YYYY-MM-DD)'),
        guests: z.number().int().positive().optional().describe('Number of guests'),
      },
    },
    async (args) => {
      try {
        const hold = await api.holdDates({
          propertyId: args.property_id,
          checkIn: args.check_in,
          checkOut: args.check_out,
          guests: args.guests,
        });
        return toolOk({
          billing: `${hold.feePaidUsdc.toFixed(2)} USDC x402`,
          ...hold,
        });
      } catch (err) {
        return formatToolError(err, secretKey);
      }
    }
  );

  // ── 4. release_hold (FREE session) ──────────────────────────────────────────
  registerTool(
    'release_hold',
    {
      title: 'Release Property Date Hold',
      description: 'Release an active date hold before it expires. Free.',
      inputSchema: {
        hold_id: z.string().min(1).describe('Hold ID returned by hold_dates'),
      },
    },
    async (args) => {
      try {
        const result = await api.releaseHold({ holdId: args.hold_id });
        return toolOk({
          fee_usdc: 0,
          ...result,
        });
      } catch (err) {
        return formatToolError(err, secretKey);
      }
    }
  );

  // ── 5. create_booking (PAID x402) ───────────────────────────────────────────
  registerTool(
    'create_booking',
    {
      title: 'Create Booking & Deploy Escrow',
      description:
        'Create a SafeTrust booking and deploy its Trustless Work escrow contract. Pays x402 fee and enforces AGENT_MAX_DEPOSIT.',
      inputSchema: {
        property_id: z.string().min(1).describe('Property ID'),
        check_in: z.string().min(1).describe('Check-in date (YYYY-MM-DD)'),
        check_out: z.string().min(1).describe('Check-out date (YYYY-MM-DD)'),
        guests: z.number().int().positive().optional().describe('Number of guests'),
        hold_id: z.string().optional().describe('Optional hold_id from hold_dates'),
        deposit_usdc: z
          .number()
          .positive()
          .optional()
          .describe('Optional quoted deposit amount in USDC'),
      },
    },
    async (args) => {
      try {
        const booking = await api.createBooking({
          propertyId: args.property_id,
          checkIn: args.check_in,
          checkOut: args.check_out,
          guests: args.guests,
          holdId: args.hold_id,
          depositUsdc: args.deposit_usdc,
        });
        return toolOk({
          billing: `${booking.feePaidUsdc.toFixed(2)} USDC x402`,
          booking_id: booking.bookingId,
          property_id: booking.propertyId,
          property_name: booking.propertyName,
          contract_id: booking.contractId,
          deposit_usdc: booking.depositUsdc,
          total_usdc: booking.totalUsdc,
          asset_code: booking.assetCode,
          status: booking.status,
          next_step:
            'Call fund_deposit (or prepare_deposit + confirm_deposit) after human confirmation to sign and lock the USDC deposit.',
        });
      } catch (err) {
        return formatToolError(err, secretKey);
      }
    }
  );

  const assertBookingAssetMatchesConfig = (booking: BookingRecord): string => {
    const expectedAssetContract = ledger.getConfig().expectedAssetContract;
    if (booking.assetContract !== expectedAssetContract) {
      throw new DepositVerificationError(
        'ASSET_MISMATCH',
        `Refusing deposit for booking "${booking.bookingId}": booking asset contract "${booking.assetContract}" does not match configured USDC contract "${expectedAssetContract}".`
      );
    }
    return expectedAssetContract;
  };

  const assertFallbackApprovalAvailable = (): void => {
    if (!verifyHumanApproval && !allowFallbackConfirmation) {
      throw new DepositVerificationError(
        'HUMAN_CONFIRMATION_REQUIRED',
        'Fallback confirmation is unavailable: neither verifyHumanApproval nor AGENT_ALLOW_HOST_FALLBACK_CONFIRMATION=true is configured. Use an MCP client supporting form elicitation, configure verifyHumanApproval, or enable AGENT_ALLOW_HOST_FALLBACK_CONFIRMATION=true only with host-enforced human approval.'
      );
    }
  };

  // Helper to resolve a booking and issue a two-step confirmation ID
  const createConfirmationRequest = (
    booking: BookingRecord,
    amountUsdc: number
  ): PendingDepositConfirmation => {
    assertFallbackApprovalAvailable();
    assertBookingAssetMatchesConfig(booking);
    ledger.verifyDepositLimit(amountUsdc);
    const confirmationId = `conf_${randomBytes(6).toString('hex')}`;
    const now = Date.now();
    const record: PendingDepositConfirmation = {
      confirmationId,
      bookingId: booking.bookingId,
      contractId: booking.contractId,
      assetContract: booking.assetContract,
      amountUsdc,
      propertyName: booking.propertyName,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + confirmationTtlMs).toISOString(),
    };
    pendingConfirmations.set(confirmationId, record);
    return record;
  };

  // Enforce server-verifiable approval or explicit host-approval deployment opt-in
  // for both two-step fallback entrypoints (confirm_deposit and fund_deposit with confirmation_id).
  const verifyFallbackApproval = async (
    pending: PendingDepositConfirmation,
    humanConfirmed: boolean | undefined
  ): Promise<void> => {
    if (!humanConfirmed) {
      throw new DepositVerificationError(
        'HUMAN_CONFIRMATION_REQUIRED',
        'Nothing signed: human_confirmed must be true after the human says "yes".'
      );
    }

    if (verifyHumanApproval) {
      const approved = await verifyHumanApproval(pending);
      if (!approved) {
        throw new DepositVerificationError(
          'HUMAN_CONFIRMATION_REQUIRED',
          `Nothing signed: server-side human approval check rejected confirmation "${pending.confirmationId}".`
        );
      }
      return;
    }

    if (!allowFallbackConfirmation) {
      throw new DepositVerificationError(
        'HUMAN_CONFIRMATION_REQUIRED',
        'Nothing signed: fallback confirmation is disabled by default because a caller-supplied human_confirmed boolean cannot be independently verified by the server. Use an MCP client supporting form elicitation, configure verifyHumanApproval, or set AGENT_ALLOW_HOST_FALLBACK_CONFIRMATION=true only after enabling host-enforced human tool approval.'
      );
    }
  };

  interface ApprovedBookingTerms {
    contractId: string;
    assetContract: string;
    amountUsdc: number;
  }

  const hasSameBookingTerms = (
    booking: BookingRecord,
    approved: ApprovedBookingTerms
  ): boolean => {
    if (
      booking.contractId !== approved.contractId ||
      booking.assetContract !== approved.assetContract
    ) {
      return false;
    }
    if (
      !isExact7DecimalAmount(booking.depositUsdc) ||
      !isExact7DecimalAmount(approved.amountUsdc)
    ) {
      return false;
    }
    try {
      return usdcToAtomic(booking.depositUsdc) === usdcToAtomic(approved.amountUsdc);
    } catch {
      return false;
    }
  };

  // Helper to execute XDR verification, signing, and submission once humanConfirmed === true.
  // Re-reads the booking immediately before signing to ensure terms did not change during
  // confirmation, enforces single-flight per booking, rejects already-funded bookings,
  // reconciles uncertain submissions by transaction hash before retrying, and records locked
  // funds in SpendingLedger only after confirmed funding.
  const executeSignedDeposit = async (params: {
    bookingId: string;
    approvedTerms: ApprovedBookingTerms;
    unsignedXdrOverride?: string;
    humanConfirmed: boolean;
    confirmationExpiresAt?: string;
  }) => {
    const { bookingId, approvedTerms } = params;

    const assertCurrentBookingMatchesApproved = (): BookingRecord => {
      const latest = api.getBooking(bookingId);
      if (!latest || !hasSameBookingTerms(latest, approvedTerms)) {
        throw new DepositVerificationError(
          'HUMAN_CONFIRMATION_REQUIRED',
          `Booking "${bookingId}" terms changed after confirmation. Request a new confirmation for the current terms before signing.`
        );
      }
      return latest;
    };

    const initialBooking = assertCurrentBookingMatchesApproved();
    const expectedAssetContract = assertBookingAssetMatchesConfig(initialBooking);

    const currentState = bookingFundingState.get(bookingId);
    if (initialBooking.status === 'funded' || currentState?.status === 'funded') {
      throw new DepositVerificationError(
        'ALREADY_FUNDED',
        `Booking "${bookingId}" is already funded. Refusing duplicate deposit signing.`
      );
    }

    if (currentState?.status === 'in_flight') {
      throw new DepositVerificationError(
        'FUNDING_IN_PROGRESS',
        `Funding submission for booking "${bookingId}" is already in progress. Wait for it to complete.`
      );
    }

    // Reconcile any prior uncertain submission by transaction hash before allowing another attempt
    if (currentState?.status === 'uncertain') {
      // Claim in-flight during reconciliation to prevent concurrent reconciliations/retries
      bookingFundingState.set(bookingId, { status: 'in_flight' });
      const reconciled = await api.reconcileBookingFunding(
        bookingId,
        currentState.txHash
      );
      if (reconciled === 'funded') {
        ledger.recordDeposit({
          bookingId,
          contractId: currentState.contractId,
          amountUsdc: currentState.amountUsdc,
          assetContract: currentState.assetContract,
          txHash: currentState.txHash,
        });
        const latestFunded = api.getBooking(bookingId);
        if (latestFunded) {
          latestFunded.status = 'funded';
        }
        bookingFundingState.set(bookingId, {
          status: 'funded',
          txHash: currentState.txHash,
        });
        throw new DepositVerificationError(
          'ALREADY_FUNDED',
          `Booking "${bookingId}" was already funded by prior transaction ${currentState.txHash}. Refusing duplicate signing.`
        );
      }
      if (reconciled === 'unknown') {
        bookingFundingState.set(bookingId, currentState);
        throw new DepositVerificationError(
          'FUNDING_OUTCOME_UNCERTAIN',
          `Cannot retry deposit for booking "${bookingId}": prior transaction ${currentState.txHash} outcome is still uncertain and could not be reconciled.`
        );
      }
      // reconciled === 'not_funded' -> safe to proceed with a new attempt
    }

    // Claim booking synchronously before re-checking terms and signing
    bookingFundingState.set(bookingId, { status: 'in_flight' });

    let signed: ReturnType<typeof verifyAndSignDeposit>;
    try {
      // Recheck fallback confirmation expiry immediately before signing (after approval/reconciliation awaits)
      if (
        params.confirmationExpiresAt &&
        Date.now() > new Date(params.confirmationExpiresAt).getTime()
      ) {
        throw new DepositVerificationError(
          'HUMAN_CONFIRMATION_REQUIRED',
          `Confirmation for booking "${bookingId}" expired before signing. Request a new confirmation.`
        );
      }

      // Re-read booking immediately before signing (covers any change during confirmation or reconciliation awaits)
      const latestBooking = assertCurrentBookingMatchesApproved();
      const latestAssetContract = assertBookingAssetMatchesConfig(latestBooking);
      const unsignedXdr = params.unsignedXdrOverride ?? latestBooking.unsignedXdr;

      signed = verifyAndSignDeposit({
        bookingId,
        unsignedXdr,
        expectedContractId: latestBooking.contractId,
        expectedAmountUsdc: approvedTerms.amountUsdc,
        network: ledger.getConfig().network,
        expectedAssetContract: latestAssetContract,
        expectedSigner: api.getWalletPublicKey(),
        secretKey,
        ledger,
        humanConfirmed: params.humanConfirmed,
      });
    } catch (err) {
      // Verification/signing failed before submission; release claim so recovery is possible
      bookingFundingState.delete(bookingId);
      throw err;
    }

    try {
      const submitted = await api.submitSignedDeposit({
        bookingId: signed.bookingId,
        contractId: signed.contractId,
        signedXdr: signed.signedXdr,
        txHash: signed.txHash,
        amountUsdc: signed.amountUsdc,
      });

      // Record deposit in the spending ledger ONLY after confirmed funding
      ledger.recordDeposit({
        bookingId: signed.bookingId,
        contractId: signed.contractId,
        amountUsdc: signed.amountUsdc,
        assetContract: expectedAssetContract,
        txHash: signed.txHash,
      });

      bookingFundingState.set(bookingId, {
        status: 'funded',
        txHash: signed.txHash,
      });

      return {
        ...submitted,
        signer_public_key: signed.signerPublicKey,
        summary: ledger.getSummary().formatted,
      };
    } catch (err) {
      if (err instanceof DepositSubmissionError && err.definitive) {
        // Definitive rejection (e.g. 4xx): release claim so recovery remains possible
        bookingFundingState.delete(bookingId);
      } else {
        // Uncertain outcome (5xx, timeout, network error): record txHash for reconciliation
        bookingFundingState.set(bookingId, {
          status: 'uncertain',
          txHash: signed.txHash,
          contractId: signed.contractId,
          amountUsdc: signed.amountUsdc,
          assetContract: expectedAssetContract,
        });
      }
      throw err;
    }
  };

  // ── 6a. prepare_deposit (Two-step fallback step 1) ──────────────────────────
  registerTool(
    'prepare_deposit',
    {
      title: 'Prepare Escrow Deposit for Human Confirmation',
      description:
        'Prepare an escrow deposit for a booking and generate a confirmation_id that must be shown to the human for an explicit "yes" before calling confirm_deposit or fund_deposit.',
      inputSchema: {
        booking_id: z.string().min(1).describe('Booking ID from create_booking'),
      },
    },
    async (args) => {
      try {
        const booking = api.getBooking(args.booking_id);
        if (!booking) {
          throw new Error(
            `Unknown booking_id "${args.booking_id}". Call create_booking first.`
          );
        }
        const pending = createConfirmationRequest(booking, booking.depositUsdc);
        const exactAmount = formatExactUsdc(pending.amountUsdc);
        return toolOk({
          status: 'confirmation_required',
          confirmation_id: pending.confirmationId,
          booking_id: pending.bookingId,
          contract_id: pending.contractId,
          property_name: pending.propertyName,
          deposit_usdc: pending.amountUsdc,
          expires_at: pending.expiresAt,
          prompt_for_human: `Book ${pending.propertyName ?? pending.bookingId} and lock ${exactAmount} USDC in escrow (${pending.contractId})? Reply "yes" with confirmation_id ${pending.confirmationId}.`,
        });
      } catch (err) {
        return formatToolError(err, secretKey);
      }
    }
  );

  // ── 6b. confirm_deposit (Two-step fallback step 2) ──────────────────────────
  registerTool(
    'confirm_deposit',
    {
      title: 'Confirm & Sign Escrow Deposit',
      description:
        'Complete a prepared escrow deposit after the human has explicitly said "yes" to the confirmation_id.',
      inputSchema: {
        confirmation_id: z
          .string()
          .min(1)
          .describe('Confirmation ID returned by prepare_deposit or fund_deposit'),
        human_confirmed: z
          .boolean()
          .describe('Must be true only after the human explicitly replied "yes"'),
        unsigned_xdr: z
          .string()
          .optional()
          .describe('Optional unsigned XDR override if not stored on the booking'),
      },
    },
    async (args) => {
      try {
        const pending = pendingConfirmations.get(args.confirmation_id);
        if (!pending) {
          throw new DepositVerificationError(
            'HUMAN_CONFIRMATION_REQUIRED',
            `Invalid or expired confirmation_id "${args.confirmation_id}". Call prepare_deposit first.`
          );
        }
        if (Date.now() > new Date(pending.expiresAt).getTime()) {
          pendingConfirmations.delete(args.confirmation_id);
          throw new DepositVerificationError(
            'HUMAN_CONFIRMATION_REQUIRED',
            `Confirmation "${args.confirmation_id}" expired. Call prepare_deposit again.`
          );
        }

        const booking = api.getBooking(pending.bookingId);
        if (!booking) {
          throw new Error(`Booking "${pending.bookingId}" not found.`);
        }
        if (!hasSameBookingTerms(booking, pending)) {
          pendingConfirmations.delete(args.confirmation_id);
          throw new DepositVerificationError(
            'HUMAN_CONFIRMATION_REQUIRED',
            `Booking "${pending.bookingId}" terms changed since confirmation "${args.confirmation_id}" was issued. Call prepare_deposit again.`
          );
        }

        // Consume confirmation_id synchronously before awaiting approval/submission
        // so concurrent confirm_deposit calls with the same ID cannot both proceed.
        pendingConfirmations.delete(args.confirmation_id);

        try {
          await verifyFallbackApproval(pending, args.human_confirmed);
        } catch (err) {
          // Restore confirmation_id if caller passed human_confirmed: false before any signing
          if (!args.human_confirmed) {
            pendingConfirmations.set(args.confirmation_id, pending);
          }
          throw err;
        }

        const result = await executeSignedDeposit({
          bookingId: pending.bookingId,
          approvedTerms: {
            contractId: pending.contractId,
            assetContract: pending.assetContract,
            amountUsdc: pending.amountUsdc,
          },
          unsignedXdrOverride: args.unsigned_xdr,
          humanConfirmed: true,
          confirmationExpiresAt: pending.expiresAt,
        });

        return toolOk(result);
      } catch (err) {
        return formatToolError(err, secretKey);
      }
    }
  );

  // ── 6. fund_deposit (Elicitation-first, two-step fallback) ──────────────────
  registerTool(
    'fund_deposit',
    {
      title: 'Verify & Sign Escrow Deposit',
      description:
        'Verify the escrow XDR calls fund_escrow on the booking contract_id for the exact quoted USDC deposit, obtain human confirmation, sign with the Stellar wallet, and submit.',
      inputSchema: {
        booking_id: z.string().min(1).describe('Booking ID from create_booking'),
        unsigned_xdr: z
          .string()
          .optional()
          .describe('Optional unsigned XDR override if not stored on the booking'),
        confirmation_id: z
          .string()
          .optional()
          .describe('Confirmation ID for clients without MCP elicitation'),
        human_confirmed: z
          .boolean()
          .optional()
          .describe('Set to true only after the human explicitly confirmed the confirmation_id'),
      },
    },
    async (args) => {
      try {
        const booking = api.getBooking(args.booking_id);
        if (!booking) {
          throw new Error(
            `Unknown booking_id "${args.booking_id}". Call create_booking first.`
          );
        }

        // Enforce configured USDC contract & AGENT_MAX_DEPOSIT before asking human or decoding XDR
        assertBookingAssetMatchesConfig(booking);
        ledger.verifyDepositLimit(booking.depositUsdc);

        let humanConfirmed = false;
        let confirmationExpiresAt: string | undefined;
        let approvedTerms: ApprovedBookingTerms = {
          contractId: booking.contractId,
          assetContract: booking.assetContract,
          amountUsdc: booking.depositUsdc,
        };

        // Path A: Two-step confirmation_id provided
        if (args.confirmation_id) {
          const pending = pendingConfirmations.get(args.confirmation_id);
          if (
            !pending ||
            pending.bookingId !== booking.bookingId ||
            Date.now() > new Date(pending.expiresAt).getTime()
          ) {
            throw new DepositVerificationError(
              'HUMAN_CONFIRMATION_REQUIRED',
              `Invalid or expired confirmation_id "${args.confirmation_id}" for booking "${booking.bookingId}".`
            );
          }
          if (!hasSameBookingTerms(booking, pending)) {
            pendingConfirmations.delete(args.confirmation_id);
            throw new DepositVerificationError(
              'HUMAN_CONFIRMATION_REQUIRED',
              `Booking "${booking.bookingId}" terms changed since confirmation "${args.confirmation_id}" was issued. Call prepare_deposit again.`
            );
          }

          pendingConfirmations.delete(args.confirmation_id);
          try {
            await verifyFallbackApproval(pending, args.human_confirmed);
          } catch (err) {
            if (!args.human_confirmed) {
              pendingConfirmations.set(args.confirmation_id, pending);
            }
            throw err;
          }
          approvedTerms = {
            contractId: pending.contractId,
            assetContract: pending.assetContract,
            amountUsdc: pending.amountUsdc,
          };
          confirmationExpiresAt = pending.expiresAt;
          humanConfirmed = true;
        } else {
          // Path B: Use MCP form elicitation if the connected client supports it
          const elicitationCaps =
            server.server.getClientCapabilities()?.elicitation;
          const supportsFormElicitation =
            Boolean(elicitationCaps) &&
            (Boolean(elicitationCaps?.form) ||
              Object.keys(elicitationCaps as Record<string, unknown>).length ===
                0);

          if (supportsFormElicitation) {
            const exactAmount = formatExactUsdc(booking.depositUsdc);
            const elicitResult = await server.server.elicitInput({
              mode: 'form',
              message: redactSecret(
                `Book ${booking.propertyName ?? booking.propertyId} and lock ${exactAmount} USDC in escrow (${booking.contractId})?`,
                secretKey
              ),
              requestedSchema: {
                type: 'object',
                properties: {
                  confirm: {
                    type: 'boolean',
                    title: 'Confirm escrow deposit',
                    description: redactSecret(
                      `Sign and lock ${exactAmount} USDC into ${booking.contractId}`,
                      secretKey
                    ),
                    default: false,
                  },
                },
                required: ['confirm'],
              },
            });

            if (
              elicitResult.action !== 'accept' ||
              elicitResult.content?.confirm !== true
            ) {
              return toolOk({
                status: 'declined',
                message:
                  'Deposit cancelled by human confirmation prompt. Nothing was signed.',
              });
            }
            humanConfirmed = true;
          } else {
            // Path C: Client does not support elicitation -> return confirmation_id for two-step flow
            const pending = createConfirmationRequest(
              booking,
              booking.depositUsdc
            );
            const exactAmount = formatExactUsdc(pending.amountUsdc);
            return toolOk({
              status: 'confirmation_required',
              confirmation_id: pending.confirmationId,
              booking_id: pending.bookingId,
              contract_id: pending.contractId,
              property_name: pending.propertyName,
              deposit_usdc: pending.amountUsdc,
              expires_at: pending.expiresAt,
              message: `MCP client does not support elicitation. Ask the human: "Book ${pending.propertyName ?? pending.bookingId} and lock ${exactAmount} USDC in escrow?" and once they reply "yes", call confirm_deposit (or fund_deposit) with confirmation_id "${pending.confirmationId}" and human_confirmed: true.`,
            });
          }
        }

        const result = await executeSignedDeposit({
          bookingId: booking.bookingId,
          approvedTerms,
          unsignedXdrOverride: args.unsigned_xdr,
          humanConfirmed,
          confirmationExpiresAt,
        });

        return toolOk(result);
      } catch (err) {
        return formatToolError(err, secretKey);
      }
    }
  );

  // ── 7. spending_summary (FREE) ──────────────────────────────────────────────
  registerTool(
    'spending_summary',
    {
      title: 'Session Spending Summary',
      description:
        'Return the current session x402 fee spend, remaining fee budget, locked escrow deposits, and configured limits.',
      inputSchema: {},
    },
    async () => {
      try {
        return toolOk(ledger.getSummary());
      } catch (err) {
        return formatToolError(err, secretKey);
      }
    }
  );

  // ── 8. reconcile_fee_reservation (FREE session recovery) ───────────────────
  registerTool(
    'reconcile_fee_reservation',
    {
      title: 'Reconcile Pending x402 Fee Reservation',
      description:
        'Query settlement status for a pending x402 fee reservation after an ambiguous paid retry. Commits if settled, releases if definitively not settled, and keeps pending if still unknown.',
      inputSchema: {
        reservation_id: z
          .string()
          .min(1)
          .describe('Pending fee reservation_id returned on the error or spending_summary'),
      },
    },
    async (args) => {
      try {
        const reconciled = await api.reconcilePendingFee(args.reservation_id);
        return toolOk({
          reservation_id: reconciled.reservation.id,
          status: reconciled.status,
          paid_call: reconciled.paidCall,
          summary: ledger.getSummary().formatted,
        });
      } catch (err) {
        return formatToolError(err, secretKey);
      }
    }
  );

  return {
    server,
    ledger,
    api,
    pendingConfirmations,
  };
}
