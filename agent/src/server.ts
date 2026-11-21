import { randomBytes } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { SafeTrustApiClient, type BookingRecord } from './api';
import {
  DepositVerificationError,
  verifyAndSignDeposit,
} from './deposit';
import {
  SpendingLedger,
  SpendingLimitError,
  loadSpendingConfigFromEnv,
  type AgentSpendingConfig,
} from './payments';

export interface PendingDepositConfirmation {
  confirmationId: string;
  bookingId: string;
  contractId: string;
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

function formatToolResult(data: unknown, isError = false) {
  return {
    isError,
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

function formatToolError(err: unknown, secretKey: string) {
  const rawMessage = err instanceof Error ? err.message : String(err);
  const safeMessage = redactSecret(rawMessage, secretKey);
  const code =
    err instanceof SpendingLimitError || err instanceof DepositVerificationError
      ? err.code
      : 'AGENT_ERROR';

  return formatToolResult(
    {
      error: safeMessage,
      code,
    },
    true
  );
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
    });

  const confirmationTtlMs = options.confirmationTtlMs ?? 5 * 60 * 1000;
  const pendingConfirmations = new Map<string, PendingDepositConfirmation>();

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
        return formatToolResult({
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
        return formatToolResult({
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
        return formatToolResult({
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
        return formatToolResult({
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
          holdId: args.hold_id,
          depositUsdc: args.deposit_usdc,
        });
        return formatToolResult({
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

  // Helper to resolve a booking and issue a two-step confirmation ID
  const createConfirmationRequest = (
    booking: BookingRecord,
    amountUsdc: number
  ): PendingDepositConfirmation => {
    ledger.verifyDepositLimit(amountUsdc);
    const confirmationId = `conf_${randomBytes(6).toString('hex')}`;
    const now = Date.now();
    const record: PendingDepositConfirmation = {
      confirmationId,
      bookingId: booking.bookingId,
      contractId: booking.contractId,
      amountUsdc,
      propertyName: booking.propertyName,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + confirmationTtlMs).toISOString(),
    };
    pendingConfirmations.set(confirmationId, record);
    return record;
  };

  // Helper to execute XDR verification, signing, and submission once humanConfirmed === true
  const executeSignedDeposit = async (params: {
    booking: BookingRecord;
    unsignedXdr: string;
    amountUsdc: number;
    humanConfirmed: boolean;
  }) => {
    const signed = verifyAndSignDeposit({
      bookingId: params.booking.bookingId,
      unsignedXdr: params.unsignedXdr,
      expectedContractId: params.booking.contractId,
      expectedAmountUsdc: params.amountUsdc,
      network: ledger.getConfig().network,
      expectedAssetContract: params.booking.assetContract,
      expectedSigner: api.getWalletPublicKey(),
      secretKey,
      ledger,
      humanConfirmed: params.humanConfirmed,
    });

    const submitted = await api.submitSignedDeposit({
      bookingId: signed.bookingId,
      contractId: signed.contractId,
      signedXdr: signed.signedXdr,
      txHash: signed.txHash,
      amountUsdc: signed.amountUsdc,
    });

    return {
      ...submitted,
      signer_public_key: signed.signerPublicKey,
      summary: ledger.getSummary().formatted,
    };
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
        return formatToolResult({
          status: 'confirmation_required',
          confirmation_id: pending.confirmationId,
          booking_id: pending.bookingId,
          contract_id: pending.contractId,
          property_name: pending.propertyName,
          deposit_usdc: pending.amountUsdc,
          expires_at: pending.expiresAt,
          prompt_for_human: `Book ${pending.propertyName ?? pending.bookingId} and lock ${pending.amountUsdc.toFixed(2)} USDC in escrow (${pending.contractId})? Reply "yes" with confirmation_id ${pending.confirmationId}.`,
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
        if (!args.human_confirmed) {
          throw new DepositVerificationError(
            'HUMAN_CONFIRMATION_REQUIRED',
            'Nothing signed: human_confirmed must be true after the human says "yes".'
          );
        }

        const booking = api.getBooking(pending.bookingId);
        if (!booking) {
          throw new Error(`Booking "${pending.bookingId}" not found.`);
        }

        const unsignedXdr = args.unsigned_xdr ?? booking.unsignedXdr;
        const result = await executeSignedDeposit({
          booking,
          unsignedXdr,
          amountUsdc: pending.amountUsdc,
          humanConfirmed: true,
        });

        pendingConfirmations.delete(args.confirmation_id);
        return formatToolResult(result);
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

        // Enforce AGENT_MAX_DEPOSIT before asking human or decoding XDR
        ledger.verifyDepositLimit(booking.depositUsdc);

        let humanConfirmed = false;

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
          if (!args.human_confirmed) {
            throw new DepositVerificationError(
              'HUMAN_CONFIRMATION_REQUIRED',
              'Nothing signed: human_confirmed must be true after the human says "yes".'
            );
          }
          pendingConfirmations.delete(args.confirmation_id);
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
            const elicitResult = await server.server.elicitInput({
              mode: 'form',
              message: `Book ${booking.propertyName ?? booking.propertyId} and lock ${booking.depositUsdc.toFixed(2)} USDC in escrow (${booking.contractId})?`,
              requestedSchema: {
                type: 'object',
                properties: {
                  confirm: {
                    type: 'boolean',
                    title: 'Confirm escrow deposit',
                    description: `Sign and lock ${booking.depositUsdc.toFixed(2)} USDC into ${booking.contractId}`,
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
              return formatToolResult(
                {
                  status: 'declined',
                  message:
                    'Deposit cancelled by human confirmation prompt. Nothing was signed.',
                },
                false
              );
            }
            humanConfirmed = true;
          } else {
            // Path C: Client does not support elicitation -> return confirmation_id for two-step flow
            const pending = createConfirmationRequest(
              booking,
              booking.depositUsdc
            );
            return formatToolResult({
              status: 'confirmation_required',
              confirmation_id: pending.confirmationId,
              booking_id: pending.bookingId,
              contract_id: pending.contractId,
              property_name: pending.propertyName,
              deposit_usdc: pending.amountUsdc,
              expires_at: pending.expiresAt,
              message: `MCP client does not support elicitation. Ask the human: "Book ${pending.propertyName ?? pending.bookingId} and lock ${pending.amountUsdc.toFixed(2)} USDC in escrow?" and once they reply "yes", call confirm_deposit (or fund_deposit) with confirmation_id "${pending.confirmationId}" and human_confirmed: true.`,
            });
          }
        }

        const unsignedXdr = args.unsigned_xdr ?? booking.unsignedXdr;
        const result = await executeSignedDeposit({
          booking,
          unsignedXdr,
          amountUsdc: booking.depositUsdc,
          humanConfirmed,
        });

        return formatToolResult(result);
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
        return formatToolResult(ledger.getSummary());
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
