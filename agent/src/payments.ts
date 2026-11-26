import { randomBytes } from 'node:crypto';
import {
  wrapFetchWithPayment,
  x402Client,
  x402HTTPClient,
  type PaymentRequirements,
  type SchemeNetworkClient,
} from '@x402/fetch';
import {
  ExactStellarScheme,
  STELLAR_PUBNET_CAIP2,
  STELLAR_TESTNET_CAIP2,
  USDC_PUBNET_ADDRESS,
  USDC_TESTNET_ADDRESS,
  convertToTokenAmount,
  createEd25519Signer,
  type ClientStellarSigner,
  type RpcConfig,
} from '@x402/stellar';

export type StellarNetworkName = 'testnet' | 'mainnet';

export interface AgentSpendingConfig {
  /** Maximum fee per call in USDC (default: 0.10) */
  maxFeePerCallUsdc: number;
  /** Maximum cumulative fee budget for the session in USDC (default: 0.50) */
  feeBudgetUsdc: number;
  /** Maximum escrow deposit in USDC (default: 50.00) */
  maxDepositUsdc: number;
  /** Maximum Stellar transaction fee in XLM for signed deposits (default: 1.0) */
  maxTxFeeXlm?: number;
  /** Stellar network name: 'testnet' (default) or 'mainnet' */
  network: StellarNetworkName;
  /** Expected SafeTrust platform wallet (payTo) address */
  expectedPayTo: string;
  /** Expected USDC SEP-41 contract address for the configured network */
  expectedAssetContract?: string;
}

export interface Raw402Requirement {
  scheme?: string;
  network?: string;
  amount?: string | number;
  max_amount_usdc?: number | string;
  maxAmountRequired?: string | number;
  asset?:
    | string
    | {
        code?: string;
        contract?: string;
        issuer?: string;
      };
  payTo?: string;
  pay_to?: string;
  facilitator_url?: string;
  facilitatorUrl?: string;
  maxTimeoutSeconds?: number;
  description?: string;
  extra?: Record<string, unknown>;
}

export interface NormalizedPaymentRequirement {
  scheme: string;
  network: string;
  amountUsdc: number;
  amountAtomic: string;
  assetCode: string;
  assetContract: string;
  payTo: string;
  facilitatorUrl?: string;
  description?: string;
}

export interface PaidCallRecord {
  id: string;
  endpoint: string;
  amountUsdc: number;
  amountAtomic: string;
  assetContract: string;
  network: string;
  payTo: string;
  timestamp: string;
}

export interface FeeReservation {
  id: string;
  endpoint: string;
  requirement: NormalizedPaymentRequirement;
  status: 'reserved' | 'settled' | 'released';
  settlementRef?: string;
  createdAt: string;
}

export type FeeSettlementStatus = 'settled' | 'not_settled' | 'unknown';

export type FeeSettlementResolver = (
  reservation: Readonly<FeeReservation>
) => Promise<FeeSettlementStatus> | FeeSettlementStatus;

export interface ReconcileFeeReservationResult {
  status: 'settled' | 'released' | 'pending';
  reservation: FeeReservation;
  paidCall?: PaidCallRecord;
}

export class PendingPaymentSettlementError extends Error {
  public readonly code = 'PAYMENT_SETTLEMENT_PENDING' as const;
  public readonly reservationId: string;
  public readonly endpoint: string;
  public readonly amountUsdc: number;
  public readonly settlementRef?: string;
  public readonly cause?: unknown;

  constructor(params: {
    reservation: FeeReservation;
    cause?: unknown;
    message?: string;
  }) {
    const causeMsg =
      params.cause instanceof Error
        ? params.cause.message
        : params.cause !== undefined
          ? String(params.cause)
          : 'unknown transport failure';
    super(
      params.message ??
        `Paid x402 retry failed with ambiguous settlement (${causeMsg}). Fee reservation "${params.reservation.id}" (${params.reservation.requirement.amountUsdc.toFixed(2)} USDC) remains pending until reconciled.`
    );
    this.name = 'PendingPaymentSettlementError';
    this.reservationId = params.reservation.id;
    this.endpoint = params.reservation.endpoint;
    this.amountUsdc = params.reservation.requirement.amountUsdc;
    this.settlementRef = params.reservation.settlementRef;
    this.cause = params.cause;
  }
}

export interface DepositRecord {
  bookingId: string;
  contractId: string;
  amountUsdc: number;
  amountAtomic: string;
  assetContract: string;
  network: string;
  txHash?: string;
  timestamp: string;
}

export interface SpendingSummary {
  feesSpentUsdc: number;
  feesReservedUsdc: number;
  feeBudgetUsdc: number;
  remainingFeeBudgetUsdc: number;
  maxFeePerCallUsdc: number;
  depositsLockedUsdc: number;
  maxDepositUsdc: number;
  network: StellarNetworkName;
  caip2Network: string;
  expectedPayTo: string;
  expectedAssetContract: string;
  paidCalls: PaidCallRecord[];
  pendingFeeReservations: FeeReservation[];
  deposits: DepositRecord[];
  formatted: string;
}

export class SpendingLimitError extends Error {
  public readonly code:
    | 'FEE_PER_CALL_EXCEEDED'
    | 'FEE_BUDGET_EXCEEDED'
    | 'DEPOSIT_LIMIT_EXCEEDED'
    | 'UNTRUSTED_PAY_TO'
    | 'NETWORK_MISMATCH'
    | 'ASSET_MISMATCH'
    | 'INVALID_REQUIREMENT'
    | 'HUMAN_CONFIRMATION_REQUIRED';

  constructor(
    code: SpendingLimitError['code'],
    message: string
  ) {
    super(message);
    this.name = 'SpendingLimitError';
    this.code = code;
  }
}

const USDC_DECIMALS = 7;
const STROOPS_PER_USDC = 10_000_000;

