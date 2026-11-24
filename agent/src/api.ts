import { Keypair } from '@stellar/stellar-sdk';
import {
  SpendingLedger,
  SpendingLimitError,
  createPaymentFetch,
  getDefaultUsdcContract,
  getPaymentRecordForResponse,
  type StellarNetworkName,
} from './payments';

export class DepositSubmissionError extends Error {
  public readonly definitive: boolean;
  public readonly statusCode?: number;

  constructor(
    message: string,
    options: { definitive: boolean; statusCode?: number }
  ) {
    super(message);
    this.name = 'DepositSubmissionError';
    this.definitive = options.definitive;
    this.statusCode = options.statusCode;
  }
}

export interface PropertyListing {
  id: string;
  name: string;
  description?: string | null;
  location?: string;
  price: number;
  deposit: number;
  bedrooms: number;
  maxGuests?: number;
  petFriendly?: boolean;
  isAvailable?: boolean;
}

export interface SearchPropertiesParams {
  location?: string;
  checkIn?: string;
  checkOut?: string;
  guests?: number;
  minBedrooms?: number;
  minPrice?: number;
  maxPrice?: number;
  petFriendly?: boolean;
  page?: number;
  limit?: number;
}

export interface SearchPropertiesResponse {
  properties: PropertyListing[];
  total: number;
  feePaidUsdc: number;
}

export interface CheckAvailabilityParams {
  propertyId: string;
  checkIn: string;
  checkOut: string;
  guests?: number;
}

export interface AvailabilityQuote {
  propertyId: string;
  propertyName: string;
  available: boolean;
  checkIn: string;
  checkOut: string;
  nights: number;
  totalUsdc: number;
  depositUsdc: number;
  assetCode: 'USDC';
  feePaidUsdc: number;
}

export interface HoldDatesParams {
  propertyId: string;
  checkIn: string;
  checkOut: string;
  guests?: number;
}

export interface HoldRecord {
  holdId: string;
  propertyId: string;
  propertyName?: string;
  checkIn: string;
  checkOut: string;
  expiresAt: string;
  heldUntilFormatted: string;
  totalUsdc?: number;
  depositUsdc?: number;
  feePaidUsdc: number;
}

export interface ReleaseHoldParams {
  holdId: string;
}

export interface ReleaseHoldResponse {
  holdId: string;
  released: boolean;
  status: string;
}

export interface CreateBookingParams {
  propertyId: string;
  checkIn: string;
  checkOut: string;
  guests?: number;
  holdId?: string;
  totalUsdc?: number;
  depositUsdc?: number;
}

export interface BookingRecord {
  bookingId: string;
  propertyId: string;
  propertyName?: string;
  contractId: string;
  checkIn: string;
  checkOut: string;
  totalUsdc: number;
  depositUsdc: number;
  assetCode: 'USDC';
  assetContract: string;
  unsignedXdr: string;
  status: 'escrow_created' | 'funded';
  feePaidUsdc: number;
}

export interface SubmitDepositParams {
  bookingId: string;
  contractId: string;
  signedXdr: string;
  txHash: string;
  amountUsdc: number;
}

export interface SubmitDepositResponse {
  bookingId: string;
  contractId: string;
  txHash: string;
  status: 'funded';
  amountUsdc: number;
}

export interface SafeTrustApiClientOptions {
  /** Base URL of the SafeTrust API (default: http://localhost:3001) */
  baseUrl?: string;
  /** Session spending ledger */
  ledger: SpendingLedger;
  /** Stellar wallet secret key (S...) — never logged or exposed */
  secretKey: string;
  /** Optional custom fetch function (for testing or mock transport) */
  baseFetch?: typeof globalThis.fetch;
  /** Optional custom payment-wrapped fetch override */
  paymentFetch?: (input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => Promise<Response>;
  /** Optional pre-existing bearer token */
  sessionToken?: string;
}

function calculateNights(checkIn: string, checkOut: string): number {
  const start = new Date(checkIn);
  const end = new Date(checkOut);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
    return 1;
  }
  const diffDays = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  return Math.max(1, diffDays);
}

