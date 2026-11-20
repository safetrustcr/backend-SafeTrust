import { PoolClient } from 'pg'
import { pool } from '../../services/db'
import { convertHoldToReservation } from '../hold.repository'

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
