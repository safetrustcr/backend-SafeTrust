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

export interface DepositRecord {
  bookingId: string;
  contractId: string;
  amountUsdc: number;
  amountAtomic: string;
  assetContract: string;
  network: string;
  timestamp: string;
}

export interface SpendingSummary {
  feesSpentUsdc: number;
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
  const maxDepositUsdc = parsePositiveNumber(
    env.AGENT_MAX_deposit ?? env.AGENT_MAX_DEPOSIT,
    50.0,
    'AGENT_MAX_DEPOSIT'
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
  private feesSpentUsdc = 0;
  private depositsLockedUsdc = 0;

  constructor(config: AgentSpendingConfig) {
    if (!config.expectedPayTo || !config.expectedPayTo.trim()) {
      throw new Error('SpendingLedger requires a non-empty expectedPayTo address');
    }
    this.config = {
      ...config,
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

  public getRemainingFeeBudgetUsdc(): number {
    return roundUsdc(Math.max(0, this.config.feeBudgetUsdc - this.feesSpentUsdc));
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
   *  5. feesSpentUsdc + amount <= feeBudgetUsdc
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

    const projectedTotal = roundUsdc(this.feesSpentUsdc + req.amountUsdc);
    if (projectedTotal > this.config.feeBudgetUsdc + 1e-9) {
      throw new SpendingLimitError(
        'FEE_BUDGET_EXCEEDED',
        `Refusing x402 payment: call fee ${req.amountUsdc.toFixed(2)} USDC would bring session total to ${projectedTotal.toFixed(2)} USDC, exceeding AGENT_FEE_BUDGET (${this.config.feeBudgetUsdc.toFixed(2)} USDC). Free calls still work.`
      );
    }

    return req;
  }

  /**
   * Record a verified x402 fee payment in the session ledger.
   */
  public recordFeePayment(
    requirement: NormalizedPaymentRequirement,
    endpoint = ''
  ): PaidCallRecord {
    const verified = this.verifyBeforePay({
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
    });
    this.feesSpentUsdc = roundUsdc(this.feesSpentUsdc + verified.amountUsdc);
    const record: PaidCallRecord = {
      id: randomBytes(8).toString('hex'),
      endpoint,
      amountUsdc: verified.amountUsdc,
      amountAtomic: verified.amountAtomic,
      assetContract: verified.assetContract,
      network: `stellar:${this.config.network}`,
      payTo: verified.payTo,
      timestamp: new Date().toISOString(),
    };
    this.paidCalls.push(record);
    return record;
  }

  /**
   * Check whether an escrow deposit amount is within the configured AGENT_MAX_DEPOSIT limit.
   * Throws SpendingLimitError if the deposit exceeds the limit.
   */
  public verifyDepositLimit(amountUsdc: number): void {
    if (!Number.isFinite(amountUsdc) || amountUsdc <= 0) {
      throw new SpendingLimitError(
        'INVALID_REQUIREMENT',
        `Deposit amount must be a positive number, got: ${amountUsdc}`
      );
    }
    if (amountUsdc > this.config.maxDepositUsdc + 1e-9) {
      throw new SpendingLimitError(
        'DEPOSIT_LIMIT_EXCEEDED',
        `Booking refused: deposit ${amountUsdc.toFixed(2)} USDC exceeds AGENT_MAX_DEPOSIT (${this.config.maxDepositUsdc.toFixed(2)} USDC)`
      );
    }
  }

  /**
   * Record a signed escrow deposit in the session ledger.
   */
  public recordDeposit(params: {
    bookingId: string;
    contractId: string;
    amountUsdc: number;
    assetContract?: string;
  }): DepositRecord {
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
      timestamp: new Date().toISOString(),
    };
    this.deposits.push(record);
    return record;
  }

  /**
   * Return a structured and human-readable summary of all fees and deposits in this session.
   */
  public getSummary(): SpendingSummary {
    const feesSpent = this.getFeesSpentUsdc();
    const depositsLocked = this.getDepositsLockedUsdc();
    const formatted = `Fees ${feesSpent.toFixed(2)} / ${this.config.feeBudgetUsdc.toFixed(2)} USDC · Deposit ${depositsLocked.toFixed(2)} / ${this.config.maxDepositUsdc.toFixed(2)} USDC`;

    return {
      feesSpentUsdc: feesSpent,
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

/**
 * Normalize a SafeTrust 402 response body (which uses snake_case `max_amount_usdc`,
 * `pay_to`, `asset: { code, contract, issuer }`, and `stellar:mainnet`) into a
 * Response carrying the standard `PAYMENT-REQUIRED` header expected by `@x402/fetch`,
 * and adapt the retry `PAYMENT-SIGNATURE` header to also include SafeTrust's
 * `X-Payment: x402 <base64>` header format.
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

    // If the response also has a PAYMENT-REQUIRED header, decode it if body lacks accepts
    let accepts = Array.isArray(body.accepts)
      ? (body.accepts as Raw402Requirement[])
      : undefined;

    const headerPaymentRequired = response.headers.get('PAYMENT-REQUIRED');
    if ((!accepts || accepts.length === 0) && headerPaymentRequired) {
      try {
        const decoded = JSON.parse(
          Buffer.from(headerPaymentRequired, 'base64').toString('utf8')
        ) as { accepts?: Raw402Requirement[] };
        if (Array.isArray(decoded.accepts)) {
          accepts = decoded.accepts;
        }
      } catch {
        // Fall through to validation error
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
      error: typeof body.error === 'string' ? body.error : 'Payment Required',
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
 * Every 402 response is inspected by `ledger.verifyBeforePay` and an
 * `x402Client.onBeforePaymentCreation` hook before signing, and recorded in
 * the ledger only when payment creation succeeds.
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

  const client = new x402Client();
  // Disable built-in $1 default cap so our SpendingLedger enforces the exact
  // AGENT_MAX_FEE_PER_CALL and AGENT_FEE_BUDGET with clear domain errors.
  client.setSpendControls(false);
  client.register(caip2Network, schemeClient);
  // Also register `stellar:mainnet` alias when on mainnet
  if (config.network === 'mainnet') {
    client.register('stellar:mainnet', schemeClient);
  }

  let pendingVerifiedRequirement: NormalizedPaymentRequirement | null = null;
  let pendingFacilitatorUrl: string | undefined;
  let pendingEndpoint = '';

  client.onBeforePaymentCreation(
    async ({
      selectedRequirements,
    }: {
      selectedRequirements: PaymentRequirements;
    }) => {
    // Double-check inside x402Client right before creating the signed payload
    ledger.verifyBeforePay({
      scheme: selectedRequirements.scheme,
      network: selectedRequirements.network,
      amount: selectedRequirements.amount,
      asset: selectedRequirements.asset,
      payTo: selectedRequirements.payTo,
    });
  });

  client.onAfterPaymentCreation(async () => {
    if (pendingVerifiedRequirement) {
      ledger.recordFeePayment(pendingVerifiedRequirement, pendingEndpoint);
      pendingVerifiedRequirement = null;
    }
  });

  const httpClient = new x402HTTPClient(client);

  const transportFetch: typeof globalThis.fetch = async (
    input: FetchInput,
    init?: RequestInit
  ): Promise<Response> => {
    const req = new Request(input, init);
    const paymentSig = req.headers.get('PAYMENT-SIGNATURE');

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
        const atomicStr = decoded.accepted?.amount ?? '0';
        const amountUsdc = /^\d+$/.test(atomicStr)
          ? atomicToUsdc(atomicStr)
          : Number(atomicStr);

        const safeTrustPaymentObj = {
          scheme: 'exact',
          network: `stellar:${config.network}`,
          payload: txPayload,
          amount: amountUsdc,
          facilitatorUrl: pendingFacilitatorUrl ?? '',
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

    const response = await baseFetch(req);
    if (response.status !== 402) {
      return response;
    }

    // If a payment was already attached and server still returned 402, do not re-adapt
    if (paymentSig || req.headers.has('x-payment')) {
      return response;
    }

    pendingEndpoint = req.url;
    const adapted = await adaptSafeTrust402Response(response, req.url, ledger);
    pendingVerifiedRequirement = adapted.verifiedRequirement;
    pendingFacilitatorUrl = adapted.facilitatorUrl;
    return adapted.adaptedResponse;
  };

  return wrapFetchWithPayment(transportFetch, httpClient);
}
