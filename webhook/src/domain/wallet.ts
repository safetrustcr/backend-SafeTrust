export const CHAIN_TYPES = ['ETH', 'STELLAR', 'BSC'] as const;

export type ChainType = (typeof CHAIN_TYPES)[number];

export const ChainType = {
  ETH: 'ETH',
  STELLAR: 'STELLAR',
  BSC: 'BSC',
} as const;

export function isChainType(value: unknown): value is ChainType {
  return typeof value === 'string' && (CHAIN_TYPES as readonly string[]).includes(value);
}

export interface SyncWalletPayload {
  wallet_address: string;
  chain_type: ChainType;
  is_primary?: boolean;
}

export interface SyncWalletResponse {
  success: boolean;
  wallet_address: string;
}

export interface WalletDto {
  address: string;
  chain: ChainType;
  isPrimary: boolean;
  createdAt: string;
}

export interface ListWalletsResponse {
  wallets: WalletDto[];
  signInWallet: string | null;
}