/**
 * Resolve the CAIP-2 network identifier used by @x402/stellar and SafeTrust.
 */
export function toCaip2Network(network: StellarNetworkName): string {
  return network === 'mainnet' ? STELLAR_PUBNET_CAIP2 : STELLAR_TESTNET_CAIP2;
}

/**
 * Check if a network string matches the configured Stellar network.
 * Accepts both "stellar:mainnet" and "stellar:pubnet" for mainnet,
 * and "stellar:testnet" for testnet.
 */
export function isMatchingStellarNetwork(
  candidate: string,
  expected: StellarNetworkName
): boolean {
  const normalized = candidate.trim().toLowerCase();
  if (expected === 'testnet') {
    return normalized === 'stellar:testnet' || normalized === 'testnet';
  }
  return (
    normalized === 'stellar:mainnet' ||
    normalized === 'stellar:pubnet' ||
    normalized === 'mainnet' ||
    normalized === 'pubnet'
  );
}

/**
 * Default USDC contract address for the given Stellar network.
 */
export function getDefaultUsdcContract(network: StellarNetworkName): string {
  return network === 'mainnet' ? USDC_PUBNET_ADDRESS : USDC_TESTNET_ADDRESS;
}

/**
 * Expand a positive finite JS number into an exact base-10 digit string without
 * scientific notation (e.g. 1e-7 -> "0.0000001", 0.00099996 -> "0.00099996").
 */
function numberToExactDecimalString(value: number): string {
  const raw = String(value).trim().toLowerCase();
  if (!raw.includes('e')) {
    return raw;
  }
  const [mantissa, expPart] = raw.split('e');
  const exp = Number.parseInt(expPart, 10);
  const [intDigits, fracDigits = ''] = mantissa.split('.');
  const digits = intDigits + fracDigits;
  const decimalPos = intDigits.length + exp;

  if (decimalPos <= 0) {
    return `0.${'0'.repeat(-decimalPos)}${digits}`;
  }
  if (decimalPos >= digits.length) {
    return `${digits}${'0'.repeat(decimalPos - digits.length)}`;
  }
  return `${digits.slice(0, decimalPos)}.${digits.slice(decimalPos)}`;
}

/**
 * Convert a configured decimal cap (USDC or XLM) to the largest whole 7-decimal
 * atomic unit (stroop) that does NOT exceed the configured value (rounds down).
 */
export function decimalCapToMaxAtomic(amount: number): bigint {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new SpendingLimitError(
      'INVALID_REQUIREMENT',
      `Cap amount must be a positive finite number, got: ${amount}`
    );
  }
  const decStr = numberToExactDecimalString(amount);
  const [intPart, fracPart = ''] = decStr.split('.');
  const truncatedFrac = fracPart.slice(0, USDC_DECIMALS).padEnd(USDC_DECIMALS, '0');
  return BigInt(`${intPart || '0'}${truncatedFrac}`);
}

/**
 * Return true if `amount` has no non-zero fractional digits beyond 7 decimal places.
 */
export function isExact7DecimalAmount(amount: number): boolean {
  if (!Number.isFinite(amount) || amount <= 0) {
    return false;
  }
  const decStr = numberToExactDecimalString(amount);
  const [, fracPart = ''] = decStr.split('.');
  if (fracPart.length <= USDC_DECIMALS) {
    return true;
  }
  return /^0*$/.test(fracPart.slice(USDC_DECIMALS));
}

/**
 * Convert a decimal USDC number (e.g. 0.10) to 7-decimal atomic units ("1000000").
 */
export function usdcToAtomic(amountUsdc: number): string {
  if (!Number.isFinite(amountUsdc) || amountUsdc <= 0) {
    throw new SpendingLimitError(
      'INVALID_REQUIREMENT',
      `Payment amount must be a positive finite number, got: ${amountUsdc}`
    );
  }
  const fixed = amountUsdc.toFixed(USDC_DECIMALS);
  return convertToTokenAmount(fixed, USDC_DECIMALS);
}

/**
 * Convert an atomic 7-decimal string (e.g. "1000000") to a decimal USDC number (0.10).
 */
export function atomicToUsdc(atomic: string): number {
  if (!/^\d+$/.test(atomic)) {
    throw new SpendingLimitError(
      'INVALID_REQUIREMENT',
      `Atomic amount must be a positive integer string, got: ${atomic}`
    );
  }
  const value = Number(BigInt(atomic)) / STROOPS_PER_USDC;
  if (!Number.isFinite(value) || value <= 0) {
    throw new SpendingLimitError(
      'INVALID_REQUIREMENT',
      `Atomic amount must be greater than zero, got: ${atomic}`
    );
  }
  return Number(value.toFixed(USDC_DECIMALS));
}

/**
 * Round a USDC amount to 7 decimal places to avoid IEEE-754 drift.
 */
function roundUsdc(amount: number): number {
  return Number(amount.toFixed(USDC_DECIMALS));
}

/**
 * Parse spending configuration from environment variables with testnet defaults.
 */
