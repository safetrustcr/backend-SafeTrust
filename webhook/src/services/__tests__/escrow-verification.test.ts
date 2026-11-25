import {
  verifyEscrowForReservation,
  EscrowVerificationTarget,
  ReservationVerificationTarget,
} from '../escrow-verification'

describe('Centralized Escrow Verification (verifyEscrowForReservation)', () => {
  const GUEST_WALLET = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'
  const HOST_WALLET = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'
  const PLATFORM_WALLET = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'

  const validReservation: ReservationVerificationTarget = {
    id: 'res-uuid-001',
    status: 'pending',
    total_amount: 150.5,
    asset_code: 'USDC',
    guest_id: 'guest-123',
    owner_id: 'host-456',
    escrow_id: null,
    guest_wallet: GUEST_WALLET,
    host_wallet: HOST_WALLET,
  }

  const validEscrow: EscrowVerificationTarget = {
    contract_id: 'contract-tw-001',
    amount: 150.5,
    asset_code: 'USDC',
    approver: GUEST_WALLET,
    receiver: HOST_WALLET,
    marker: HOST_WALLET,
    reservation_id: 'res-uuid-001',
  }

  it('passes verification when all parameters match', () => {
    const result = verifyEscrowForReservation(validEscrow, validReservation, {
      callerUserId: 'guest-123',
    })

    expect(result.valid).toBe(true)
    expect(result.mismatches).toHaveLength(0)
  })

  it('rejects if reservation is not in pending state', () => {
    const result = verifyEscrowForReservation(validEscrow, {
      ...validReservation,
      status: 'funded',
    })

    expect(result.valid).toBe(false)
    expect(result.mismatches.some((m) => m.includes('Reservation state invalid'))).toBe(true)
  })

  it('rejects if reservation is already linked to a different escrow', () => {
    const result = verifyEscrowForReservation(validEscrow, {
      ...validReservation,
      escrow_id: 'different-escrow-uuid',
    })

    expect(result.valid).toBe(false)
    expect(result.mismatches.some((m) => m.includes('already linked'))).toBe(true)
  })

  it('allows idempotent re-verification with the same contract ID', () => {
    const result = verifyEscrowForReservation(validEscrow, {
      ...validReservation,
      escrow_id: 'contract-tw-001',
    })

    expect(result.valid).toBe(true)
    expect(result.mismatches).toHaveLength(0)
  })

  it('rejects caller mismatch when not guest', () => {
    const result = verifyEscrowForReservation(validEscrow, validReservation, {
      callerUserId: 'impostor-999',
    })

    expect(result.valid).toBe(false)
    expect(result.mismatches.some((m) => m.includes('is not the reservation guest'))).toBe(true)
  })

  it('allows server agent booking caller override', () => {
    const result = verifyEscrowForReservation(validEscrow, validReservation, {
      callerUserId: 'agent-bot-778',
      isServerAgent: true,
    })

    expect(result.valid).toBe(true)
  })

  it('rejects engagement ID mismatch', () => {
    const result = verifyEscrowForReservation(
      {
        ...validEscrow,
        reservation_id: 'different-res-id',
      },
      validReservation
    )

    expect(result.valid).toBe(false)
    expect(result.mismatches.some((m) => m.includes('engagement ID mismatch'))).toBe(true)
  })

  it('rejects non-USDC asset', () => {
    const result = verifyEscrowForReservation(
      {
        ...validEscrow,
        asset_code: 'XLM',
      },
      validReservation
    )

    expect(result.valid).toBe(false)
    expect(result.mismatches.some((m) => m.includes('Escrow asset invalid'))).toBe(true)
  })

  it('rejects amount mismatch using exact stroops comparison', () => {
    const result = verifyEscrowForReservation(
      {
        ...validEscrow,
        amount: 150.4999999, // 1 stroop less
      },
      validReservation
    )

    expect(result.valid).toBe(false)
    expect(result.mismatches.some((m) => m.includes('Escrow amount mismatch'))).toBe(true)
  })

  it('rejects approver wallet mismatch', () => {
    const result = verifyEscrowForReservation(
      {
        ...validEscrow,
        approver: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA9', // different
      },
      validReservation
    )

    expect(result.valid).toBe(false)
    expect(result.mismatches.some((m) => m.includes('approver role mismatch'))).toBe(true)
  })

  it('rejects receiver/host wallet mismatch', () => {
    const result = verifyEscrowForReservation(
      {
        ...validEscrow,
        receiver: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA9',
        marker: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA9',
      },
      validReservation
    )

    expect(result.valid).toBe(false)
    expect(result.mismatches.some((m) => m.includes('receiver/marker role mismatch'))).toBe(true)
  })

  it('rejects platform address mismatch if configured', () => {
    const originalEnv = process.env.SAFETRUST_PLATFORM_WALLET
    process.env.SAFETRUST_PLATFORM_WALLET = PLATFORM_WALLET

    try {
      const result = verifyEscrowForReservation(
        {
          ...validEscrow,
          platformAddress: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN', // mismatch
        },
        validReservation
      )

      expect(result.valid).toBe(false)
      expect(result.mismatches.some((m) => m.includes('Platform address mismatch'))).toBe(true)
    } finally {
      process.env.SAFETRUST_PLATFORM_WALLET = originalEnv
    }
  })
})
