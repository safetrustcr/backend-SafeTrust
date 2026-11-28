import { PoolClient } from 'pg'
import { pool } from '../../services/db'
import {
  cancelUnfundedReservationsForExpiredHolds,
  convertHoldToReservation,
  expireHolds,
  setEscrowFundingChecker,
} from '../hold.repository'

describe('hold.repository - convertHoldToReservation', () => {
  let client: {
    query: jest.Mock
    release: jest.Mock
  }

  const activeHold = {
    id: 'hold-1',
    tenant_id: 'safetrust',
    apartment_id: 'apt-1',
    user_id: 'user-1',
    check_in: new Date('2026-12-15'),
    check_out: new Date('2026-12-20'),
    status: 'active',
    quote_total: '150.00',
    quote_deposit: '45.00',
    asset_code: 'USDC',
    expires_at: new Date('2026-12-01'),
    reservation_id: null,
    reservation_status: null,
    is_expired: false,
  }

  beforeEach(() => {
    jest.clearAllMocks()

    client = {
      query: jest.fn(),
      release: jest.fn(),
    }

    const connectSpy = jest.spyOn(pool, 'connect') as jest.Mock
    connectSpy.mockImplementation(() =>
      Promise.resolve(client as unknown as PoolClient)
    )
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('converts an active hold and commits the transaction', async () => {
    client.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [activeHold] })
      .mockResolvedValueOnce({ rows: [{ id: 'reservation-1' }] })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({})

    const result = await convertHoldToReservation(
      'hold-1',
      'user-1',
      'safetrust'
    )

    expect(result).toMatchObject({
      reservation_id: 'reservation-1',
      booking_hold_id: 'hold-1',
      guest_id: 'user-1',
      total_amount: '150.00',
      quote_deposit: '45.00',
      asset_code: 'USDC',
      status: 'pending',
    })

    expect(client.query).toHaveBeenCalledWith('BEGIN')
    expect(client.query).toHaveBeenCalledWith('COMMIT')
    expect(client.query.mock.calls[2][0]).toContain(
      'INSERT INTO safetrust.reservations'
    )
    expect(client.query.mock.calls[3][0]).toContain(
      "SET status = 'converted'"
    )
    expect(client.release).toHaveBeenCalledTimes(1)
  })

  it('returns the existing reservation for a converted hold', async () => {
    client.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        rows: [{
          ...activeHold,
          status: 'converted',
          reservation_id: 'reservation-existing',
          reservation_status: 'escrow_created',
        }],
      })
      .mockResolvedValueOnce({})

    const result = await convertHoldToReservation(
      'hold-1',
      'user-1',
      'safetrust'
    )

    expect(result.reservation_id).toBe('reservation-existing')
    expect(result.status).toBe('escrow_created')
    expect(client.query).toHaveBeenCalledWith('COMMIT')
    expect(client.query).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO safetrust.reservations'),
      expect.anything()
    )
  })

  it('rejects a hold belonging to another user', async () => {
    client.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        rows: [{ ...activeHold, user_id: 'another-user' }],
      })
      .mockResolvedValueOnce({})

    await expect(
      convertHoldToReservation('hold-1', 'user-1', 'safetrust')
    ).rejects.toThrow('Not your hold')

    expect(client.query).toHaveBeenCalledWith('ROLLBACK')
    expect(client.query).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO safetrust.reservations'),
      expect.anything()
    )
  })

  it('rejects an expired hold', async () => {
    client.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        rows: [{ ...activeHold, is_expired: true }],
      })
      .mockResolvedValueOnce({})

    await expect(
      convertHoldToReservation('hold-1', 'user-1', 'safetrust')
    ).rejects.toThrow('Hold has expired')

    expect(client.query).toHaveBeenCalledWith('ROLLBACK')
  })

  it('rolls back when reservation insertion fails', async () => {
    client.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [activeHold] })
      .mockRejectedValueOnce(new Error('Reservation insert failed'))
      .mockResolvedValueOnce({})

    await expect(
      convertHoldToReservation('hold-1', 'user-1', 'safetrust')
    ).rejects.toThrow('Reservation insert failed')

    expect(client.query).toHaveBeenCalledWith('ROLLBACK')
    expect(client.query).not.toHaveBeenCalledWith('COMMIT')
    expect(client.release).toHaveBeenCalledTimes(1)
  })
})