export function loadSpendingConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): AgentSpendingConfig {
  const rawNetwork = (env.STELLAR_NETWORK ?? 'testnet').trim().toLowerCase();
  if (rawNetwork !== 'testnet' && rawNetwork !== 'mainnet') {
    throw new Error(
      `Invalid STELLAR_NETWORK "${env.STELLAR_NETWORK}". Must be "testnet" or "mainnet".`
    );
  }
  const network: StellarNetworkName = rawNetwork;

  const parsePositiveNumber = (
    raw: string | undefined,
    fallback: number,
    name: string
  ): number => {
    if (raw === undefined || raw.trim() === '') return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(`Invalid ${name}: must be a positive finite number`);
    }
    return parsed;
  };

  const maxFeePerCallUsdc = parsePositiveNumber(
    env.AGENT_MAX_FEE_PER_CALL,
    0.1,
    'AGENT_MAX_FEE_PER_CALL'
  );
  const feeBudgetUsdc = parsePositiveNumber(
    env.AGENT_FEE_BUDGET,
    0.5,
    'AGENT_FEE_BUDGET'
  );
  const rawMaxDeposit =
    env.AGENT_MAX_DEPOSIT !== undefined && env.AGENT_MAX_DEPOSIT.trim() !== ''
      ? env.AGENT_MAX_DEPOSIT
      : env.AGENT_MAX_deposit;
  const maxDepositUsdc = parsePositiveNumber(
    rawMaxDeposit,
    50.0,
    'AGENT_MAX_DEPOSIT'
  );
  const maxTxFeeXlm = parsePositiveNumber(
    env.AGENT_MAX_TX_FEE_XLM,
    1.0,
    'AGENT_MAX_TX_FEE_XLM'
  );

  const expectedPayTo = (
    env.SAFETRUST_PLATFORM_WALLET ??
    env.AGENT_EXPECTED_PAY_TO ??
    'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57'
  ).trim();

  const expectedAssetContract = (
    env.SAFETRUST_USDC_CONTRACT ?? getDefaultUsdcContract(network)
  ).trim();

  return {
    maxFeePerCallUsdc,
    feeBudgetUsdc,
    maxDepositUsdc,
    maxTxFeeXlm,
    network,
    expectedPayTo,
    expectedAssetContract,
  };
}

/**
 * Normalize either a SafeTrust 402 requirement object or a standard x402 v2
 * PaymentRequirements object into a single validated structure.
 */
export function normalize402Requirement(
  raw: Raw402Requirement
): NormalizedPaymentRequirement {
  if (!raw || typeof raw !== 'object') {
    throw new SpendingLimitError(
      'INVALID_REQUIREMENT',
      '402 requirement is missing or not an object'
    );
  }

  const scheme = typeof raw.scheme === 'string' ? raw.scheme.trim() : 'exact';
  const network = typeof raw.network === 'string' ? raw.network.trim() : '';
  if (!network) {
    throw new SpendingLimitError(
      'INVALID_REQUIREMENT',
      '402 requirement is missing network'
    );
  }

  const payTo = (
    typeof raw.payTo === 'string'
      ? raw.payTo
      : typeof raw.pay_to === 'string'
        ? raw.pay_to
        : ''
  ).trim();
  if (!payTo) {
    throw new SpendingLimitError(
      'INVALID_REQUIREMENT',
      '402 requirement is missing payTo address'
    );
  }

  let assetCode = 'USDC';
  let assetContract = '';
  if (typeof raw.asset === 'string') {
    assetContract = raw.asset.trim();
  } else if (raw.asset && typeof raw.asset === 'object') {
    if (typeof raw.asset.code === 'string' && raw.asset.code.trim()) {
      assetCode = raw.asset.code.trim();
    }
    if (typeof raw.asset.contract === 'string') {
      assetContract = raw.asset.contract.trim();
    }
  }

  if (!assetContract) {
    throw new SpendingLimitError(
      'INVALID_REQUIREMENT',
      '402 requirement is missing asset contract address'
    );
  }

  let amountUsdc: number;
  let amountAtomic: string;

  if (raw.max_amount_usdc !== undefined && raw.max_amount_usdc !== null) {
    const parsed = Number(raw.max_amount_usdc);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new SpendingLimitError(
        'INVALID_REQUIREMENT',
        `Invalid max_amount_usdc in 402 requirement: ${raw.max_amount_usdc}`
      );
    }
    amountUsdc = roundUsdc(parsed);
    amountAtomic = usdcToAtomic(amountUsdc);
  } else if (raw.amount !== undefined && raw.amount !== null) {
    const rawStr = String(raw.amount).trim();
    if (/^\d+$/.test(rawStr)) {
      amountAtomic = rawStr;
      amountUsdc = atomicToUsdc(rawStr);
    } else {
      const parsed = Number(rawStr);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new SpendingLimitError(
          'INVALID_REQUIREMENT',
          `Invalid amount in 402 requirement: ${raw.amount}`
        );
      }
      amountUsdc = roundUsdc(parsed);
      amountAtomic = usdcToAtomic(amountUsdc);
    }
  } else if (
    raw.maxAmountRequired !== undefined &&
    raw.maxAmountRequired !== null
  ) {
    const rawStr = String(raw.maxAmountRequired).trim();
    if (/^\d+$/.test(rawStr)) {
      amountAtomic = rawStr;
      amountUsdc = atomicToUsdc(rawStr);
    } else {
      const parsed = Number(rawStr);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new SpendingLimitError(
          'INVALID_REQUIREMENT',
          `Invalid maxAmountRequired in 402 requirement: ${raw.maxAmountRequired}`
        );
      }
      amountUsdc = roundUsdc(parsed);
      amountAtomic = usdcToAtomic(amountUsdc);
    }
  } else {
    throw new SpendingLimitError(
      'INVALID_REQUIREMENT',
      '402 requirement is missing amount / max_amount_usdc'
    );
  }

  const facilitatorUrl =
    typeof raw.facilitator_url === 'string'
      ? raw.facilitator_url
      : typeof raw.facilitatorUrl === 'string'
        ? raw.facilitatorUrl
        : typeof raw.extra?.facilitatorUrl === 'string'
          ? (raw.extra.facilitatorUrl as string)
          : undefined;

  return {
    scheme,
    network,
    amountUsdc,
    amountAtomic,
    assetCode,
    assetContract,
    payTo,
    facilitatorUrl,
    description: raw.description,
  };
}

/**
 * In-code spending ledger that enforces per-call fee caps, session fee budgets,
 * maximum deposit limits, and destination/network/asset checks before any payment
 * or escrow deposit is signed.
 */
