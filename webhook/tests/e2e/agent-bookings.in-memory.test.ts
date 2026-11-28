/**
 * In-process (mocked database) walkthrough of the agent booking lifecycle from
 * issue #778: create booking -> sign the fund XDR -> submit -> poller marks the
 * reservation funded.
 *
 * Every database call is served from the in-memory maps below, so this runs
 * fast and deterministically in CI. It does NOT talk to Stellar testnet; the
 * live testnet flow lives in `agent-bookings.testnet.test.ts`.
 */
import express from 'express'
import request from 'supertest'

const mockDbState = {
  apartments: new Map<string, any>(),
  bookingHolds: new Map<string, any>(),
  reservations: new Map<string, any>(),
  escrows: new Map<string, any>(),
  escrowTransactions: new Map<string, any>(),
  userWallets: new Map<string, any>(),
  x402Settlements: new Map<string, any>(),
}

jest.mock('../../src/services/db', () => ({
  __esModule: true,
  default: {
    query: jest.fn(async (sql: string, params?: any[]) => {
      const lower = sql.toLowerCase()

      // 0. x402 settlement receipts (idempotent fee settlement)
      if (lower.includes('safetrust.x402_settlements')) {
        const key = params?.[0]
        if (lower.startsWith('insert') && key) {
          mockDbState.x402Settlements.set(key, {
            status: 'pending',
            tx_hash: null,
            reservation_id: null,
            updated_at: new Date(),
          })
          return {
            rowCount: 1,
            rows: [{ id: 'settlement-seeded-1', claim_token: 'claim-seeded-1' }],
          }
        }
        if (lower.startsWith('update')) {
          const record = key ? mockDbState.x402Settlements.get(key) : undefined
          if (!record) return { rowCount: 0, rows: [] }
          // Binding the receipt to its reservation is a separate write: it must
          // leave the receipt's status and transaction hash untouched.
          if (lower.includes('set reservation_id')) {
            if (record.status !== 'settled' || record.reservation_id) {
              return { rowCount: 0, rows: [] }
            }
            record.reservation_id = params?.[1] ?? null
            return { rowCount: 1, rows: [] }
          }
          if (lower.includes("status = 'settled'")) {
            record.status = 'settled'
            record.tx_hash = params?.[1] ?? null
          }
          return { rowCount: 1, rows: [] }
        }
        const record = key ? mockDbState.x402Settlements.get(key) : undefined
        return { rows: record ? [record] : [] }
      }

      // 1. Apartment lookup
      if (lower.includes('from safetrust.apartments') && params) {
        const apt = mockDbState.apartments.get(params[0])
        return { rows: apt ? [apt] : [] }
      }

      // 2. User wallet lookup
      if (lower.includes('from safetrust.user_wallets') && params) {
        const wallet = mockDbState.userWallets.get(params[0])
        return { rows: wallet ? [wallet] : [] }
      }

      // 3. Insert trustless_work_escrows
      if (lower.includes('insert into safetrust.trustless_work_escrows') && params) {
        const escrow = {
          id: 'escrow-seeded-e2e-1',
          contract_id: params[0],
          marker: params[1],
          approver: params[2],
          releaser: params[3],
          amount: params[5],
          balance: 0,
          status: 'created',
          apartment_id: params[6],
          guest_id: params[7],
          tenant_id: params[8],
        }
        mockDbState.escrows.set(escrow.contract_id, escrow)
        mockDbState.escrows.set(escrow.id, escrow)
        return { rows: [escrow] }
      }

      // 4. Update reservation with escrow_id
      if (lower.includes('update safetrust.reservations') && lower.includes('set escrow_id') && params) {
        const res = mockDbState.reservations.get(params[1])
        if (res) {
          res.escrow_id = params[0]
          res.status = 'escrow_created'
        }
        return { rowCount: 1, rows: [] }
      }

      // 5. Insert escrow_transactions
      if (lower.includes('insert into safetrust.escrow_transactions') && params) {
        const tx = {
          contract_id: params[0],
          engagement_id: params[1],
          property_id: params[2],
          sender_address: params[3],
          receiver_address: params[4],
          amount: params[5],
          status: 'pending_signature',
          unsigned_xdr: params[6],
        }
        mockDbState.escrowTransactions.set(tx.contract_id, tx)
        return { rowCount: 1, rows: [tx] }
      }

      // 6. Reservation lookup for submit
      if (lower.includes('from safetrust.reservations r') && params) {
        const res = mockDbState.reservations.get(params[0])
        if (!res) return { rows: [] }
        const escrow = mockDbState.escrows.get(res.escrow_id)
        return {
          rows: [
            {
              id: res.id,
              guest_id: res.guest_id,
              apartment_id: res.apartment_id,
              status: res.status,
              escrow_id: res.escrow_id,
              contract_id: escrow?.contract_id ?? null,
            },
          ],
        }
      }

      // 7. Mirror reservation status to funded (reconciliation poller)
      if (lower.includes('update safetrust.reservations') && lower.includes("set\n          status = $1") && params) {
        for (const res of mockDbState.reservations.values()) {
          if (res.escrow_id === params[1]) {
            res.status = params[0]
          }
        }
        return { rowCount: 1, rows: [] }
      }

      // 8. Unexpected reservation update — fail fast so new writes must be handled explicitly
      if (lower.includes('update safetrust.reservations')) {
        throw new Error(
          `Unexpected safetrust.reservations update in e2e mock: ${sql} | params=${JSON.stringify(params)}`,
        )
      }

      return { rows: [] }
    }),
  },
  query: jest.fn(async (sql: string, params?: any[]) => {
    return (require('../../src/services/db').default.query)(sql, params)
  }),
  withTransaction: jest.fn(async (cb: (client: any) => Promise<any>) => {
    const mockClient = {
      query: jest.fn(async (sql: string, params?: any[]) => {
        const lower = sql.toLowerCase()
        if (lower.includes('select 1 from safetrust.booking_holds')) {
          return { rows: [] }
        }
        if (lower.includes('select 1 from safetrust.reservations')) {
          return { rows: [] }
        }
        // The settled payment proof is bound to the reservation inside the
        // reservation's transaction.
        if (lower.includes('set reservation_id')) {
          const key = params?.[0]
          const record = key ? mockDbState.x402Settlements.get(key) : undefined
          if (record && record.status === 'settled' && !record.reservation_id) {
            record.reservation_id = params?.[1] ?? null
            return { rowCount: 1, rows: [] }
          }
          return { rowCount: 0, rows: [] }
        }
        if (lower.includes('insert into safetrust.reservations') && params) {
          const res = {
            id: 'res-seeded-e2e-1',
            apartment_id: params[0],
            guest_id: params[1],
            check_in_date: params[2],
            check_out_date: params[3],
            total_amount: params[4],
            asset_code: params[5],
            status: 'escrow_created',
            tenant_id: params[6],
            escrow_id: null,
          }
          mockDbState.reservations.set(res.id, res)
          return { rows: [res] }
        }
        return { rows: [] }
      }),
    }
    return cb(mockClient)
  }),
}))

