import { useSubscription } from '@apollo/client';
import { SUBSCRIBE_USER_ESCROWS } from '@/graphql/subscriptions/user-subscriptions';

interface EscrowTransaction {
  id: string;
  contract_id: string;
  status: string;
  total_amount: number;
  amount: number;
  created_at: string;
  updated_at: string;
  escrow_transaction_users_aggregate: {
    aggregate: {
      count: number;
    };
  };
  escrow_transaction_users: Array<{
    funding_status: string;
    funded_at: string | null;
    amount: number;
    role: string;
  }>;
}

interface UserEscrowsData {
  escrow_transactions: EscrowTransaction[];
}

interface UseUserEscrowsOptions {
  onEscrowUpdate?: (escrows: EscrowTransaction[]) => void;
}

export function useUserEscrows(
  userId: string | null | undefined,
  options: UseUserEscrowsOptions = {}
) {
  const { onEscrowUpdate } = options;

  const { data, loading, error } = useSubscription<UserEscrowsData>(
    SUBSCRIBE_USER_ESCROWS,
    {
      variables: { user_id: userId },
      skip: !userId,
      onError: (error) => {
        console.error('User escrows subscription error:', error);
      },
    }
  );

  const escrows = data?.escrow_transactions || [];

  // Call callback when escrows update
  if (onEscrowUpdate && escrows.length > 0) {
    onEscrowUpdate(escrows);
  }

  return {
    escrows,
    loading,
    error,
    totalEscrows: escrows.length,
    activeEscrows: escrows.filter((e) => e.status === 'active').length,
    pendingEscrows: escrows.filter((e) => e.status === 'pending').length,
    releasedEscrows: escrows.filter((e) => e.status === 'released').length,
  };
}
