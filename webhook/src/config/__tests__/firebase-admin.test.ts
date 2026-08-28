import { initializeFirebaseAdmin } from '../firebase-admin'
import { initializeApp, cert, getApp, getApps } from 'firebase-admin/app'

jest.mock('firebase-admin/app', () => ({
  initializeApp: jest.fn(),
  cert: jest.fn(),
  getApp: jest.fn(),
  getApps: jest.fn(),
}))

describe('initializeFirebaseAdmin', () => {
  const OLD_ENV = process.env.NODE_ENV
  const OLD_VARS = {
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY,
  }
  const MOCK_APP = { name: '[DEFAULT]' }
  const NAMED_APP = { name: 'named-app' }

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.NODE_ENV = 'test'
    process.env.FIREBASE_PROJECT_ID = 'test-project'
    process.env.FIREBASE_CLIENT_EMAIL = 'test@example.com'
    process.env.FIREBASE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----'
    ;(initializeApp as jest.Mock).mockReturnValue(MOCK_APP)
    ;(cert as jest.Mock).mockImplementation((serviceAccount) => serviceAccount)
    ;(getApp as jest.Mock).mockImplementation(() => {
      throw new Error('The default Firebase app does not exist.')
    })
    ;(getApps as jest.Mock).mockReturnValue([])
  })

  afterAll(() => {
    process.env.NODE_ENV = OLD_ENV
    if (OLD_VARS.projectId === undefined) delete process.env.FIREBASE_PROJECT_ID
    else process.env.FIREBASE_PROJECT_ID = OLD_VARS.projectId
    if (OLD_VARS.clientEmail === undefined) delete process.env.FIREBASE_CLIENT_EMAIL
    else process.env.FIREBASE_CLIENT_EMAIL = OLD_VARS.clientEmail
    if (OLD_VARS.privateKey === undefined) delete process.env.FIREBASE_PRIVATE_KEY
    else process.env.FIREBASE_PRIVATE_KEY = OLD_VARS.privateKey
  })

  it('initializes the default app when only a named app exists', () => {
    ;(getApps as jest.Mock).mockReturnValue([NAMED_APP])

    initializeFirebaseAdmin()

    expect(initializeApp).toHaveBeenCalledTimes(1)
    expect(initializeApp).toHaveBeenCalledWith(
      expect.objectContaining({ credential: expect.anything() })
    )
  })

  it('skips initialization when the default app already exists', () => {
    ;(getApp as jest.Mock).mockReturnValue(MOCK_APP)

    initializeFirebaseAdmin()

    expect(initializeApp).not.toHaveBeenCalled()
  })

  it('throws in production when required env vars are missing', () => {
    process.env.NODE_ENV = 'production'
    delete process.env.FIREBASE_PROJECT_ID

    expect(() => initializeFirebaseAdmin()).toThrow(
      '[Firebase Admin] Missing FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, or FIREBASE_PRIVATE_KEY'
    )
    expect(initializeApp).not.toHaveBeenCalled()
  })

  it('warns and skips init in non-production when required env vars are missing', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    delete process.env.FIREBASE_PROJECT_ID

    expect(() => initializeFirebaseAdmin()).not.toThrow()
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('skipping cert init (non-production)')
    )
    expect(initializeApp).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('unwraps escaped newlines in the private key before building the credential', () => {
    process.env.FIREBASE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\\nline2'

    initializeFirebaseAdmin()

    expect(initializeApp).toHaveBeenCalledTimes(1)
    expect(cert).toHaveBeenCalledWith({
      projectId: 'test-project',
      clientEmail: 'test@example.com',
      privateKey: '-----BEGIN PRIVATE KEY-----\nline2',
    })
  })
})
