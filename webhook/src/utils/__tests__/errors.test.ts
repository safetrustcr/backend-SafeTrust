import {
  AppError,
  AuthError,
  classifyError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ServiceUnavailableError,
  ValidationError,
} from '../errors'
import {
  EscrowNotFoundError,
  EscrowStateConflictError,
  EscrowValidationError,
  ReservationNotFoundError,
  ZkVerifierUnavailableError,
} from '../../services/escrow.service'
import { StaleStateError, StateConflictError } from '../../lib/escrow-transitions'
import { MilestoneNotFoundError, MilestoneValidationError } from '../../services/milestone.service'
import { TenantMismatchError } from '../../services/tenant-scoped-hasura'

describe('AppError hierarchy', () => {
  it.each([
    [new ValidationError('bad input'), 400, 'validation_error'],
    [new AuthError(), 401, 'unauthorized'],
    [new ForbiddenError(), 403, 'forbidden'],
    [new NotFoundError(), 404, 'not_found'],
    [new ConflictError('already funded'), 409, 'conflict'],
    [new ServiceUnavailableError(), 503, 'service_unavailable'],
  ])('%p maps to %i %s', (error, status, code) => {
    expect(error).toBeInstanceOf(AppError)
    expect(classifyError(error)).toMatchObject({ status, code })
  })

  it('returns the message of a 4xx error', () => {
    expect(classifyError(new ValidationError('amount must be positive')).message)
      .toBe('amount must be positive')
  })

  it('never returns the message of a 5xx error, even when asked to expose it', () => {
    const error = new AppError('relation "safetrust.users" does not exist', 500, { expose: true })
    expect(error.expose).toBe(false)
    expect(classifyError(error)).toEqual({
      status: 500,
      code: 'internal_error',
      message: 'Internal server error',
    })
    expect(classifyError(new ServiceUnavailableError('zk-verifier index.node missing')).message)
      .toBe('Service unavailable')
  })

  it('keeps the class name for logs', () => {
    expect(new ConflictError('x').name).toBe('ConflictError')
  })
})

describe('domain errors are part of the hierarchy', () => {
  it.each([
    [new EscrowNotFoundError('no escrow'), 404, 'escrow_not_found'],
    [new ReservationNotFoundError('r-1'), 404, 'reservation_not_found'],
    [new MilestoneNotFoundError('no milestone'), 404, 'milestone_not_found'],
    [new EscrowStateConflictError('already completed'), 409, 'escrow_state_conflict'],
    [new StateConflictError('bad transition'), 409, 'state_conflict'],
    [new StaleStateError('stale'), 409, 'stale_state'],
    [new TenantMismatchError(), 403, 'tenant_mismatch'],
    [new EscrowValidationError('missing field'), 400, 'escrow_validation_error'],
    [new MilestoneValidationError('missing field'), 400, 'milestone_validation_error'],
    [new ZkVerifierUnavailableError('addon missing'), 503, 'zk_verifier_unavailable'],
  ])('%p → %i %s', (error, status, code) => {
    expect(error).toBeInstanceOf(AppError)
    expect(error.statusCode).toBe(status)
    expect(classifyError(error)).toMatchObject({ status, code })
  })

  it('keeps names and instanceof checks used by handlers', () => {
    const error = new EscrowStateConflictError('x')
    expect(error.name).toBe('EscrowStateConflictError')
    expect(error).toBeInstanceOf(EscrowStateConflictError)
    expect(new MilestoneValidationError('x', 422).statusCode).toBe(422)
  })

  it('sanitizes a 5xx validation error', () => {
    const error = new EscrowValidationError('ZK proof verifier is misconfigured', 500)
    expect(classifyError(error).message).toBe('Internal server error')
  })
})

describe('classifyError for non-AppError values', () => {
  it.each([
    ['entity.parse.failed', 400, 'invalid_json'],
    ['entity.too.large', 413, 'payload_too_large'],
    ['encoding.unsupported', 415, 'unsupported_encoding'],
    ['charset.unsupported', 415, 'unsupported_charset'],
    ['request.aborted', 400, 'request_aborted'],
  ])('body-parser %s → %i %s', (type, status, code) => {
    const error = Object.assign(new Error('Unexpected token } in JSON at position 12'), { type, status })
    const classified = classifyError(error)
    expect(classified).toMatchObject({ status, code })
    expect(classified.message).not.toContain('Unexpected token')
  })

  it.each(['constructor', '__proto__', 'toString', 'hasOwnProperty'])(
    'does not treat the inherited key %s as a parser error',
    (type) => {
      expect(classifyError({ type })).toEqual({
        status: 500,
        code: 'internal_error',
        message: 'Internal server error',
      })
    }
  )

  it('uses a 4xx status from a library error, but only an exposable message', () => {
    expect(classifyError(Object.assign(new Error('Too many requests'), { status: 429, expose: true })))
      .toEqual({ status: 429, code: 'request_error', message: 'Too many requests' })
    expect(classifyError(Object.assign(new Error('internal hint'), { statusCode: 422 })).message)
      .toBe('Request could not be processed')
  })

  it('sanitizes a library 5xx', () => {
    expect(classifyError(Object.assign(new Error('upstream ECONNREFUSED 10.0.0.4'), { status: 502 })))
      .toEqual({ status: 502, code: 'internal_error', message: 'Bad gateway' })
  })

  it.each([
    new Error('duplicate key value violates unique constraint "users_email_key"'),
    'a thrown string',
    null,
    { message: 'plain object' },
  ])('maps %p to a sanitized 500', (value) => {
    expect(classifyError(value)).toEqual({
      status: 500,
      code: 'internal_error',
      message: 'Internal server error',
    })
  })
})