export class SpendingLedger {
  private readonly config: Required<AgentSpendingConfig>;
  private readonly paidCalls: PaidCallRecord[] = [];
  private readonly deposits: DepositRecord[] = [];
  private readonly feeReservations = new Map<string, FeeReservation>();
  private readonly paidCallsByReservationId = new Map<string, PaidCallRecord>();
  private readonly recordedDepositBookings = new Map<string, DepositRecord>();
  private feesSpentUsdc = 0;
  private feesReservedUsdc = 0;
  private depositsLockedUsdc = 0;

  constructor(config: AgentSpendingConfig) {
    if (!config.expectedPayTo || !config.expectedPayTo.trim()) {
      throw new Error('SpendingLedger requires a non-empty expectedPayTo address');
    }
    const maxTxFeeXlm = config.maxTxFeeXlm ?? 1.0;
    if (!Number.isFinite(maxTxFeeXlm) || maxTxFeeXlm <= 0) {
      throw new Error('SpendingLedger requires a positive finite maxTxFeeXlm');
    }
    this.config = {
      ...config,
      maxTxFeeXlm,
      expectedPayTo: config.expectedPayTo.trim(),
      expectedAssetContract: (
        config.expectedAssetContract ?? getDefaultUsdcContract(config.network)
      ).trim(),
    };
  }

  public getConfig(): Readonly<Required<AgentSpendingConfig>> {
    return this.config;
  }

  public getFeesSpentUsdc(): number {
    return roundUsdc(this.feesSpentUsdc);
  }

  public getFeesReservedUsdc(): number {
    return roundUsdc(this.feesReservedUsdc);
  }

  public getRemainingFeeBudgetUsdc(): number {
    return roundUsdc(
      Math.max(
        0,
        this.config.feeBudgetUsdc - this.feesSpentUsdc - this.feesReservedUsdc
      )
    );
  }

  public getDepositsLockedUsdc(): number {
    return roundUsdc(this.depositsLockedUsdc);
  }

  /**
   * Check a 402 payment requirement before paying.
   * Validates:
   *  1. network matches configured SafeTrust Stellar network
   *  2. payTo matches configured SafeTrust platform wallet
   *  3. asset is USDC matching configured SEP-41 contract for the network
   *  4. amount <= maxFeePerCallUsdc
   *  5. feesSpentUsdc + feesReservedUsdc + amount <= feeBudgetUsdc
   *
   * Throws SpendingLimitError if any rule is violated.
   */
  public verifyBeforePay(
    rawRequirement: Raw402Requirement
  ): NormalizedPaymentRequirement {
    const req = normalize402Requirement(rawRequirement);

    if (!isMatchingStellarNetwork(req.network, this.config.network)) {
      throw new SpendingLimitError(
        'NETWORK_MISMATCH',
        `Refusing x402 payment: server requested network "${req.network}", expected "stellar:${this.config.network}"`
      );
    }

    if (req.payTo !== this.config.expectedPayTo) {
      throw new SpendingLimitError(
        'UNTRUSTED_PAY_TO',
        `Refusing x402 payment: server payTo "${req.payTo}" does not match configured SafeTrust wallet "${this.config.expectedPayTo}"`
      );
    }

    if (
      req.assetCode.toUpperCase() !== 'USDC' ||
      req.assetContract !== this.config.expectedAssetContract
    ) {
      throw new SpendingLimitError(
        'ASSET_MISMATCH',
        `Refusing x402 payment: server requested asset "${req.assetCode}" (${req.assetContract}), expected USDC (${this.config.expectedAssetContract})`
      );
    }

    if (req.amountUsdc > this.config.maxFeePerCallUsdc + 1e-9) {
      throw new SpendingLimitError(
        'FEE_PER_CALL_EXCEEDED',
        `Refusing x402 payment: call fee ${req.amountUsdc.toFixed(2)} USDC exceeds AGENT_MAX_FEE_PER_CALL (${this.config.maxFeePerCallUsdc.toFixed(2)} USDC)`
      );
    }

    const projectedTotal = roundUsdc(
      this.feesSpentUsdc + this.feesReservedUsdc + req.amountUsdc
    );
    if (projectedTotal > this.config.feeBudgetUsdc + 1e-9) {
      throw new SpendingLimitError(
        'FEE_BUDGET_EXCEEDED',
        `Refusing x402 payment: call fee ${req.amountUsdc.toFixed(2)} USDC would bring session total to ${projectedTotal.toFixed(2)} USDC, exceeding AGENT_FEE_BUDGET (${this.config.feeBudgetUsdc.toFixed(2)} USDC). Free calls still work.`
      );
    }

    return req;
  }

  /**
   * Atomically verify and reserve budget for an in-flight x402 fee payment.
   * Reserved amounts count against `AGENT_FEE_BUDGET` until either committed
   * (settled) or explicitly released on a definitive settlement rejection.
   */
  public reserveFeePayment(
    rawRequirement: Raw402Requirement,
    endpoint = ''
  ): FeeReservation {
    const verified = this.verifyBeforePay(rawRequirement);
    const id = randomBytes(8).toString('hex');
    const reservation: FeeReservation = {
      id,
      endpoint,
      requirement: verified,
      status: 'reserved',
      createdAt: new Date().toISOString(),
    };
    this.feesReservedUsdc = roundUsdc(
      this.feesReservedUsdc + verified.amountUsdc
    );
    this.feeReservations.set(id, reservation);
    return reservation;
  }