function formatTimeHHMM(isoString: string): string {
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return isoString;
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * Typed client for SafeTrust `/api/v1` (with compatibility fallbacks for `/api/...`).
 *
 * - Authenticates a free discovery session by signing `/api/auth/wallet-challenge`
 *   with the same Stellar wallet keypair.
 * - Uses `@x402/fetch` bound to `SpendingLedger` for paid endpoints (`hold_dates`, `create_booking`).
 * - Stores booking quotes (`contract_id`, `depositUsdc`, `unsignedXdr`) in-memory so
 *   `fund_deposit` can verify the XDR against the exact quoted booking parameters.
 */
export class SafeTrustApiClient {
  private readonly baseUrl: string;
  private readonly ledger: SpendingLedger;
  private readonly keypair: Keypair;
  private readonly baseFetch: typeof globalThis.fetch;
  private readonly payFetch: (input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => Promise<Response>;
  private sessionToken: string | null = null;
  private sessionAuthenticated = false;

  private readonly bookingsById = new Map<string, BookingRecord>();
  private readonly holdsById = new Map<string, HoldRecord>();
  private readonly availabilityByStay = new Map<string, AvailabilityQuote>();

  private makeStayQuoteKey(
    propertyId: string,
    checkIn: string,
    checkOut: string,
    guests?: number
  ): string {
    return JSON.stringify([propertyId, checkIn, checkOut, guests ?? null]);
  }

  constructor(options: SafeTrustApiClientOptions) {
    this.baseUrl = (
      options.baseUrl ??
      process.env.SAFETRUST_API_URL ??
      'http://localhost:3001'
    ).replace(/\/+$/, '');
    this.ledger = options.ledger;
    this.keypair = Keypair.fromSecret(options.secretKey.trim());
    this.baseFetch = options.baseFetch ?? globalThis.fetch;
    this.sessionToken = options.sessionToken ?? process.env.SAFETRUST_API_TOKEN ?? null;

    this.payFetch =
      options.paymentFetch ??
      createPaymentFetch({
        baseFetch: this.baseFetch,
        ledger: this.ledger,
        signerOrSecret: options.secretKey.trim(),
      });
  }

  public getWalletPublicKey(): string {
    return this.keypair.publicKey();
  }

  public getNetwork(): StellarNetworkName {
    return this.ledger.getConfig().network;
  }

  public getBooking(bookingId: string): BookingRecord | undefined {
    return this.bookingsById.get(bookingId);
  }

  public registerBooking(booking: BookingRecord): void {
    this.bookingsById.set(booking.bookingId, booking);
  }

  public getHold(holdId: string): HoldRecord | undefined {
    return this.holdsById.get(holdId);
  }

  /**
   * Obtain a free session using the `/api/auth/wallet-challenge` Ed25519 challenge-response
   * signed with the same Stellar wallet, so discovery (`search_properties`, `check_availability`)
   * is free.
   */
  public async ensureWalletSession(): Promise<string> {
    if (this.sessionAuthenticated && this.sessionToken) {
      return this.sessionToken;
    }

    const walletAddress = this.keypair.publicKey();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.sessionToken) {
      headers['Authorization'] = `Bearer ${this.sessionToken}`;
    }

    const challengeRes = await this.baseFetch(
      `${this.baseUrl}/api/auth/wallet-challenge/challenge`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ wallet_address: walletAddress }),
      }
    );

    if (!challengeRes.ok) {
      throw new Error(
        `Wallet challenge request failed with status ${challengeRes.status}`
      );
    }

    const challengeData = (await challengeRes.json()) as {
      challengeId: string;
      challenge: string;
      expiresAt: string;
    };

    const signatureBytes = this.keypair.sign(
      Buffer.from(challengeData.challenge, 'utf8')
    );
    const signatureHex = Buffer.from(signatureBytes).toString('hex');

    const verifyRes = await this.baseFetch(
      `${this.baseUrl}/api/auth/wallet-challenge/verify`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          challengeId: challengeData.challengeId,
          signature: signatureHex,
          is_primary: true,
        }),
      }
    );

    if (!verifyRes.ok) {
      throw new Error(
        `Wallet challenge verification failed with status ${verifyRes.status}`
      );
    }

    const verifyData = (await verifyRes.json()) as {
      token?: string;
      sessionToken?: string;
      wallet_address?: string;
    };

    this.sessionToken =
      verifyData.token ??
      verifyData.sessionToken ??
      this.sessionToken ??
      `wallet-session:${walletAddress}:${challengeData.challengeId}`;
    this.sessionAuthenticated = true;

    return this.sessionToken;
  }

  private async getSessionHeaders(): Promise<Record<string, string>> {
    const token = await this.ensureWalletSession();
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Wallet-Address': this.keypair.publicKey(),
    };
  }

  /**
   * Free session call: search SafeTrust properties (`/api/v1/properties`).
   */
  public async searchProperties(
    params: SearchPropertiesParams = {}
  ): Promise<SearchPropertiesResponse> {
    const headers = await this.getSessionHeaders();
    const qs = new URLSearchParams();
    if (params.location) qs.set('location', params.location);
    if (params.checkIn) qs.set('check_in', params.checkIn);
    if (params.checkOut) qs.set('check_out', params.checkOut);
    if (params.guests !== undefined) qs.set('guests', String(params.guests));
    if (params.minBedrooms !== undefined) {
      qs.set('bedrooms', String(params.minBedrooms));
      qs.set('min_bedrooms', String(params.minBedrooms));
    }
    if (params.minPrice !== undefined) qs.set('minPrice', String(params.minPrice));
    if (params.maxPrice !== undefined) qs.set('maxPrice', String(params.maxPrice));
    if (params.petFriendly !== undefined) {
      qs.set('petFriendly', String(params.petFriendly));
    }
    if (params.page !== undefined) qs.set('page', String(params.page));
    if (params.limit !== undefined) qs.set('limit', String(params.limit));

    const querySuffix = qs.toString() ? `?${qs.toString()}` : '';
    const response = await this.baseFetch(
      `${this.baseUrl}/api/v1/properties${querySuffix}`,
      {
        method: 'GET',
        headers,
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(
        `search_properties failed (${response.status}): ${errText}`
      );
    }

    const data = (await response.json()) as {
      properties?: Array<Record<string, unknown>>;
      apartments?: Array<Record<string, unknown>>;
      total?: number;
    };

    const rawList = data.properties ?? data.apartments ?? [];
    const properties: PropertyListing[] = rawList.map((item) => {
      const price = Number(item.price ?? item.price_per_night ?? 0);
      const deposit = Number(
        item.deposit ?? item.deposit_usdc ?? item.warranty_deposit ?? price * 0.3
      );
      return {
        id: String(item.id),
        name: String(item.name ?? 'Unnamed Property'),
        description:
          typeof item.description === 'string' ? item.description : null,
        location:
          typeof item.location === 'string'
            ? item.location
            : typeof (item.address as Record<string, unknown>)?.location === 'string'
              ? String((item.address as Record<string, unknown>).location)
              : undefined,
        price,
        deposit,
        bedrooms: Number(item.bedrooms ?? 1),
        maxGuests:
          item.max_guests !== undefined
            ? Number(item.max_guests)
            : item.maxGuests !== undefined
              ? Number(item.maxGuests)
              : undefined,
        petFriendly: Boolean(item.pet_friendly ?? item.petFriendly ?? false),
        isAvailable:
          item.is_available !== undefined ? Boolean(item.is_available) : true,
      };
    });

    return {
      properties,
      total: typeof data.total === 'number' ? data.total : properties.length,
      feePaidUsdc: 0,
    };
  }

  /**
   * Free session call: check availability and get total + deposit quote (`/api/v1/properties/:id/availability`).
   */
  public async checkAvailability(
    params: CheckAvailabilityParams
  ): Promise<AvailabilityQuote> {
    const headers = await this.getSessionHeaders();
    const qs = new URLSearchParams({
      check_in: params.checkIn,
      check_out: params.checkOut,
    });
    if (params.guests !== undefined) {
      qs.set('guests', String(params.guests));
    }

    const response = await this.baseFetch(
      `${this.baseUrl}/api/v1/properties/${encodeURIComponent(params.propertyId)}/availability?${qs.toString()}`,
      {
        method: 'GET',
        headers,
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(
        `check_availability failed (${response.status}): ${errText}`
      );
    }

    const data = (await response.json()) as Record<string, unknown>;
    const nights =
      typeof data.nights === 'number'
        ? data.nights
        : calculateNights(params.checkIn, params.checkOut);
    const totalUsdc = Number(
      data.total_usdc ?? data.totalUsdc ?? data.total_amount ?? data.total ?? 0
    );
    const depositUsdc = Number(
      data.deposit_usdc ??
        data.depositUsdc ??
        data.warranty_deposit ??
        data.deposit ??
        0
    );
    const propertyName = String(
      data.property_name ?? data.propertyName ?? data.name ?? params.propertyId
    );

    const quote: AvailabilityQuote = {
      propertyId: params.propertyId,
      propertyName,
      available: data.available !== undefined ? Boolean(data.available) : true,
      checkIn: params.checkIn,
      checkOut: params.checkOut,
      nights,
      totalUsdc,
      depositUsdc,
      assetCode: 'USDC',
      feePaidUsdc: 0,
    };

    const stayKey = this.makeStayQuoteKey(
      params.propertyId,
      params.checkIn,
      params.checkOut,
      params.guests
    );
    this.availabilityByStay.set(stayKey, quote);
    return quote;
  }

  /**
   * Paid x402 call: place a temporary hold on dates (`/api/v1/holds`).
   */
  public async holdDates(params: HoldDatesParams): Promise<HoldRecord> {
    const headers = await this.getSessionHeaders();

    const response = await this.payFetch(`${this.baseUrl}/api/v1/holds`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        property_id: params.propertyId,
        check_in: params.checkIn,
        check_out: params.checkOut,
        guests: params.guests,
        wallet_address: this.keypair.publicKey(),
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`hold_dates failed (${response.status}): ${errText}`);
    }

    const data = (await response.json()) as Record<string, unknown>;
    const feePaidUsdc = getPaymentRecordForResponse(response)?.amountUsdc ?? 0;

    const expiresAt = String(
      data.expires_at ??
        data.expiresAt ??
        new Date(Date.now() + 15 * 60 * 1000).toISOString()
    );
    const heldUntilFormatted =
      typeof data.held_until === 'string'
        ? data.held_until
        : formatTimeHHMM(expiresAt);

    // Only reuse a cached quote when property, dates, and pricing inputs all match
    const stayKey = this.makeStayQuoteKey(
      params.propertyId,
      params.checkIn,
      params.checkOut,
      params.guests
    );
    const cachedQuote = this.availabilityByStay.get(stayKey);
    const hold: HoldRecord = {
      holdId: String(data.hold_id ?? data.holdId ?? data.id),
      propertyId: params.propertyId,
      propertyName:
        typeof data.property_name === 'string'
          ? data.property_name
          : cachedQuote?.propertyName,
      checkIn: params.checkIn,
      checkOut: params.checkOut,
      expiresAt,
      heldUntilFormatted,
      totalUsdc:
        data.total_usdc !== undefined
          ? Number(data.total_usdc)
          : cachedQuote?.totalUsdc,
      depositUsdc:
        data.deposit_usdc !== undefined
          ? Number(data.deposit_usdc)
          : cachedQuote?.depositUsdc,
      feePaidUsdc,
    };

    this.holdsById.set(hold.holdId, hold);
    return hold;
  }

  /**
   * Free session call: release an active date hold (`/api/v1/holds/:id`).
   */
  public async releaseHold(
    params: ReleaseHoldParams
  ): Promise<ReleaseHoldResponse> {
    const headers = await this.getSessionHeaders();
    const response = await this.baseFetch(
      `${this.baseUrl}/api/v1/holds/${encodeURIComponent(params.holdId)}`,
      {
        method: 'DELETE',
        headers,
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`release_hold failed (${response.status}): ${errText}`);
    }

    this.holdsById.delete(params.holdId);
    return {
      holdId: params.holdId,
      released: true,
      status: 'released',
    };
  }

  /**
   * Paid x402 call: create booking and deploy escrow contract (`/api/v1/bookings`).
   * Enforces AGENT_MAX_DEPOSIT in code before making the paid x402 call when a quote
   * can be established, and retains/exposes the booking ID if the backend returns a
   * higher deposit than AGENT_MAX_DEPOSIT after payment.
   */
  public async createBooking(
    params: CreateBookingParams
  ): Promise<BookingRecord> {
    const stayKey = this.makeStayQuoteKey(
      params.propertyId,
      params.checkIn,
      params.checkOut,
      params.guests
    );
    let cachedQuote = this.availabilityByStay.get(stayKey);
    const rawCachedHold = params.holdId
      ? this.holdsById.get(params.holdId)
      : undefined;
    const cachedHold =
      rawCachedHold &&
      rawCachedHold.propertyId === params.propertyId &&
      rawCachedHold.checkIn === params.checkIn &&
      rawCachedHold.checkOut === params.checkOut
        ? rawCachedHold
        : undefined;

    let depositUsdc =
      params.depositUsdc ??
      cachedHold?.depositUsdc ??
      cachedQuote?.depositUsdc;

    // If no deposit quote is known yet, attempt to establish it via free checkAvailability
    // before paying the x402 booking fee.
    if (depositUsdc === undefined) {
      try {
        cachedQuote = await this.checkAvailability({
          propertyId: params.propertyId,
          checkIn: params.checkIn,
          checkOut: params.checkOut,
          guests: params.guests,
        });
        if (cachedQuote.depositUsdc > 0) {
          depositUsdc = cachedQuote.depositUsdc;
        }
      } catch {
        // Proceed when the backend does not expose availability for this flow;
        // the post-response cap check below will still enforce AGENT_MAX_DEPOSIT
        // without discarding the booking ID.
      }
    }

    // Check AGENT_MAX_DEPOSIT before paying the x402 booking fee when the deposit quote is known
    if (depositUsdc !== undefined) {
      this.ledger.verifyDepositLimit(depositUsdc);
    }

    const headers = await this.getSessionHeaders();

    const response = await this.payFetch(`${this.baseUrl}/api/v1/bookings`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        property_id: params.propertyId,
        check_in: params.checkIn,
        check_out: params.checkOut,
        guests: params.guests,
        hold_id: params.holdId,
        wallet_address: this.keypair.publicKey(),
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`create_booking failed (${response.status}): ${errText}`);
    }

    const data = (await response.json()) as Record<string, unknown>;
    const feePaidUsdc = getPaymentRecordForResponse(response)?.amountUsdc ?? 0;

    const resolvedDepositUsdc = Number(
      data.deposit_usdc ??
        data.depositUsdc ??
        data.amount ??
        depositUsdc ??
        0
    );

    const resolvedTotalUsdc = Number(
      data.total_usdc ??
        data.totalUsdc ??
        cachedHold?.totalUsdc ??
        cachedQuote?.totalUsdc ??
        resolvedDepositUsdc
    );

    const contractId = String(
      data.contract_id ?? data.contractId ?? data.escrow_contract_id ?? ''
    );
    const unsignedXdr = String(
      data.unsigned_xdr ?? data.unsignedXdr ?? data.fund_xdr ?? ''
    );
    const bookingId = String(
      data.booking_id ?? data.bookingId ?? data.id ?? ''
    );

    const booking: BookingRecord = {
      bookingId,
      propertyId: params.propertyId,
      propertyName:
        typeof data.property_name === 'string'
          ? data.property_name
          : cachedHold?.propertyName ?? cachedQuote?.propertyName,
      contractId,
      checkIn: params.checkIn,
      checkOut: params.checkOut,
      totalUsdc: resolvedTotalUsdc,
      depositUsdc: resolvedDepositUsdc,
      assetCode: 'USDC',
      assetContract:
        typeof data.asset_contract === 'string'
          ? data.asset_contract
          : getDefaultUsdcContract(this.getNetwork()),
      unsignedXdr,
      status: 'escrow_created',
      feePaidUsdc,
    };

    // Always retain the created booking before running the post-response cap check
    // so a paid booking ID is never discarded if the returned deposit exceeds AGENT_MAX_DEPOSIT.
    if (booking.bookingId) {
      this.bookingsById.set(booking.bookingId, booking);
    }

    try {
      this.ledger.verifyDepositLimit(resolvedDepositUsdc);
    } catch (err) {
      if (err instanceof SpendingLimitError && booking.bookingId) {
        throw new SpendingLimitError(
          err.code,
          `${err.message} (booking_id: ${booking.bookingId})`
        );
      }
      throw err;
    }

    return booking;
  }

  /**
   * Query the SafeTrust backend to reconcile whether a previously submitted deposit
   * transaction hash actually settled before allowing a retry.
   */
  public async reconcileBookingFunding(
    bookingId: string,
    txHash: string
  ): Promise<'funded' | 'not_funded' | 'unknown'> {
    try {
      const headers = await this.getSessionHeaders();
      const response = await this.baseFetch(
        `${this.baseUrl}/api/v1/bookings/${encodeURIComponent(bookingId)}?tx_hash=${encodeURIComponent(txHash)}`,
        {
          method: 'GET',
          headers,
        }
      );

      if (!response.ok) {
        return 'unknown';
      }

      const data = (await response.json()) as Record<string, unknown>;
      const rawStatus = String(
        data.status ?? data.funding_status ?? ''
      )
        .trim()
        .toLowerCase();

      if (rawStatus === 'funded' || rawStatus === 'confirmed') {
        const existing = this.bookingsById.get(bookingId);
        if (existing) {
          existing.status = 'funded';
        }
        return 'funded';
      }

      if (
        rawStatus === 'escrow_created' ||
        rawStatus === 'unfunded' ||
        rawStatus === 'failed' ||
        rawStatus === 'rejected'
      ) {
        return 'not_funded';
      }

      return 'unknown';
    } catch {
      return 'unknown';
    }
  }

  /**
   * Submit the signed escrow deposit XDR to the SafeTrust backend (`/api/v1/bookings/:id/fund`).
   */
  public async submitSignedDeposit(
    params: SubmitDepositParams
  ): Promise<SubmitDepositResponse> {
    const headers = await this.getSessionHeaders();
    const response = await this.baseFetch(
      `${this.baseUrl}/api/v1/bookings/${encodeURIComponent(params.bookingId)}/fund`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          booking_id: params.bookingId,
          contract_id: params.contractId,
          signed_xdr: params.signedXdr,
          tx_hash: params.txHash,
          amount_usdc: params.amountUsdc,
          network: this.getNetwork(),
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      const definitive = response.status >= 400 && response.status < 500;
      throw new DepositSubmissionError(
        `fund_deposit submission failed (${response.status}): ${errText}`,
        { definitive, statusCode: response.status }
      );
    }

    const existing = this.bookingsById.get(params.bookingId);
    if (existing) {
      existing.status = 'funded';
    }

    return {
      bookingId: params.bookingId,
      contractId: params.contractId,
      txHash: params.txHash,
      status: 'funded',
      amountUsdc: params.amountUsdc,
    };
  }
}
