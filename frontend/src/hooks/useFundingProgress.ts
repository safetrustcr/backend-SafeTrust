import { useSubscription } from '@apollo/client';
import { useEffect, useRef } from 'react';
import { SUBSCRIBE_FUNDING_PROGRESS } from '@/graphql/subscriptions/escrow-subscriptions';

interface FundingProgressData {
  escrow_transaction_users: Array<{
    id: string;
    user_id: string;
    funding_status: string;
    funded_at: string | null;
    amount: number;
    blockchain_tx_hash: string | null;
    role: string;
    user: {
      id: string;
      email: string;
      first_name: string | null;
      last_name: string | null;
      user_wallets: Array<{
        wallet_address: string;
      }>;
    };
  }>;
  escrow_transaction_users_aggregate: {
    aggregate: {
      count: number;
      sum: {
        amount: number | null;
      } | null;
    };
  };
}

interface UseFundingProgressOptions {
  onFundingUpdate?: (fundedCount: number, totalCount: number) => void;
  showToast?: boolean;
}

export function useFundingProgress(
  escrowId: string | null | undefined,
  options: UseFundingProgressOptions = {}
) {
  const { onFundingUpdate, showToast = true } = options;
  const prevFundedCountRef = useRef(0);

  const { data, loading, error } = useSubscription<FundingProgressData>(
    SUBSCRIBE_FUNDING_PROGRESS,
    {
      variables: { escrow_id: escrowId },
      skip: !escrowId,
      onError: (error) => {
        console.error('Funding progress subscription error:', error);
      },
    }
  );

  const participants = data?.escrow_transaction_users || [];
  const fundedCount =
    data?.escrow_transaction_users_aggregate.aggregate.count || 0;
  const totalParticipants = participants.length;
  const progress =
    totalParticipants > 0 ? (fundedCount / totalParticipants) * 100 : 0;
  const totalFunded =
    data?.escrow_transaction_users_aggregate.aggregate.sum?.amount || 0;

  // Notify when new participant funds
  useEffect(() => {
    if (fundedCount > prevFundedCountRef.current && prevFundedCountRef.current > 0) {
      const newlyFunded = participants.find(
        (p) =>
          p.funding_status === 'funded' &&
          !participants
            .slice(0, prevFundedCountRef.current)
            .some((prev) => prev.id === p.id && prev.funding_status === 'funded')
      );

      if (newlyFunded) {
        // Call custom callback if provided
        if (onFundingUpdate) {
          onFundingUpdate(fundedCount, totalParticipants);
        }

        // Show toast notification if enabled
        if (showToast && typeof window !== 'undefined') {
          import('sonner').then(({ toast }) => {
            const displayName = newlyFunded.user.first_name && newlyFunded.user.last_name
              ? `${newlyFunded.user.first_name} ${newlyFunded.user.last_name}`
              : newlyFunded.user.email;
            toast.success(
              `💰 ${displayName} has funded the escrow! (${fundedCount}/${totalParticipants})`
            );
          });
        }
      }
    }

    prevFundedCountRef.current = fundedCount;
  }, [fundedCount, participants, totalParticipants, onFundingUpdate, showToast]);

  return {
    participants,
    fundedCount,
    totalParticipants,
    progress,
    totalFunded,
    loading,
    error,
    isFullyFunded: fundedCount === totalParticipants && totalParticipants > 0,
  };
}