  /**
   * Commit a previously reserved fee payment once settlement is confirmed.
   * Idempotent for an already-settled reservation.
   */
  public commitFeeReservation(reservationId: string): PaidCallRecord {
    const existingRecord = this.paidCallsByReservationId.get(reservationId);
    if (existingRecord) {
      return existingRecord;
    }

    const reservation = this.feeReservations.get(reservationId);
    if (!reservation) {
      throw new SpendingLimitError(
        'INVALID_REQUIREMENT',
        `Unknown fee reservation "${reservationId}"`
      );
    }
    if (reservation.status === 'released') {
      throw new SpendingLimitError(
        'INVALID_REQUIREMENT',
        `Cannot commit released fee reservation "${reservationId}"`
      );
    }

    const { requirement, endpoint } = reservation;
    this.feesReservedUsdc = roundUsdc(
      Math.max(0, this.feesReservedUsdc - requirement.amountUsdc)
    );
    this.feesSpentUsdc = roundUsdc(this.feesSpentUsdc + requirement.amountUsdc);
    reservation.status = 'settled';

    const record: PaidCallRecord = {
      id: reservation.id,
      endpoint,
      amountUsdc: requirement.amountUsdc,
      amountAtomic: requirement.amountAtomic,
      assetContract: requirement.assetContract,
      network: `stellar:${this.config.network}`,
      payTo: requirement.payTo,
      timestamp: new Date().toISOString(),
    };
    this.paidCalls.push(record);
    this.paidCallsByReservationId.set(reservationId, record);
    return record;
  }

  /**
   * Release a pending fee reservation when a paid retry is definitively rejected
   * without settlement (or when signing fails before sending the retry).
   */
  public releaseFeeReservation(reservationId: string): boolean {
    const reservation = this.feeReservations.get(reservationId);
    if (!reservation || reservation.status !== 'reserved') {
      return false;
    }
    this.feesReservedUsdc = roundUsdc(
      Math.max(0, this.feesReservedUsdc - reservation.requirement.amountUsdc)
    );
    reservation.status = 'released';
    return true;
  }

  /**
   * Retrieve a fee reservation by ID.
   */
  public getFeeReservation(reservationId: string): FeeReservation | undefined {
    const reservation = this.feeReservations.get(reservationId);
    return reservation ? { ...reservation } : undefined;
  }

  /**
   * Return all fee reservations currently pending settlement reconciliation.
   */
  public getPendingFeeReservations(): FeeReservation[] {
    return Array.from(this.feeReservations.values())
      .filter((r) => r.status === 'reserved')
      .map((r) => ({ ...r }));
  }

  /**
   * Attach a settlement reference (e.g. signed payment transaction payload or ID)
   * to a pending fee reservation so it can be reconciled later in the session.
   */
  public setFeeReservationSettlementRef(
    reservationId: string,
    settlementRef: string
  ): void {
    const reservation = this.feeReservations.get(reservationId);
    if (reservation && reservation.status === 'reserved' && settlementRef.trim()) {
      reservation.settlementRef = settlementRef.trim();
    }
  }

  /**
   * Reconcile a pending fee reservation within the session by querying settlement status.
   * Commits the reservation if definitively settled, releases it if definitively not settled,
   * and preserves pending status if the outcome remains unknown or the query fails.
   */
  public async reconcileFeeReservation(
    reservationId: string,
    querySettlement: FeeSettlementResolver
  ): Promise<ReconcileFeeReservationResult> {
    const reservation = this.feeReservations.get(reservationId);
    if (!reservation) {
      throw new SpendingLimitError(
        'INVALID_REQUIREMENT',
        `Unknown fee reservation "${reservationId}"`
      );
    }

    if (reservation.status === 'settled') {
      return {
        status: 'settled',
        reservation: { ...reservation },
        paidCall: this.paidCallsByReservationId.get(reservationId),
      };
    }

    if (reservation.status === 'released') {
      return {
        status: 'released',
        reservation: { ...reservation },
      };
    }

    let settlementStatus: FeeSettlementStatus = 'unknown';
    try {
      settlementStatus = await querySettlement({ ...reservation });
    } catch {
      settlementStatus = 'unknown';
    }

    if (settlementStatus === 'settled') {
      const paidCall = this.commitFeeReservation(reservationId);
      return {
        status: 'settled',
        reservation: { ...reservation },
        paidCall,
      };
    }

    if (settlementStatus === 'not_settled') {
      this.releaseFeeReservation(reservationId);
      return {
        status: 'released',
        reservation: { ...reservation },
      };
    }

    return {
      status: 'pending',
      reservation: { ...reservation },
    };
  }

  /**
   * Record a verified x402 fee payment in the session ledger.
   */
  public recordFeePayment(
    requirement: NormalizedPaymentRequirement,
    endpoint = ''
  ): PaidCallRecord {
    const reservation = this.reserveFeePayment(
      {
        scheme: requirement.scheme,
        network: requirement.network,
        amount: requirement.amountAtomic,
        asset: {
          code: requirement.assetCode,
          contract: requirement.assetContract,
        },
        payTo: requirement.payTo,
        facilitatorUrl: requirement.facilitatorUrl,
        description: requirement.description,
      },
      endpoint
    );
    return this.commitFeeReservation(reservation.id);
  }

  /**
   * Check whether an escrow deposit amount is within the configured AGENT_MAX_DEPOSIT limit.
   * Compares exact 7-decimal atomic units against the floored cap so rounding can never
   * allow a signed deposit above AGENT_MAX_DEPOSIT.
   * Throws SpendingLimitError if the deposit exceeds the limit.
   */
  public verifyDepositLimit(amountUsdc: number): void {
    if (!Number.isFinite(amountUsdc) || amountUsdc <= 0) {
      throw new SpendingLimitError(
        'INVALID_REQUIREMENT',
        `Deposit amount must be a positive number, got: ${amountUsdc}`
      );
    }
    const maxDepositAtomic = decimalCapToMaxAtomic(this.config.maxDepositUsdc);
    const amountAtomic = BigInt(usdcToAtomic(amountUsdc));
    if (amountAtomic > maxDepositAtomic) {
      throw new SpendingLimitError(
        'DEPOSIT_LIMIT_EXCEEDED',
        `Booking refused: deposit ${amountUsdc.toFixed(2)} USDC exceeds AGENT_MAX_DEPOSIT (${this.config.maxDepositUsdc.toFixed(2)} USDC)`
      );
    }
  }

