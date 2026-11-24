export const USER_ROLES = ['admin', 'host', 'guest'] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const UserRole = {
  Admin: 'admin',
  Host: 'host',
  Guest: 'guest',
} as const;

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (USER_ROLES as readonly string[]).includes(value);
}

export interface MeUser {
  id: string;
  email: string;
  roles: UserRole[];
}

export interface MeResponse {
  user: MeUser;
  redirect: string;
}