describe('hold.repository - cancelUnfundedReservationsForExpiredHolds', () => {
  const escrowCreatedCandidate = {
    reservation_id: 'reservation-1',
    contract_id: 'CTESTCONTRACT0000000000000000000000000000000000000000001',
    network: 'testnet',
    escrow_status: 'created',
  }

  const lockedReservationRow = {
    reservation_id: 'reservation-1',
    reservation_status: 'escrow_created',
    escrow_id: 'escrow-1',
  }

  const lockedEscrowRow = {
    contract_id: escrowCreatedCandidate.contract_id,
    network: 'testnet',
    status: 'created',
  }

  let querySpy: jest.Mock
  let connectSpy: jest.Mock
  let client: { query: jest.Mock; release: jest.Mock }

  beforeEach(() => {
    querySpy = jest.spyOn(pool, 'query') as unknown as jest.Mock
    querySpy.mockResolvedValue({ rowCount: 1, rows: [escrowCreatedCandidate] })

    client = { query: jest.fn(), release: jest.fn() }
    connectSpy = jest.spyOn(pool, 'connect') as unknown as jest.Mock
    connectSpy.mockImplementation(() =>
      Promise.resolve(client as unknown as PoolClient)
    )
  })

  afterEach(() => {
    setEscrowFundingChecker(null)
    jest.restoreAllMocks()
  })

  /** No cancellation UPDATE was issued on the locked transaction. */
  function noCancelUpdate(target: { query: jest.Mock }): boolean {
    return !target.query.mock.calls.some(([sql]) =>
      String(sql).includes("SET status = 'cancelled'")
    )
  }

  /** Queue the locked-transaction answers in call order. */
  function queueLockedPath({
    reservationRows = [lockedReservationRow],
    escrowRows = [lockedEscrowRow],
    updatedRowCount = 1,
  }: {
    reservationRows?: unknown[]
    escrowRows?: unknown[]
    updatedRowCount?: number
  } = {}) {
    client.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: reservationRows }) // lock reservation
      .mockResolvedValueOnce({ rows: escrowRows }) // lock escrow
      .mockResolvedValueOnce({ rowCount: updatedRowCount, rows: [] }) // UPDATE
      .mockResolvedValueOnce({}) // COMMIT
  }

  it('cancels an unfunded escrow_created reservation as soon as its hold expires', async () => {
    const checker = jest.fn().mockResolvedValue('unfunded')
    setEscrowFundingChecker(checker)
    queueLockedPath()

    const cancelled = await cancelUnfundedReservationsForExpiredHolds()

    expect(cancelled).toBe(1)
    expect(checker).toHaveBeenCalledWith({
      contractId: escrowCreatedCandidate.contract_id,
      network: 'testnet',
    })

    const [candidateSql] = querySpy.mock.calls[0] as [string, unknown[]]
    expect(candidateSql).toContain("r.status = 'escrow_created'")
    expect(candidateSql).toContain('h.expires_at <= NOW()')
    // No grace delay: an expired hold's unfunded reservation is cancelled at once.
    expect(candidateSql).not.toContain('NOW() - (')

    expect(client.query).toHaveBeenCalledWith('BEGIN')
    expect(client.query).toHaveBeenCalledWith('COMMIT')

    const lockCalls = client.query.mock.calls.filter(([sql]) =>
      String(sql).includes('FOR NO KEY UPDATE')
    )
    expect(lockCalls).toHaveLength(2)
    expect(lockCalls[0][0]).toContain('safetrust.reservations')
    expect(lockCalls[0][0]).toContain('FOR NO KEY UPDATE OF r')
    expect(lockCalls[0][1]).toEqual(['reservation-1'])
    expect(lockCalls[1][0]).toContain('safetrust.trustless_work_escrows')
    expect(lockCalls[1][1]).toEqual(['escrow-1'])

    const updateCall = client.query.mock.calls.find(([sql]) =>
      String(sql).includes("SET status = 'cancelled'")
    )
    expect(updateCall?.[0]).toContain("cancel_reason = 'hold_expired'")
    expect(updateCall?.[0]).toContain("AND status = 'escrow_created'")
    expect(updateCall?.[1]).toEqual(['reservation-1'])
    expect(client.release).toHaveBeenCalledTimes(1)
  })

  it('preserves a reservation that is funded on-chain but not yet polled', async () => {
    const checker = jest.fn().mockResolvedValue('funded')
    setEscrowFundingChecker(checker)
    queueLockedPath()

    const cancelled = await cancelUnfundedReservationsForExpiredHolds()

    expect(cancelled).toBe(0)
    expect(checker).toHaveBeenCalledTimes(1)
    expect(noCancelUpdate(client)).toBe(true)
    expect(client.query).toHaveBeenCalledWith('COMMIT')
  })

  it('preserves the reservation when the live on-chain check fails transiently', async () => {
    const checker = jest.fn().mockRejectedValue(new Error('soroban RPC timeout'))
    setEscrowFundingChecker(checker)
    queueLockedPath()

    const cancelled = await cancelUnfundedReservationsForExpiredHolds()

    expect(cancelled).toBe(0)
    expect(noCancelUpdate(client)).toBe(true)
    expect(client.query).toHaveBeenCalledWith('COMMIT')
  })

  it('never cancels a reservation whose database escrow is already funded', async () => {
    const checker = jest.fn().mockResolvedValue('unfunded')
    setEscrowFundingChecker(checker)
    querySpy.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ ...escrowCreatedCandidate, escrow_status: 'funded' }],
    })

    const cancelled = await cancelUnfundedReservationsForExpiredHolds()

    expect(cancelled).toBe(0)
    expect(checker).not.toHaveBeenCalled()
    expect(connectSpy).not.toHaveBeenCalled()
    expect(querySpy).toHaveBeenCalledTimes(1)
  })

  it('skips cancellation when the locked escrow transitions to funded before commit', async () => {
    const checker = jest.fn().mockResolvedValue('unfunded')
    setEscrowFundingChecker(checker)
    // The candidate scan saw 'created'; the locked row is already funded.
    queueLockedPath({
      escrowRows: [{ ...lockedEscrowRow, status: 'funded' }],
      updatedRowCount: 0,
    })

    const cancelled = await cancelUnfundedReservationsForExpiredHolds()

    expect(cancelled).toBe(0)
    expect(checker).not.toHaveBeenCalled()
    expect(noCancelUpdate(client)).toBe(true)
    expect(client.query).toHaveBeenCalledWith('COMMIT')
  })

  it('skips cancellation when the locked reservation is no longer escrow_created', async () => {
    const checker = jest.fn().mockResolvedValue('unfunded')
    setEscrowFundingChecker(checker)
    queueLockedPath({ reservationRows: [] })

    const cancelled = await cancelUnfundedReservationsForExpiredHolds()

    expect(cancelled).toBe(0)
    expect(checker).not.toHaveBeenCalled()
    expect(noCancelUpdate(client)).toBe(true)
    expect(client.query).toHaveBeenCalledWith('COMMIT')
  })

  it('verifies the linked escrow with its own contract and network', async () => {
    const checker = jest.fn().mockResolvedValue('unfunded')
    setEscrowFundingChecker(checker)
    // The candidate scan and the linked escrow disagree: the link wins.
    querySpy.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ ...escrowCreatedCandidate, contract_id: 'CSCANCONTRACT', network: 'testnet' }],
    })
    queueLockedPath({
      escrowRows: [{ contract_id: 'CLINKEDCONTRACT', network: 'stellar:pubnet', status: 'created' }],
    })

    const cancelled = await cancelUnfundedReservationsForExpiredHolds()

    expect(cancelled).toBe(1)
    expect(checker).toHaveBeenCalledWith({
      contractId: 'CLINKEDCONTRACT',
      network: 'stellar:pubnet',
    })
  })

  it('treats a linked escrow with no network as unverifiable and preserves the reservation', async () => {
    const checker = jest.fn().mockResolvedValue('unfunded')
    setEscrowFundingChecker(checker)
    queueLockedPath({
      escrowRows: [{ contract_id: 'CLINKEDCONTRACT', network: null, status: 'created' }],
    })

    const cancelled = await cancelUnfundedReservationsForExpiredHolds()

    expect(cancelled).toBe(0)
    expect(checker).not.toHaveBeenCalled()
    expect(noCancelUpdate(client)).toBe(true)
    expect(client.query).toHaveBeenCalledWith('COMMIT')
  })

  it('lapses expired and abandoned holds before cancelling their reservations', async () => {
    // 1. expire lapsed holds, 2. release abandoned pending_payment holds,
    // 3. then sweep reservations left unfunded by those holds.
    querySpy
      .mockResolvedValueOnce({ rowCount: 2, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })

    const changed = await expireHolds()

    expect(changed).toBe(3)
    const statements = querySpy.mock.calls.map(([sql]) => String(sql))
    expect(statements[0]).toContain("SET status = 'expired'")
    expect(statements[1]).toContain("SET status = 'released'")
    expect(statements[2]).toContain("r.status = 'escrow_created'")
    expect(statements[2]).toContain('h.expires_at <= NOW()')
  })
})
