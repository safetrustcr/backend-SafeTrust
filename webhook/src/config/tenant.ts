/**
 * Tenant configuration.
 *
 * The platform tenant owns two kinds of writes:
 *   - records created from signed, server-to-server Trustless Work webhooks,
 *     which carry no end-user session and so cannot read `req.context`;
 *   - sessions whose verified token carries no tenant claim.
 *
 * It is a deployment setting, not a value taken from a request.
 */
export const DEFAULT_PLATFORM_TENANT_ID = 'safetrust'

export function getPlatformTenantId(): string {
  const configured = process.env.PLATFORM_TENANT_ID?.trim()
  return configured || DEFAULT_PLATFORM_TENANT_ID
}
