/**
 * Database-level checks for the unversioned-snapshot UPSERT
 * (`UPSERT_ESCROW_SQL`, used for Trustless Work V1 indexer snapshots, which
 * carry no ledger sequence).
 *
 * Opt-in: needs a PostgreSQL database with the safetrust migrations applied,
 * reached through the usual POSTGRES_* variables.
 *
 *   RECONCILIATION_DB_TEST=true POSTGRES_HOST=localhost POSTGRES_PORT=5433 \
 *   POSTGRES_PASSWORD=... npx jest reconciliation.repository.integration
 */
import db, { pool } from '../../services/db'
import { upsertEscrows } from '../reconciliation.repository'
import type { EscrowRecord } from '../../lib/reconciliation.types'

const describeDb = process.env.RECONCILIATION_DB_TEST === 'true' ? describe : describe.skip

const PREFIX = 'CTESTRECONCILE'
const id = (name: string) => `${PREFIX}_${name}`

function snapshot(contractId: string, overrides: Partial<EscrowRecord> = {}): EscrowRecord {
  return {
    contractId,
    status: 'funded',
    amount: 100,
    balance: 100,
    escrowType: 'single_release',
    roles: { marker: 'GHOST', approver: 'GGUEST', releaser: 'GPLATFORM' },
    ledgerSeq: null,
    ...overrides,
  }
}

async function seed(contractId: string, status: string, balance = 0, network: string | null = null) {
  await db.query(
    `INSERT INTO safetrust.trustless_work_escrows
       (contract_id, marker, approver, releaser, escrow_type, status, amount, balance, network, tenant_id)
     VALUES ($1, 'GHOST', 'GGUEST', 'GPLATFORM', 'single_release', $2, 100, $3, $4, 'safetrust')`,
    [contractId, status, balance, network]
  )
}

async function stored(contractId: string) {
  const { rows } = await db.query<{ status: string; balance: string }>(
    `SELECT status, balance::text FROM safetrust.trustless_work_escrows WHERE contract_id = $1`,
    [contractId]
  )
  return rows[0]
}

describeDb('reconciliation UPSERT for unversioned snapshots (database)', () => {
  const cleanup = () =>
    db.query(`DELETE FROM safetrust.trustless_work_escrows WHERE contract_id LIKE $1`, [`${PREFIX}%`])

  beforeEach(async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    await cleanup()
  })

  afterAll(async () => {
    await cleanup()
    await pool.end()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('records funding: a stored created escrow accepts a funded snapshot', async () => {
    await seed(id('FUND'), 'created')

    const result = await upsertEscrows([snapshot(id('FUND'))])

    expect(result.updated).toBe(1)
    expect(await stored(id('FUND'))).toEqual({ status: 'funded', balance: '100.0000000' })
  })

  it('does not create a row from a confirmed-status snapshot', async () => {
    const result = await upsertEscrows([snapshot(id('NEW_FUNDED'))])

    expect(result).toMatchObject({ updated: 0 })
    expect(await stored(id('NEW_FUNDED'))).toBeUndefined()
  })

  it('still creates a row from a pending snapshot', async () => {
    await upsertEscrows([snapshot(id('NEW_CREATED'), { status: 'created', balance: 0 })])

    expect(await stored(id('NEW_CREATED'))).toEqual({ status: 'created', balance: '0.0000000' })
  })

  it('keeps rejecting updates to confirmed records', async () => {
    await seed(id('CONFIRMED'), 'funded', 100)

    const result = await upsertEscrows([snapshot(id('CONFIRMED'), { status: 'completed', balance: 0 })])

    expect(result.updated).toBe(0)
    expect(await stored(id('CONFIRMED'))).toEqual({ status: 'funded', balance: '100.0000000' })
  })

  it('keeps the transition guard: created cannot jump to completed', async () => {
    await seed(id('JUMP'), 'created')

    await upsertEscrows([snapshot(id('JUMP'), { status: 'completed' })])

    expect((await stored(id('JUMP'))).status).toBe('created')
  })

  it('never zeroes a stored nonzero balance', async () => {
    await seed(id('BALANCE'), 'created', 50)

    await upsertEscrows([snapshot(id('BALANCE'), { balance: 0 })])

    expect(await stored(id('BALANCE'))).toEqual({ status: 'funded', balance: '50.0000000' })
  })

  it('keeps the network guard', async () => {
    await seed(id('NETWORK'), 'created', 0, 'testnet')

    await upsertEscrows([snapshot(id('NETWORK'), { network: 'mainnet' })])

    expect((await stored(id('NETWORK'))).status).toBe('created')
  })
})
