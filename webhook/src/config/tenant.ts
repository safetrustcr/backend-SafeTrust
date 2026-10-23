/**
 * Tenant that owns records created from signed, server-to-server webhooks
 * (e.g. Trustless Work escrow events). These requests carry no user session,
 * so their tenant cannot come from `req.context`; it is a deployment setting.
 */
export const DEFAULT_TENANT_ID = 'safetrust'

export function getPlatformTenantId(): string {
  return process.env.PLATFORM_TENANT_ID?.trim() || DEFAULT_TENANT_ID
}