const mockProcessHelperSubmission = jest.fn()
jest.mock('../../src/services/confirmation.service', () => ({
  ...jest.requireActual('../../src/services/confirmation.service'),
  processHelperSubmission: (params: any) => mockProcessHelperSubmission(params),
}))

import bookingsRouter from '../../src/routes/v1/bookings'
import { mirrorReservationStatus } from '../../src/repositories/reservation.repository'
import { setX402Engine } from '../../src/middleware/x402-payment.middleware'
import { errorHandler } from '../../src/middleware/error-handler'

const SEEDED_APT_ID = '99999999-9999-4999-8999-999999999999'
const SEEDED_HOST_ID = 'host-seeded-stellar-1'
const SEEDED_AGENT_ID = 'agent-seeded-stellar-2'
const SEEDED_AGENT_WALLET = 'GAATN5DTESTAGENTWALLETAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA2'
const SEEDED_HOST_WALLET = 'GBATN5DTESTHOSTWALLETAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA2'

function app() {
  const a = express()
  a.use(express.json())
  a.use((req, _res, next) => {
    ;(req as any).context = {
      uid: SEEDED_AGENT_ID,
      tenantId: 'safetrust',
      roles: ['guest'],
    }
    next()
  })
  a.use('/api/v1/bookings', bookingsRouter)
  a.use(errorHandler)
  return a
}

