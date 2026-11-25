export interface AssetInfo {
  code: 'USDC'
  contract: string
  issuer: string
}

export interface PaymentRequirement {
  scheme: 'exact'
  network: string
  max_amount_usdc: number
  asset: AssetInfo
  facilitator_url: string
  pay_to: string
  description: string
}

export interface X402ValidationResult {
  is_valid: boolean
  payer_address?: string | null
  amount_usdc: number
  network: string
  invalid_reason?: string | null
}

export interface X402SettlementResult {
  settled: boolean
  transaction_hash?: string | null
  network: string
  error?: string | null
}

export function validateX402Payment(
  header: string,
  requiredAmount: number
): string

/**
 * Verify and settle an X-Payment header. The facilitator round-trip runs off
 * the main JS thread, so this returns a promise that resolves once settlement
 * is confirmed (or resolves with `settled: false` when it is declined).
 */
export function settleX402Payment(
  header: string,
  requiredAmount: number
): Promise<X402SettlementResult>

export function buildPaymentRequirement(
  amountUsdc: number,
  network: string,
  facilitatorUrl: string,
  payTo: string
): string
