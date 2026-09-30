/**
 * Stellar asset-amount utilities.
 *
 * Stellar amounts are stored as u64 stroops (1 unit = 10,000,000 stroops).
 * These helpers are shared across the escrow service layer and route handlers.
 */

export const STROOPS_PER_UNIT = 10_000_000n;
export const U64_MAX = 18_446_744_073_709_551_615n;

/**
 * Convert a positive decimal asset amount to an exact u64 stroop string.
 *
 * Returns null for:
 *   - non-numeric input
 *   - zero or negative values
 *   - sub-stroop precision (more than 7 decimal places)
 *   - values that overflow u64
 */
export function amountToStroops(amount: unknown): string | null {
  if (typeof amount !== 'string' && typeof amount !== 'number') return null;

  if (typeof amount === 'number') {
    if (!Number.isFinite(amount) || amount <= 0 || amount >= 1e21) return null;
    const fixed = amount.toFixed(7);
    if (Number(fixed) !== amount) return null;
    return amountToStroops(fixed);
  }

  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/.exec(amount);
  if (!match) return null;

  const [, whole, fraction = ''] = match;
  if (whole.length > 13) return null;
  const excessFraction = fraction.slice(7);
  if (excessFraction && !/^0+$/.test(excessFraction)) return null;

  const fractionalStroops = (fraction.slice(0, 7) + '0000000').slice(0, 7);
  const stroops = BigInt(whole) * STROOPS_PER_UNIT + BigInt(fractionalStroops);
  if (stroops === 0n || stroops > U64_MAX) return null;

  return stroops.toString();
}