  /**
   * Record a confirmed escrow deposit in the session ledger.
   * Idempotent per bookingId so retries cannot double-count a funded booking.
   */
  public recordDeposit(params: {
    bookingId: string;
    contractId: string;
    amountUsdc: number;
    assetContract?: string;
    txHash?: string;
  }): DepositRecord {
    const existing = this.recordedDepositBookings.get(params.bookingId);
    if (existing) {
      return existing;
    }

    this.verifyDepositLimit(params.amountUsdc);
    const amountUsdc = roundUsdc(params.amountUsdc);
    const amountAtomic = usdcToAtomic(amountUsdc);
    this.depositsLockedUsdc = roundUsdc(this.depositsLockedUsdc + amountUsdc);
    const record: DepositRecord = {
      bookingId: params.bookingId,
      contractId: params.contractId,
      amountUsdc,
      amountAtomic,
      assetContract: params.assetContract ?? this.config.expectedAssetContract,
      network: `stellar:${this.config.network}`,
      txHash: params.txHash,
      timestamp: new Date().toISOString(),
    };
    this.deposits.push(record);
    this.recordedDepositBookings.set(params.bookingId, record);
    return record;
  }

  /**
   * Return a structured and human-readable summary of all fees and deposits in this session.
   */
  public getSummary(): SpendingSummary {
    const feesSpent = this.getFeesSpentUsdc();
    const feesReserved = this.getFeesReservedUsdc();
    const depositsLocked = this.getDepositsLockedUsdc();
    const formatted = `Fees ${feesSpent.toFixed(2)} / ${this.config.feeBudgetUsdc.toFixed(2)} USDC · Deposit ${depositsLocked.toFixed(2)} / ${this.config.maxDepositUsdc.toFixed(2)} USDC`;

    return {
      feesSpentUsdc: feesSpent,
      feesReservedUsdc: feesReserved,
      feeBudgetUsdc: this.config.feeBudgetUsdc,
      remainingFeeBudgetUsdc: this.getRemainingFeeBudgetUsdc(),
      maxFeePerCallUsdc: this.config.maxFeePerCallUsdc,
      depositsLockedUsdc: depositsLocked,
      maxDepositUsdc: this.config.maxDepositUsdc,
      network: this.config.network,
      caip2Network: toCaip2Network(this.config.network),
      expectedPayTo: this.config.expectedPayTo,
      expectedAssetContract: this.config.expectedAssetContract,
      paidCalls: [...this.paidCalls],
      pendingFeeReservations: this.getPendingFeeReservations(),
      deposits: [...this.deposits],
      formatted,
    };
  }
}

export interface CreateX402FetchOptions {
  /** Base fetch implementation (defaults to globalThis.fetch) */
  baseFetch?: typeof globalThis.fetch;
  /** Spending ledger that checks and records every 402 payment */
  ledger: SpendingLedger;
  /**
   * Stellar secret key (S...) or pre-built ClientStellarSigner.
   * When a secret key string is passed, createEd25519Signer from @x402/stellar is used.
   */
  signerOrSecret: string | ClientStellarSigner;
  /** Optional custom scheme client (for unit tests or custom RPC overrides) */
  schemeClient?: SchemeNetworkClient;
  /** Optional Soroban RPC / Horizon config for ExactStellarScheme */
  rpcConfig?: RpcConfig;
}

const responsePaymentRecords = new WeakMap<Response, PaidCallRecord>();
const responsePendingReservations = new WeakMap<Response, FeeReservation>();

/**
 * Retrieve the exact PaidCallRecord settled for a specific fetch Response,
 * avoiding race conditions from diffing shared session totals under concurrency.
 */
export function getPaymentRecordForResponse(
  response: Response
): PaidCallRecord | undefined {
  return responsePaymentRecords.get(response);
}

/**
 * Retrieve a pending FeeReservation associated with a non-ok ambiguous Response
 * (e.g. 5xx or malformed settlement header) so callers can reconcile it in-session.
 */
export function getPendingReservationForResponse(
  response: Response
): FeeReservation | undefined {
  return responsePendingReservations.get(response);
}

/**
 * Parse a base64-encoded x402 v2 `PAYMENT-RESPONSE` / `X-PAYMENT-RESPONSE` header.
 * Returns null if missing or malformed.
 */