describe('Agent bookings flow with an in-memory database (Issue #778)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockDbState.apartments.clear()
    mockDbState.reservations.clear()
    mockDbState.escrows.clear()
    mockDbState.escrowTransactions.clear()
    mockDbState.userWallets.clear()
    mockDbState.x402Settlements.clear()

    // 1. Seed apartment in safetrust.apartments
    mockDbState.apartments.set(SEEDED_APT_ID, {
      id: SEEDED_APT_ID,
      name: 'Testnet Ocean Villa',
      price: '150.00',
      warranty_deposit: '75.00',
      owner_id: SEEDED_HOST_ID,
      is_available: true,
      bedrooms: 2,
    })

    // 2. Seed host and agent wallets in safetrust.user_wallets
    mockDbState.userWallets.set(SEEDED_AGENT_ID, {
      wallet_address: SEEDED_AGENT_WALLET,
      is_primary: true,
    })
    mockDbState.userWallets.set(SEEDED_HOST_ID, {
      wallet_address: SEEDED_HOST_WALLET,
      is_primary: true,
    })

    process.env.X402_ENABLED = 'true'
    process.env.STELLAR_NETWORK = 'testnet'
    process.env.SAFETRUST_PLATFORM_WALLET = 'GD5JPEHGGTDTK2N7OMDDCOW3DPO5KSFWACYWNYZNNOXD2UC7LQ4DHXMM'

    setX402Engine({
      validateX402Payment: () =>
        JSON.stringify({
          is_valid: true,
          payer_address: SEEDED_AGENT_WALLET,
          amount_usdc: 0.10,
          network: 'stellar:testnet',
        }),
      settleX402Payment: async () => ({
        settled: true,
        transaction_hash: 'settlement-e2e-tx-hash',
        network: 'stellar:testnet',
        error: null,
      }),
      buildPaymentRequirement: (amount: number) =>
        JSON.stringify({ maxAmountRequired: amount, network: 'stellar:testnet' }),
    })
  })

  it('runs complete end-to-end lifecycle: book apartment -> sign XDR -> submit -> poller confirms funded', async () => {
    // ── Phase 1: Create Booking with x402 $0.10 fee ──────────────────────────
    const bookingRes = await request(app())
      .post('/api/v1/bookings')
      .set('x-payment', 'x402-valid-session-proof-0.10-usdc')
      .send({
        property_id: SEEDED_APT_ID,
        check_in: '2026-12-15',
        check_out: '2026-12-20',
        guests: 2,
      })
    expect(bookingRes.status).toBe(201)
    expect(bookingRes.body).toMatchObject({
      reservation_id: 'res-seeded-e2e-1',
      contract_id: expect.stringMatching(/^C[A-Z0-9]{55}$/),
      deposit: '75.00',
      asset: 'USDC',
      unsigned_xdr: expect.any(String),
    })

    const { reservation_id, contract_id, unsigned_xdr } = bookingRes.body
    const createdReservation = mockDbState.reservations.get(reservation_id)
    expect(createdReservation.status).toBe('escrow_created')

    // The $0.10 proof is recorded as paid for this reservation, and the binding
    // leaves the settlement receipt's transaction hash intact.
    const settlementKey = [...mockDbState.x402Settlements.keys()][0]
    const receipt = mockDbState.x402Settlements.get(settlementKey)
    expect(receipt).toMatchObject({
      status: 'settled',
      reservation_id,
      tx_hash: 'settlement-e2e-tx-hash',
    })

    // ── Phase 2: Autonomous Agent signs fund_escrow XDR with test wallet ─────
    // Simulate Freighter / agent wallet cryptographic signature over unsigned_xdr
    const signedXdr = `AAAA_SIGNED_BY_${SEEDED_AGENT_WALLET}_${Buffer.from(unsigned_xdr).toString('base64').slice(0, 32)}`

    // ── Phase 3: Submit signed XDR via POST /api/v1/bookings/:id/submit ───────
    mockProcessHelperSubmission.mockResolvedValueOnce({
      success: true,
      stage: 'confirmed',
      txHash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      escrowId: contract_id,
      action: 'fund',
      network: 'testnet',
    })

    const submitRes = await request(app())
      .post(`/api/v1/bookings/${reservation_id}/submit`)
      .send({ signed_xdr: signedXdr })

    expect(submitRes.status).toBe(200)
    expect(submitRes.body).toEqual({
      success: true,
      reservation_id,
      contract_id,
      tx_hash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      status: 'escrow_created', // Invariant: submit MUST NOT transition to 'funded'
    })

    // Reservation in DB remains in escrow_created immediately after submit
    expect(mockDbState.reservations.get(reservation_id).status).toBe('escrow_created')

    // ── Phase 4: Issue 03 On-Chain Balance Poller Authoritatively Reconciles ─
    // The reconciliation poller observes the on-chain deposit on Stellar and mirrors to reservations
    const escrowDbRecord = mockDbState.escrows.get(contract_id)
    expect(escrowDbRecord).toBeDefined()

    // Trigger reconciliation poller mirroring (reconciliation.service / mirrorReservationStatus)
    const dbClient = {
      query: (sql: string, params?: any[]) =>
        (require('../../src/services/db').default.query)(sql, params),
    }
    await mirrorReservationStatus(escrowDbRecord.id, 'funded', 'safetrust', dbClient as any)

    // Authoritative verification: reservation reaches 'funded' exclusively through reconciliation
    const finalReservation = mockDbState.reservations.get(reservation_id)
    expect(finalReservation.status).toBe('funded')
  })
})
