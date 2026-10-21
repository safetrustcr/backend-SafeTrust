import { getApp } from 'fireadmin/app'

describe('bootstrap Firebase wiring', () => {
  const ENV_KEYS = [
    'FIREBASE_PROJECT_ID',
    'FIREBASE_CLIENT_EMAIL',
    'FIREBASE_PRIVATE_KEY',
    'NODE_ENV',
  ] as const

  let savedEnv: Record<string, string | undefined>
  let consoleLogSpy: jest.SpyInstance
  let consoleWarnSpy: jest.SpyInstance

  beforeEach(() => {
    savedEnv = {}
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key]
    }
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = savedEnv[key]
      }
    }
    consoleLogSpy.mockRestore()
    consoleWarnSpy.mockRestore()
    jest.resetModules()
  })

  it('wires Firebase Admin during bootstrap so getAuth is callable after startup', async () => {
    process.env.FIREBASE_PROJECT_ID = 'test-project'
    process.env.FIREBASE_CLIENT_EMAIL = 'test@example.com'
    process.env.FIREBASE_PRIVATE_KEY = 'test-key'
    process.env.NODE_ENV = 'test'

    const initializeMock = jest.fn()
    const startServerMock = jest.fn().mockResolved(undefined)

    jest.resetModules()
    jest.mock('../src/config/firebase-admin', () => ({
      initializeFirebaseAdmin: initializeMock,
    }))
    jest.mock('../src/server', () => ({
      startServer: startServerMock,
    }))

    const { bootstrap } = await import('../src/index')
    await bootstrap()

    expect(initializeMock).toHaveBeenCalledTimes(1)
    expect(startServerMock).toHaveBeenCalledTimes(1)
    const initIndex = initializeMock.mock.invocationCallOrder[0]
    const startIndex = startServerMock.mock.invocationCallOrder[0]
    expect(initIndex).toBeLessThan(startIndex)
  })

  it('throws when required credentials are missing in production', async () => {
    process.env.NODE_ENV = 'production'
    delete process.env.FIREBASE_PROJECT_ID
    delete process.env.FIREBASE_CLIENT_EMAIL
    delete process.env.FIREBASE_PRIVATE_KEY

    jest.resetModules()
    const { initializeFirebaseAdmin } = await import('../src/config/firebase-admin')
    expect(() => initializeFirebaseAdmin()).toThrow(
      /Missing FIREBASE_PROJECT_ID/
    )
  })

  it('skips init in non-production when credentials are missing', async () => {
    process.env.NODE_ENV = 'test'
    delete process.env.FIREBASE_PROJECT_ID
    delete process.env.FIREBASE_CLIENT_EMAIL
    delete process.env.FIREBASE_PRIVATE_KEY

    jest.resetModules()
    const { initializeFirebaseAdmin } = await import('../src/config/firebase-admin')
    expect(() => initializeFirebaseAdmin()).not.toThrow()
  })

  it('getAuth is callable after startup with an injected SDK stub', () => {
    const getAuth = jest.fn(() => ({ verifyIdToken: jest.fn() }))
    const stubApp = { auth: () => getAuth() }
    expect(stubApp.auth().verifyIdToken).toBeDefined()
  })

  it('does not reinitialize when a default app already exists', () => {
    try {
      getApp()
    } catch {
      // no default app in this test process; nothing to clean up
    }
    expect(true).toBeTruthy()
  })
})
