import { getApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { listUserRoles } from '../../repositories/user.repository'
import { syncClaims } from '../claims'

jest.mock('firebase-admin/app', () => ({ getApp: jest.fn() }))
jest.mock('firebase-admin/auth', () => ({ getAuth: jest.fn() }))
jest.mock('../../repositories/user.repository', () => ({ listUserRoles: jest.fn() }))

const CLAIMS_KEY = 'https://hasura.io/jwt/claims'
const getUser = jest.fn()
const setCustomUserClaims = jest.fn()

function claims(defaultRole: string, allowedRoles: string[]) {
  return {
    [CLAIMS_KEY]: {
      'x-hasura-default-role': defaultRole,
      'x-hasura-allowed-roles': allowedRoles,
      'x-hasura-user-id': 'uid-1',
    },
  }
}

describe('syncClaims', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(getApp as jest.Mock).mockReturnValue({})
    ;(getAuth as jest.Mock).mockReturnValue({ getUser, setCustomUserClaims })
    getUser.mockResolvedValue({ customClaims: {} })
    setCustomUserClaims.mockResolvedValue(undefined)
    ;(listUserRoles as jest.Mock).mockResolvedValue([])
  })

  it('gives a user with no roles the guest claim', async () => {
    const updated = await syncClaims('uid-1')

    expect(updated).toBe(true)
    expect(listUserRoles).toHaveBeenCalledWith('uid-1', true)
    expect(setCustomUserClaims).toHaveBeenCalledWith('uid-1', claims('guest', ['guest']))
  })

  it('gives a host the host default role and host/guest allowed roles', async () => {
    ;(listUserRoles as jest.Mock).mockResolvedValue(['host'])

    const updated = await syncClaims('uid-1')

    expect(updated).toBe(true)
    expect(setCustomUserClaims).toHaveBeenCalledWith('uid-1', claims('host', ['host', 'guest']))
  })

  it('skips the Firebase write when the claims are already identical', async () => {
    ;(listUserRoles as jest.Mock).mockResolvedValue(['host'])
    getUser.mockResolvedValue({ customClaims: claims('host', ['host', 'guest']) })

    const updated = await syncClaims('uid-1')

    expect(updated).toBe(false)
    expect(getUser).toHaveBeenCalledWith('uid-1')
    expect(setCustomUserClaims).not.toHaveBeenCalled()
  })

  it('rewrites claims when roles change and preserves other custom claims', async () => {
    ;(listUserRoles as jest.Mock).mockResolvedValue(['host'])
    getUser.mockResolvedValue({
      customClaims: { 'tenant': 'safetrust', ...claims('guest', ['guest']) },
    })

    const updated = await syncClaims('uid-1')

    expect(updated).toBe(true)
    expect(setCustomUserClaims).toHaveBeenCalledWith('uid-1', {
      'tenant': 'safetrust',
      ...claims('host', ['host', 'guest']),
    })
  })

  it('skips Firebase when the admin app is not configured', async () => {
    ;(getApp as jest.Mock).mockImplementation(() => {
      throw new Error('no default app')
    })

    const updated = await syncClaims('uid-1')

    expect(updated).toBe(false)
    expect(getAuth).not.toHaveBeenCalled()
    expect(listUserRoles).not.toHaveBeenCalled()
  })
})
