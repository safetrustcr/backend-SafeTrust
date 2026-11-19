import { initializeFirebaseAdmin } from '../src/config/firebase-admin'

jest.mock('firebase-admin/app', () => {
  const actual = jest.requireActual('firebase-admin/app')
  return {
    ...actual,
    getApp: jest.fn(() => {
      throw new Error('no default app')
    }),
    initializeApp: jest.fn(),
    cert: jest.fn((sa: unknown) => ({ sa })),
  }
})

const appModule = jest.requireMock('firebase-admin/app') as {
  getApp: jest.Mock
  initializeApp: jest.Mock
  cert: jest.Mock
}

const ENV_KEYS = ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY', 'NODE_ENV'] as const

describe('Firebase Admin startup wiring', () => {
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const key of ENV_KEYS) saved[key] = process.env[key]
    appModule.getApp.mockImplementation(() => {
      throw new Error('no default app')
    })
    appModule.initializeApp.mockClear()
    appModule.cert.mockClear()
  })

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
    jest.restoreAllMocks()
  })

  it('initializes the default app with the injected service account in production', () => {
    process.env.NODE_ENV = 'production'
    process.env.FIREBASE_PROJECT_ID = 'proj-test'
    process.env.FIREBASE_CLIENT_EMAIL = 'svc@proj-test.iam.gserviceaccount.com'
    process.env.FIREBASE_PRIVATE_KEY = 'line1\\nline2'
    jest.spyOn(console, 'log').mockImplementation(() => {})

    initializeFirebaseAdmin()

    expect(appModule.cert).toHaveBeenCalledWith({
      projectId: 'proj-test',
      clientEmail: 'svc@proj-test.iam.gserviceaccount.com',
      privateKey: 'line1\nline2',
    })
    expect(appModule.initializeApp).toHaveBeenCalledTimes(1)
  })

  it('throws in production when Firebase configuration is missing', () => {
    process.env.NODE_ENV = 'production'
    delete process.env.FIREBASE_PROJECT_ID
    delete process.env.FIREBASE_CLIENT_EMAIL
    delete process.env.FIREBASE_PRIVATE_KEY

    expect(() => initializeFirebaseAdmin()).toThrow(/Missing FIREBASE_PROJECT_ID/)
    expect(appModule.initializeApp).not.toHaveBeenCalled()
  })

  it('does not re-initialize when a default app already exists', () => {
    appModule.getApp.mockImplementation(() => ({ name: '[DEFAULT]' }))

    initializeFirebaseAdmin()

    expect(appModule.initializeApp).not.toHaveBeenCalled()
  })
})
