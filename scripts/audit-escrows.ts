/**
 * @file scripts/audit-escrows.ts
 * @description Repeatable escrow audit script for SafeTrust.
 *              Audits existing escrows against linked reservations, role wallets,
 *              amounts in stroops, assets, and records verification audit events.
 *
 * Usage:
 *   npx ts-node scripts/audit-escrows.ts
 */

import { Pool } from 'pg'
import { verifyEscrowForReservation } from '../webhook/src/services/escrow-verification'
import { amountToStroops } from '../webhook/src/lib/stellar-amounts'
import { getStellarConfig } from '../webhook/src/config/stellar'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/safetrust',
})

export interface AuditReport {
  totalAudited: number
  valid: number
  mismatched: number
  unlinked: number
  details: Array<{
    contractId: string
    reservationId?: string
    status: string
    valid: boolean
    mismatches: string[]
  }>
}

export async function runEscrowAudit(): Promise<AuditReport> {
  const client = await pool.connect()
  const report: AuditReport = {
    totalAudited: 0,
    valid: 0,
    mismatched: 0,
    unlinked: 0,
    details: [],
  }

  try {
    const config = getStellarConfig()
    console.log(`[audit-escrows] Starting audit on network: ${config.network}`)

    const escrowsRes = await client.query<{
      id: string
      contract_id: string
      status: string
      amount: number | string
      balance: number | string
      marker: string
      approver: string
      releaser: string
      resolver: string | null
      reservation_id: string | null
      guest_id: string | null
      total_amount: number | string | null
      reservation_status: string | null
      guest_wallet: string | null
      host_wallet: string | null
    }>(`
      SELECT
        e.id,
        e.contract_id,
        e.status,
        e.amount,
        e.balance,
        e.marker,
        e.approver,
        e.releaser,
        e.resolver,
        e.asset_code,
        e.asset_issuer,
        e.token_contract_id,
        r.id AS reservation_id,
        r.guest_id,
        r.total_amount,
        r.status AS reservation_status,
        gw.wallet_address AS guest_wallet,
        hw.wallet_address AS host_wallet
      FROM safetrust.trustless_work_escrows e
      LEFT JOIN safetrust.reservations r ON r.escrow_id = e.id
      LEFT JOIN safetrust.apartments a ON a.id = r.apartment_id
      LEFT JOIN safetrust.user_wallets gw
        ON gw.user_id = r.guest_id
        AND gw.chain_type = 'STELLAR'
        AND gw.is_primary = true
      LEFT JOIN safetrust.user_wallets hw
        ON hw.user_id = a.owner_id
        AND hw.chain_type = 'STELLAR'
        AND hw.is_primary = true
      ORDER BY e.created_at DESC
    `)

    report.totalAudited = escrowsRes.rows.length
    console.log(`[audit-escrows] Found ${report.totalAudited} escrows to audit.`)

    for (const row of escrowsRes.rows) {
      if (!row.reservation_id) {
        report.unlinked++
        report.details.push({
          contractId: row.contract_id,
          status: row.status,
          valid: false,
          mismatches: ['Escrow is not linked to any booking reservation'],
        })
        continue
      }

      const verification = verifyEscrowForReservation(
        {
          id: row.id,
          contract_id: row.contract_id,
          amount: row.amount,
          marker: row.marker,
          approver: row.approver,
          releaser: row.releaser,
          resolver: row.resolver,
          asset_code: row.asset_code,
          asset_issuer: row.asset_issuer,
          token_contract_id: row.token_contract_id,
          engagementId: row.reservation_id,
        },
        {
          id: row.reservation_id,
          status: row.reservation_status ?? 'unknown',
          total_amount: row.total_amount ?? 0,
          guest_id: row.guest_id ?? '',
          guest_wallet: row.guest_wallet,
          host_wallet: row.host_wallet,
        },
        {
          phase: 'audit',
        }
      )

      if (verification.valid) {
        report.valid++
        report.details.push({
          contractId: row.contract_id,
          reservationId: row.reservation_id,
          status: row.status,
          valid: true,
          mismatches: [],
        })
      } else {
        report.mismatched++
        report.details.push({
          contractId: row.contract_id,
          reservationId: row.reservation_id,
          status: row.status,
          valid: false,
          mismatches: verification.mismatches,
        })

        // Record in audit table
        try {
          await client.query(
            `INSERT INTO safetrust.escrow_verification_events (
              escrow_id, reservation_id, contract_id, result, mismatches, tenant_id
            ) VALUES ($1, $2, $3, $4, $5, 'safetrust')`,
            [
              row.id,
              row.reservation_id,
              row.contract_id,
              'mismatch',
              JSON.stringify(verification.mismatches),
            ]
          )
        } catch {
          // Continue if table not initialized
        }
      }
    }

    console.log('[audit-escrows] Audit Complete Summary:')
    console.log(`  Total: ${report.totalAudited}`)
    console.log(`  Valid: ${report.valid}`)
    console.log(`  Mismatched: ${report.mismatched}`)
    console.log(`  Unlinked: ${report.unlinked}`)

    return report
  } finally {
    client.release()
  }
}

if (require.main === module) {
  runEscrowAudit()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[audit-escrows] Fatal error:', err)
      process.exit(1)
    })
}
