declare module '@safetrust/types' {
  export type UserRole = 'admin' | 'host' | 'guest' | string

  export interface MeUser {
    id: string
    email: string
    roles: UserRole[]
  }

  export interface MeResponse {
    user: MeUser
    redirect: string
  }

  export type ChainType = 'ETH' | 'STELLAR' | 'BSC'

  export interface SyncWalletPayload {
    wallet_address: string
    chain_type: ChainType
    is_primary?: boolean
  }

  export interface SyncWalletResponse {
    success: boolean
    wallet_address: string
  }
}
