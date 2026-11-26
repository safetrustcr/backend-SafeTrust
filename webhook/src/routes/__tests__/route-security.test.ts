import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import express, { NextFunction, Request, Response } from 'express'
import request from 'supertest'
import router from '../index'
import * as bidRequestService from '../../services/bid-request.service'
import * as reservationRepository from '../../repositories/reservation.repository'
import * as walletService from '../../services/wallet.service'

jest.mock('../../middleware/auth.middleware', () => ({
  authMiddleware: jest.fn((req, res, next) => {
    if (!req.headers.authorization) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    const role = req.headers['x-test-role'] || 'guest'
    req.context = { uid: 'route-security-user', tenantId: 'safetrust', roles: [role] }
    req.user = { uid: 'route-security-user', role, roles: [role] }
    next()
  }),
}))

jest.mock('../../middleware/rate-limit', () => {
  const passThrough = (_req: Request, _res: Response, next: NextFunction) => next()
  return {
    apiIpRateLimit: passThrough,
    apiRateLimit: passThrough,
    authIpRateLimit: passThrough,
    authRateLimit: passThrough,
  }
})

jest.mock('../../services/bid-request.service', () => ({
  updateBidRequest: jest.fn(),
  VALID_TRANSITIONS: {},
}))

jest.mock('../../repositories/reservation.repository', () => ({
  findReservationById: jest.fn(),
}))

jest.mock('../../services/wallet.service', () => ({
  unlinkUserWallet: jest.fn(),
}))

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE'
type RouteCase = {
  method: Method
  path: string
  roles?: string[]
  public?: boolean
}

const routes: RouteCase[] = [
  { method: 'GET', path: '/health/ready', public: true },
  { method: 'GET', path: '/health/live', public: true },
  { method: 'POST', path: '/api/escrows/initialize', public: true },
  { method: 'POST', path: '/reconciliation/sync-escrows', public: true },
  { method: 'POST', path: '/api/escrows/confirm-transaction', roles: ['guest', 'host', 'admin'] },
  { method: 'POST', path: '/api/auth/sync-wallet', roles: ['guest', 'host', 'admin'] },
  { method: 'POST', path: '/api/auth/wallet/challenge', roles: ['guest', 'host', 'admin'] },
  { method: 'POST', path: '/api/auth/wallet/verify', roles: ['guest', 'host', 'admin'] },
  { method: 'GET', path: '/api/auth/wallets' },
  { method: 'DELETE', path: '/api/auth/wallets/G' + 'A'.repeat(55), roles: ['guest', 'host', 'admin'] },
  { method: 'POST', path: '/api/auth/wallets/G' + 'A'.repeat(55) + '/primary', roles: ['guest', 'host', 'admin'] },
  { method: 'POST', path: '/api/auth/sync-user', roles: ['guest', 'host', 'admin'] },
  { method: 'GET', path: '/api/auth/me' },
  { method: 'GET', path: '/api/apartments' },
  { method: 'POST', path: '/api/apartments', roles: ['host', 'admin'] },
  { method: 'GET', path: '/api/apartments/apartment-id' },
  { method: 'POST', path: '/api/apartments/apartment-id/reports', roles: ['guest', 'host'] },
  { method: 'POST', path: '/api/bid-requests', roles: ['guest', 'host'] },
  { method: 'PATCH', path: '/api/bid-requests/bid-id', roles: ['host', 'admin'] },
  { method: 'POST', path: '/api/reservations', roles: ['guest', 'host'] },
  { method: 'GET', path: '/api/reservations' },
  { method: 'GET', path: '/api/reservations/reservation-id' },
  { method: 'POST', path: '/api/reservations/reservation-id/cancel', roles: ['guest', 'host'] },
  { method: 'POST', path: '/api/escrow-claims/escrow-id', roles: ['guest', 'host'] },
  { method: 'GET', path: '/api/escrow-claims/escrow-id' },
  { method: 'POST', path: '/api/v1/bookings/hold', roles: ['guest'] },
  { method: 'DELETE', path: '/api/v1/bookings/hold/hold-id', roles: ['guest'] },
]

const app = express().use(express.json()).use(router)

function routeSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      return entry.name === '__tests__' ? [] : routeSourceFiles(fullPath)
    }
    return /\.ts$/.test(entry.name) ? [fullPath] : []
  })
}

function callRoute(method: Method, path: string) {
  switch (method) {
    case 'GET': return request(app).get(path)
    case 'POST': return request(app).post(path)
    case 'PATCH': return request(app).patch(path)
    case 'DELETE': return request(app).delete(path)
  }
}

function disallowedRole(allowed: string[]): string {
  return ['guest', 'host', 'admin', 'unassigned'].find((role) => !allowed.includes(role))!
}