function parseSettlementResponseHeader(
  rawHeader: string | null
): Record<string, unknown> | null {
  if (!rawHeader || !rawHeader.trim()) {
    return null;
  }
  try {
    const decoded = Buffer.from(rawHeader.trim(), 'base64').toString('utf8');
    const parsed = JSON.parse(decoded) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Determine whether a non-2xx response to a paid retry represents a definitive
 * settlement rejection (safe to release the fee reservation) vs. an uncertain
 * server/transport failure (must keep the reservation pending).
 *
 * - When `PAYMENT-RESPONSE` or `X-PAYMENT-RESPONSE` is present: parse it and
 *   release ONLY when it definitively confirms no settlement (`success === false`
 *   and no transaction hash). Malformed headers or unknown outcomes keep the
 *   reservation pending.
 * - When neither header is present: preserve the legacy headerless rejection
 *   path (4xx guarantees no settlement).
 */
function isDefinitivePaymentRejection(response: Response): boolean {
  if (response.status < 400 || response.status >= 500) {
    return false;
  }

  const rawHeader =
    response.headers.get('PAYMENT-RESPONSE') ??
    response.headers.get('X-PAYMENT-RESPONSE');

  if (rawHeader !== null) {
    const parsed = parseSettlementResponseHeader(rawHeader);
    if (!parsed) {
      return false;
    }
    if (parsed.success !== false) {
      return false;
    }
    const tx = parsed.transaction;
    const hasTransaction =
      typeof tx === 'string'
        ? tx.trim().length > 0
        : tx !== undefined && tx !== null;
    return !hasTransaction;
  }

  return true;
}

/**
 * Normalize either a standard x402 v2 `PAYMENT-REQUIRED` header (which may carry
 * a plain-text or empty body) or a legacy SafeTrust 402 JSON response body into
 * a Response carrying the standard `PAYMENT-REQUIRED` header expected by `@x402/fetch`.
 */
function adaptSafeTrust402Response(
  response: Response,
  requestUrl: string,
  ledger: SpendingLedger
): Promise<{
  adaptedResponse: Response;
  verifiedRequirement: NormalizedPaymentRequirement;
  facilitatorUrl?: string;
}> {
  return (async () => {
    let accepts: Raw402Requirement[] | undefined;
    let errorMessage = 'Payment Required';

    // 1. Prefer the standard x402 v2 PAYMENT-REQUIRED header before requiring a JSON body
    const headerPaymentRequired = response.headers.get('PAYMENT-REQUIRED');
    if (headerPaymentRequired) {
      try {
        const decoded = JSON.parse(
          Buffer.from(headerPaymentRequired, 'base64').toString('utf8')
        ) as { accepts?: Raw402Requirement[]; error?: unknown };
        if (Array.isArray(decoded.accepts) && decoded.accepts.length > 0) {
          accepts = decoded.accepts;
          if (typeof decoded.error === 'string' && decoded.error.trim()) {
            errorMessage = decoded.error;
          }
        }
      } catch {
        // Fall through to legacy JSON body parsing if header is not valid base64 JSON
      }
    }

    // 2. Fall back to legacy SafeTrust JSON body when PAYMENT-REQUIRED header lacks accepts
    if (!accepts || accepts.length === 0) {
      const text = await response.text();
      let body: Record<string, unknown> = {};
      if (text) {
        try {
          body = JSON.parse(text) as Record<string, unknown>;
        } catch {
          throw new SpendingLimitError(
            'INVALID_REQUIREMENT',
            '402 response body is not valid JSON'
          );
        }
      }
      if (Array.isArray(body.accepts)) {
        accepts = body.accepts as Raw402Requirement[];
      }
      if (typeof body.error === 'string' && body.error.trim()) {
        errorMessage = body.error;
      }
    }

    if (!accepts || accepts.length === 0) {
      throw new SpendingLimitError(
        'INVALID_REQUIREMENT',
        '402 response does not contain any payment requirements in accepts[]'
      );
    }

    // Check the requirement against the spending ledger BEFORE any signing or payment
    const rawReq = accepts[0];
    const verifiedReq = ledger.verifyBeforePay(rawReq);
    const caip2Network = toCaip2Network(ledger.getConfig().network) as `${string}:${string}`;

    const v2Requirements: PaymentRequirements = {
      scheme: 'exact',
      network: caip2Network,
      amount: verifiedReq.amountAtomic,
      asset: verifiedReq.assetContract,
      payTo: verifiedReq.payTo,
      maxTimeoutSeconds:
        typeof rawReq.maxTimeoutSeconds === 'number' && rawReq.maxTimeoutSeconds > 0
          ? rawReq.maxTimeoutSeconds
          : 60,
      extra: {
        areFeesSponsored: true,
        ...(rawReq.extra ?? {}),
      },
    };

    const paymentRequiredPayload = {
      x402Version: 2,
      error: errorMessage,
      resource: {
        url: requestUrl || 'https://safetrust.local/api',
        description: verifiedReq.description ?? 'SafeTrust booking fee',
        mimeType: 'application/json',
      },
      accepts: [v2Requirements],
    };

    const encodedHeader = Buffer.from(
      JSON.stringify(paymentRequiredPayload),
      'utf8'
    ).toString('base64');

    const headers = new Headers(response.headers);
    headers.set('PAYMENT-REQUIRED', encodedHeader);

    const adaptedResponse = new Response(JSON.stringify(paymentRequiredPayload), {
      status: 402,
      statusText: response.statusText || 'Payment Required',
      headers,
    });

    return {
      adaptedResponse,
      verifiedRequirement: verifiedReq,
      facilitatorUrl: verifiedReq.facilitatorUrl,
    };
  })();
}

/**
 * Create an `@x402/fetch` payment-enabled fetch function bound to the session
 * `SpendingLedger` and the user's Stellar signer.
 *
 * All per-call 402 state (requirement, facilitator URL, endpoint, and fee reservation)
 * is strictly scoped to each individual request invocation so concurrent calls never
 * cross-contaminate state or bypass `AGENT_FEE_BUDGET`.
 */
export type FetchInput = Parameters<typeof globalThis.fetch>[0];

export function createPaymentFetch(
  options: CreateX402FetchOptions
): (input: FetchInput, init?: RequestInit) => Promise<Response> {
  const baseFetch = options.baseFetch ?? globalThis.fetch;
  const { ledger } = options;
  const config = ledger.getConfig();
  const caip2Network = toCaip2Network(config.network) as `${string}:${string}`;

  const signer: ClientStellarSigner =
    typeof options.signerOrSecret === 'string'
      ? createEd25519Signer(options.signerOrSecret, caip2Network)
      : options.signerOrSecret;

  const schemeClient: SchemeNetworkClient =
    options.schemeClient ?? new ExactStellarScheme(signer, options.rpcConfig);

  return async (input: FetchInput, init?: RequestInit): Promise<Response> => {
    const client = new x402Client();
    // Disable built-in $1 default cap so our SpendingLedger enforces the exact
    // AGENT_MAX_FEE_PER_CALL and AGENT_FEE_BUDGET with clear domain errors.
    client.setSpendControls(false);
    client.register(caip2Network, schemeClient);
    // Also register `stellar:mainnet` alias when on mainnet
    if (config.network === 'mainnet') {
      client.register('stellar:mainnet', schemeClient);
    }

    // Per-call isolated payment state
    let callFacilitatorUrl: string | undefined;
    let callEndpoint = '';
    let callReservation: FeeReservation | null = null;
    let callPaidRecord: PaidCallRecord | null = null;
    let callSpendingLimitError: SpendingLimitError | null = null;
    let paidRetrySent = false;

    client.onBeforePaymentCreation(
      async ({
        selectedRequirements,
      }: {
        selectedRequirements: PaymentRequirements;
      }) => {
        // Atomically verify limits and reserve budget before creating the signed payload
        // so overlapping concurrent calls cannot both pass against the same remaining balance.
        try {
          callReservation = ledger.reserveFeePayment(
            {
              scheme: selectedRequirements.scheme,
              network: selectedRequirements.network,
              amount: selectedRequirements.amount,
              asset: selectedRequirements.asset,
              payTo: selectedRequirements.payTo,
              facilitatorUrl: callFacilitatorUrl,
            },
            callEndpoint
          );
        } catch (err) {
          if (err instanceof SpendingLimitError) {
            callSpendingLimitError = err;
          }
          throw err;
        }
      }
    );

    const httpClient = new x402HTTPClient(client);

    const transportFetch: typeof globalThis.fetch = async (
      reqInput: FetchInput,
      reqInit?: RequestInit
    ): Promise<Response> => {
      const req = new Request(reqInput, reqInit);
      const paymentSig = req.headers.get('PAYMENT-SIGNATURE');
      const isPaidRetry = Boolean(paymentSig || req.headers.has('x-payment'));

      // When @x402/fetch retries with PAYMENT-SIGNATURE, also populate SafeTrust's
      // X-Payment header ("x402 <base64-json>") so both x402 v2 servers and
      // SafeTrust's x402-processor Rust addon accept the header seamlessly.
      if (paymentSig && !req.headers.has('x-payment')) {
        try {
          const decoded = JSON.parse(
            Buffer.from(paymentSig, 'base64').toString('utf8')
          ) as {
            payload?: { transaction?: string } | string;
            accepted?: { amount?: string; network?: string };
          };
          const txPayload =
            typeof decoded.payload === 'object' && decoded.payload !== null
              ? (decoded.payload.transaction ?? JSON.stringify(decoded.payload))
              : String(decoded.payload ?? '');
          if (callReservation && txPayload) {
            ledger.setFeeReservationSettlementRef(callReservation.id, txPayload);
          }
          const atomicStr = decoded.accepted?.amount ?? '0';
          const amountUsdc = /^\d+$/.test(atomicStr)
            ? atomicToUsdc(atomicStr)
            : Number(atomicStr);

          const safeTrustPaymentObj = {
            scheme: 'exact',
            network: `stellar:${config.network}`,
            payload: txPayload,
            amount: amountUsdc,
            facilitatorUrl: callFacilitatorUrl ?? '',
          };
          const safeTrustEncoded = Buffer.from(
            JSON.stringify(safeTrustPaymentObj),
            'utf8'
          ).toString('base64');
          req.headers.set('X-Payment', `x402 ${safeTrustEncoded}`);
        } catch {
          // Leave original header untouched if custom decoding fails
        }
      }

      if (isPaidRetry) {
        paidRetrySent = true;
      }

      const response = await baseFetch(req);

      if (isPaidRetry && callReservation) {
        if (response.ok) {
          callPaidRecord = ledger.commitFeeReservation(callReservation.id);
        } else if (isDefinitivePaymentRejection(response)) {
          ledger.releaseFeeReservation(callReservation.id);
        } else {
          // On 5xx or ambiguous settlement response, leave the reservation pending
          // and expose it on the Response for in-session reconciliation.
          const latest = ledger.getFeeReservation(callReservation.id);
          if (latest) {
            responsePendingReservations.set(response, latest);
          }
        }
        return response;
      }

      if (response.status !== 402) {
        return response;
      }

      // If a payment was already attached and server still returned 402, do not re-adapt
      if (isPaidRetry) {
        return response;
      }

      callEndpoint = req.url;
      const adapted = await adaptSafeTrust402Response(response, req.url, ledger);
      callFacilitatorUrl = adapted.facilitatorUrl;
      return adapted.adaptedResponse;
    };

    const wrappedFetch = wrapFetchWithPayment(transportFetch, httpClient);
    try {
      const finalResponse = await wrappedFetch(input, init);
      if (callPaidRecord) {
        responsePaymentRecords.set(finalResponse, callPaidRecord);
      } else if (callReservation) {
        const latest = ledger.getFeeReservation(
          (callReservation as FeeReservation).id
        );
        if (latest && latest.status === 'reserved') {
          responsePendingReservations.set(finalResponse, latest);
        }
      }
      return finalResponse;
    } catch (err) {
      // Release reservation only if signing/setup failed before the paid retry was sent.
      // If the paid retry was sent and failed due to network/timeout, keep the reservation
      // pending and surface the reservation ID / settlement reference on the error so the
      // caller can reconcile it within the session.
      if (callReservation) {
        const res = callReservation as FeeReservation;
        if (!paidRetrySent) {
          ledger.releaseFeeReservation(res.id);
        } else {
          const latest = ledger.getFeeReservation(res.id) ?? res;
          if (latest.status === 'reserved') {
            throw new PendingPaymentSettlementError({
              reservation: latest,
              cause: err,
            });
          }
        }
      }
      if (callSpendingLimitError) {
        throw callSpendingLimitError;
      }
      throw err;
    }
  };
}
