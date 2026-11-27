/**
 * Live Stellar testnet end-to-end test for agent bookings (issue #778).
 *
 * Unlike `agent-bookings.in-memory.test.ts`, nothing here is mocked: it books a
 * seeded apartment through the real webhook, signs the issued fund XDR with a
 * real test wallet, submits the signed transaction, and waits for the on-chain
 * balance poller to mark the reservation `funded`.
 *
 * It moves real testnet USDC, so it is skipped unless explicitly enabled:
 *
 *   RUN_TESTNET_E2E=1 \
 *   TESTNET_WEBHOOK_URL=https://<deployed-webhook> \
 *   TESTNET_FIREBASE_TOKEN=<guest session idToken> \
 *   TESTNET_APARTMENT_ID=<seeded apartment uuid> \
 *   TESTNET_AGENT_SECRET=<S... funded test-wallet secret> \
 *   TESTNET_X402_PAYMENT=<signed x402 $0.10 payment payload> \
 *   npx jest --runInBand tests/e2e/agent-bookings.testnet.test.ts
 *
 * Optional: TESTNET_CHECK_IN / TESTNET_CHECK_OUT (YYYY-MM-DD) and
 * TESTNET_POLL_TIMEOUT_MS (default 180000).
 */
import { Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk'

const RUN = process.env.RUN_TESTNET_E2E === '1'
const describeTestnet = RUN ? describe : describe.skip

const WEBHOOK_URL = (process.env.TESTNET_WEBHOOK_URL ?? '').replace(/\/+$/, '')
const FIREBASE_TOKEN = process.env.TESTNET_FIREBASE_TOKEN ?? ''
const APARTMENT_ID = process.env.TESTNET_APARTMENT_ID ?? ''
const AGENT_SECRET = process.env.TESTNET_AGENT_SECRET ?? ''
const X402_PAYMENT = process.env.TESTNET_X402_PAYMENT ?? ''
const POLL_TIMEOUT_MS = Number(process.env.TESTNET_POLL_TIMEOUT_MS ?? 180_000)

function isoDate(daysFromNow: number): string {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + daysFromNow)
  return date.toISOString().slice(0, 10)
}

const CHECK_IN = process.env.TESTNET_CHECK_IN ?? isoDate(30)
const CHECK_OUT = process.env.TESTNET_CHECK_OUT ?? isoDate(33)

async function call(
  path: string,
  init: { method: string; body?: unknown; payment?: boolean }
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${FIREBASE_TOKEN}`,
    'content-type': 'application/json',
  }
  if (init.payment) headers['x-payment'] = X402_PAYMENT

  const response = await fetch(`${WEBHOOK_URL}${path}`, {
    method: init.method,
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  const text = await response.text()
  let body: any = text
  try {
    body = text ? JSON.parse(text) : {}
  } catch {
    // Leave the raw body for the assertion message.
  }
  return { status: response.status, body }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describeTestnet('Agent booking end-to-end on Stellar testnet (Issue #778)', () => {
  jest.setTimeout(POLL_TIMEOUT_MS + 60_000)

  beforeAll(() => {
    const missing = [
      ['TESTNET_WEBHOOK_URL', WEBHOOK_URL],
      ['TESTNET_FIREBASE_TOKEN', FIREBASE_TOKEN],
      ['TESTNET_APARTMENT_ID', APARTMENT_ID],
      ['TESTNET_AGENT_SECRET', AGENT_SECRET],
      ['TESTNET_X402_PAYMENT', X402_PAYMENT],
    ].filter(([, value]) => !value)
    if (missing.length > 0) {
      throw new Error(
        `RUN_TESTNET_E2E=1 requires: ${missing.map(([name]) => name).join(', ')}`
      )
    }
  })

  it('books a seeded apartment, funds the escrow and reaches funded', async () => {
    const agent = Keypair.fromSecret(AGENT_SECRET)

    // ── 1. Book the seeded apartment, paying the $0.10 fee through x402 ──────
    const booking = await call('/api/v1/bookings', {
      method: 'POST',
      payment: true,
      body: {
        property_id: APARTMENT_ID,
        check_in: CHECK_IN,
        check_out: CHECK_OUT,
        guests: 2,
      },
    })
    expect(booking.status).toBe(201)
    expect(booking.body.unsigned_xdr).toEqual(expect.any(String))
    expect(booking.body.reservation_id).toEqual(expect.any(String))
    expect(booking.body.contract_id).toMatch(/^C[A-Z2-7]{55}$/)

    const { reservation_id: reservationId, contract_id: contractId, unsigned_xdr: unsignedXdr } =
      booking.body

    // ── 2. Sign the fund XDR with the agent's test wallet ────────────────────
    const transaction = TransactionBuilder.fromXDR(unsignedXdr, Networks.TESTNET)
    transaction.sign(agent)
    const signedXdr = transaction.toXDR()

    // ── 3. Submit the signed transaction ─────────────────────────────────────
    const submit = await call(`/api/v1/bookings/${reservationId}/submit`, {
      method: 'POST',
      body: { signed_xdr: signedXdr },
    })
    expect([200, 202]).toContain(submit.status)
    if (submit.status === 200) {
      // Funds have moved but the poller, not the submit call, owns the status.
      expect(submit.body.status).toBe('escrow_created')
    }

    // ── 4. Wait for the on-chain poller to observe the deposit ───────────────
    const deadline = Date.now() + POLL_TIMEOUT_MS
    let status = ''
    let lastBody: unknown = null
    while (Date.now() < deadline) {
      const current = await call(`/api/reservations/${reservationId}`, { method: 'GET' })
      lastBody = current.body
      if (current.status === 200) {
        status = String(current.body.status ?? '')
        if (current.body.contract_id && current.body.contract_id !== contractId) {
          throw new Error(
            `Reservation ${reservationId} reports contract ${current.body.contract_id}, expected ${contractId}`
          )
        }
        if (status === 'funded') break
      }
      await sleep(5_000)
    }

    expect({ status, lastBody }).toMatchObject({ status: 'funded' })
  })
})