describe('route security', () => {
  it.each(routes.filter(({ path, public: isPublic }) => path.startsWith('/api') && !isPublic))(
    '$method $path requires authentication',
    async ({ method, path }) => {
      const response = await callRoute(method, path)
      expect(response.status).toBe(401)
    }
  )

  it.each(routes.filter(({ roles }) => roles))(
    '$method $path rejects users outside its allowed roles',
    async ({ method, path, roles = [] }) => {
      const response = await callRoute(method, path)
        .set('Authorization', 'Bearer test-token')
        .set('x-test-role', disallowedRole(roles))

      expect(response.status).toBe(403)
    }
  )

  it('hides another user’s bid when changing its status', async () => {
    ;(bidRequestService.updateBidRequest as jest.Mock).mockResolvedValue({ kind: 'not-owner' })

    const response = await callRoute('PATCH', '/api/bid-requests/bid-id')
      .set('Authorization', 'Bearer test-token')
      .set('x-test-role', 'host')
      .send({ status: 'approved' })

    expect(response.status).toBe(403)
  })

  it.each(['GET', 'POST'] as const)(
    '%s reservation access hides another user’s reservation',
    async (method) => {
      ;(reservationRepository.findReservationById as jest.Mock).mockResolvedValue({
        id: 'reservation-id',
        guest_id: 'another-guest',
        owner_id: 'another-host',
        status: 'pending',
      })
      const path = method === 'GET'
        ? '/api/reservations/reservation-id'
        : '/api/reservations/reservation-id/cancel'

      const response = await callRoute(method, path)
        .set('Authorization', 'Bearer test-token')
        .set('x-test-role', 'guest')

      expect(response.status).toBe(404)
    }
  )

  it('does not unlink a wallet owned by another user', async () => {
    ;(walletService.unlinkUserWallet as jest.Mock).mockResolvedValue('not-found')

    const response = await callRoute('DELETE', '/api/auth/wallets/' + 'G' + 'A'.repeat(55))
      .set('Authorization', 'Bearer test-token')
      .set('x-test-role', 'guest')

    expect(response.status).toBe(404)
  })
})

describe('public route boundary', () => {
  const routesIndex = readFileSync(join(__dirname, '..', 'index.ts'), 'utf8')
  const appSource = readFileSync(join(__dirname, '..', '..', 'app.ts'), 'utf8')

  it('keeps router mounts under /api except for the explicit public router allowlist', () => {
    const explicitMounts = [...routesIndex.matchAll(/router\.use\(\s*(['"])([^'"]+)\1/g)]
      .map((match) => match[2])
    expect(explicitMounts.every((path) => path.startsWith('/api'))).toBe(true)

    const rootMounts = [...routesIndex.matchAll(/router\.use\(\s*([A-Za-z_$][\w$]*)\s*\)/g)]
      .map((match) => match[1])
      .sort()
    expect(rootMounts).toEqual(['confirmTransactionRoute', 'healthRoutes', 'initializeRoute'])

    const authBoundary = routesIndex.indexOf("router.use('/api', authMiddleware")
    const preAuthMounts = [...routesIndex.matchAll(
      /router\.use\(\s*(['"])([^'"]+)\1\s*,\s*([A-Za-z_$][\w$]*)/g
    )]
      .filter((match) => match.index! < authBoundary)
      .map((match) => match[3])
    expect(preAuthMounts).toEqual(['apiIpRateLimit', 'authIpRateLimit'])
    expect(routesIndex.indexOf('router.use(confirmTransactionRoute)')).toBeGreaterThan(authBoundary)

    const directRouterRoutes = [...routesIndex.matchAll(
      /router\.(?:get|post|put|patch|delete|options|all)\(\s*(['"])([^'"]+)\1/gi
    )]
    expect(directRouterRoutes).toEqual([])
  })

  it('allows only documented non-/api application mounts', () => {
    const mounts = [...appSource.matchAll(/app\.use\(\s*(['"])([^'"]*)\1/g)]
      .map((match) => match[2])
    expect(mounts).toEqual(expect.arrayContaining([
      '/',
      '/health',
      '/api/escrows/initialize',
      '/reconciliation',
    ]))
    expect(mounts.filter((path) => path !== '/' && !path.startsWith('/api') && path !== '/health' && path !== '/reconciliation'))
      .toEqual([])

    const directRoutes = [...appSource.matchAll(
      /app\.(get|post|put|patch|delete|options|all)\(\s*(['"])([^'"]+)\2/gi
    )]
      .map((match) => `${match[1].toUpperCase()} ${match[3]}`)
    expect(directRoutes).toEqual(['GET /health/live'])
  })

  it('keeps root-mounted routers within their public/API route boundaries', () => {
    const routeSource = (file: string) => readFileSync(join(__dirname, '..', file), 'utf8')
    const declaredPaths = (source: string) => [...source.matchAll(
      /router\.(?:get|post|put|patch|delete|options|all)\(\s*(['"])([^'"]+)\1/gi
    )].map((match) => match[2])

    expect(declaredPaths(routeSource('health.route.ts'))).toEqual(['/health/ready'])
    expect(declaredPaths(routeSource('escrows/initialize.route.ts')))
      .toEqual(['/api/escrows/initialize'])
    expect(declaredPaths(routeSource('escrows/confirm-transaction.route.ts')))
      .toEqual(['/api/escrows/confirm-transaction'])

    const reconciliation = readFileSync(
      join(__dirname, '..', 'reconciliation', 'sync-escrows.route.ts'),
      'utf8'
    )
    expect(declaredPaths(reconciliation)).toEqual(['/sync-escrows'])
  })

  it('requires role middleware on every write route except the public allowlist', () => {
    const publicWrites = new Set([
      'escrows/initialize.route.ts:/api/escrows/initialize',
      'reconciliation/sync-escrows.route.ts:/sync-escrows',
    ])
    const violations = routeSourceFiles(join(__dirname, '..'))
      .flatMap((file) => {
        const source = readFileSync(file, 'utf8')
        const relPath = relative(join(__dirname, '..'), file).replace(/\\/g, '/')
        return [...source.matchAll(
          /router\.(?:post|put|patch|delete)\s*\([\s\S]*?\)\s*(?=\r?\n|;)/gi
        )]
          .filter((match) => !match[0].includes('requireRole('))
          .map((match) => {
            const routePath = match[0].match(/router\.\w+\s*\(\s*(['"])([^'"]+)\1/i)?.[2]
            return `${relPath}:${routePath || 'unknown'}`
          })
          .filter((route) => !publicWrites.has(route))
      })

    expect(violations).toEqual([])
  })
})
