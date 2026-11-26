export interface PropertyQuote {
  nights: number
  nightlyPrice: string
  total: string
  deposit: string
}

function amountToCents(value: string | number): bigint {
  const text = String(value).trim()
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text)
  if (!match) throw new RangeError('Price must be a non-negative amount with at most two decimals')
  return BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0') || '0')
}

function formatCents(value: bigint): string {
  return `${value / 100n}.${String(value % 100n).padStart(2, '0')}`
}

function dateToUtcDay(value: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) throw new RangeError('Dates must use YYYY-MM-DD format')

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const timestamp = Date.UTC(year, month - 1, day)
  const parsed = new Date(timestamp)
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new RangeError('Dates must be valid calendar dates')
  }
  return timestamp
}

export function calculatePropertyQuote(input: {
  nightlyPrice: string | number
  warrantyDeposit: string | number
  checkIn: string
  checkOut: string
}): PropertyQuote {
  const checkIn = dateToUtcDay(input.checkIn)
  const checkOut = dateToUtcDay(input.checkOut)
  if (checkOut <= checkIn) throw new RangeError('Check-out must be after check-in')

  const nights = (checkOut - checkIn) / 86_400_000
  const nightlyPriceCents = amountToCents(input.nightlyPrice)
  const depositCents = amountToCents(input.warrantyDeposit)

  return {
    nights,
    nightlyPrice: formatCents(nightlyPriceCents),
    total: formatCents(nightlyPriceCents * BigInt(nights)),
    deposit: formatCents(depositCents),
  }
}
