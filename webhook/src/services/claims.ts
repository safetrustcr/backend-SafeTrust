import { getApp } from 'firebase-admin/app'
import { listUserRoles } from '../repositories/user.repository'

const CLAIMS_KEY = 'https://hasura.io/jwt/claims'
const PRECEDENCE = ['admin', 'host', 'guest']

function firebaseAdminConfigured(): boolean {
  try {
    getApp()
    return true
  } catch {
    return false
  }
}

async function getFirebaseAuth() {
  const { getAuth } = await import('firebase-admin/auth')
  return getAuth()
}

export async function syncClaims(uid: string, userRoles?: string[]): Promise<boolean> {
  if (!firebaseAdminConfigured()) return false

  const roles = userRoles ?? (await listUserRoles(uid, true))
  const highestRole = PRECEDENCE.find((role) => roles.includes(role)) || 'guest'
  const allowedRoles = roles.includes('guest') ? roles : [...roles, 'guest']
  const hasuraClaims = {
    'x-hasura-default-role': highestRole,
    'x-hasura-allowed-roles': allowedRoles,
    'x-hasura-user-id': uid,
  }

  const auth = await getFirebaseAuth()
  const customClaims = (await auth.getUser(uid)).customClaims ?? {}
  if (JSON.stringify(customClaims[CLAIMS_KEY]) === JSON.stringify(hasuraClaims)) {
    return false
  }

  await auth.setCustomUserClaims(uid, {
    ...customClaims,
    [CLAIMS_KEY]: hasuraClaims,
  })
  return true
}

export async function getHighestRole(uid: string, userRoles?: string[]): Promise<string> {
  const roles = userRoles ?? (await listUserRoles(uid))

  return PRECEDENCE.find((role) => roles.includes(role)) || 'guest'
}
