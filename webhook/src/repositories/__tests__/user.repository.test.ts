import { query } from '../../db/pool'
import { syncUser } from '../user.repository'

jest.mock('../../db/pool', () => ({ query: jest.fn() }))

describe('syncUser repository', () => {
  beforeEach(() => jest.clearAllMocks())

  it('reconciles an existing row before trying the insert', async () => {
    const user = {
      id: 'legacy-id',
      firebase_uid: 'firebase-user',
      email: 'user@example.com',
      last_seen: new Date('2026-10-21T06:00:00.000Z'),
    }
    ;(query as jest.Mock).mockResolvedValueOnce({ rows: [user] })

    await expect(syncUser('firebase-user', 'user@example.com')).resolves.toEqual(user)
    expect(query).toHaveBeenCalledTimes(1)
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE safetrust.users'),
      ['firebase-user', 'user@example.com']
    )
  })

  it('recovers a concurrent insert from the existing-user fallback query', async () => {
    const user = {
      id: 'firebase-user',
      firebase_uid: 'firebase-user',
      email: 'user@example.com',
      last_seen: new Date('2026-10-21T06:00:00.000Z'),
    }
    ;(query as jest.Mock)
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error('unique constraint'))
      .mockResolvedValueOnce({ rows: [user] })

    await expect(syncUser('firebase-user', 'user@example.com')).resolves.toEqual(user)
    expect(query).toHaveBeenCalledTimes(3)
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining('WHERE id = $1 OR firebase_uid = $1'),
      ['firebase-user']
    )
  })
})
