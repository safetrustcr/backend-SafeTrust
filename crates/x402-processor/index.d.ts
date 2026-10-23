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

export function validateX402Payment(
  header: string,
  requiredAmount: number
): string

export function buildPaymentRequirement(
  amountUsdc: number,
  network: string,
  facilitatorUrl: string,
  payTo: string
): string
