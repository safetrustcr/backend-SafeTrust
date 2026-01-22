import { useSubscription } from '@apollo/client';
import { useEffect, useRef } from 'react';
import { SUBSCRIBE_ESCROW_STATUS } from '@/graphql/subscriptions/escrow-subscriptions';

interface EscrowStatusData {
  escrow_transactions_by_pk: {
    id: string;
    contract_id: string;
    status: string;
    total_amount: number;
    amount: number;
    activated_at: string | null;
    released_at: string | null;
    blockchain_tx_hash: string | null;
    updated_at: string;
    created_at: string;
    escrow_transaction_users: Array<{
      id: string;
      user_id: string;
      funding_status: string;
      funded_at: string | null;
      amount: number;
      role: string;
      user: {
        id: string;
        email: string;
      };
    }>;
    conditions: Array<{
      id: string;
      condition_type: string;
      description: string;
      status: string;
      verified_at: string | null;
      verified_by: string | null;
      metadata: Record<string, any>;
    }>;
  } | null;
}

interface UseEscrowStatusOptions {
  onStatusChange?: (newStatus: string, oldStatus: string) => void;
  showToast?: boolean;
}

export function useEscrowStatus(
  escrowId: string | null | undefined,
  options: UseEscrowStatusOptions = {}
) {
  const { onStatusChange, showToast = true } = options;
  const prevStatusRef = useRef<string | null>(null);

  const { data, loading, error } = useSubscription<EscrowStatusData>(
    SUBSCRIBE_ESCROW_STATUS,
    {
      variables: { escrow_id: escrowId },
      skip: !escrowId,
      onError: (error) => {
        console.error('Escrow status subscription error:', error);
      },
    }
  );

  const escrow = data?.escrow_transactions_by_pk;

  // React to status changes
  useEffect(() => {
    if (!escrow) return;

    const currentStatus = escrow.status;
    const previousStatus = prevStatusRef.current;

    if (previousStatus && previousStatus !== currentStatus) {
      // Call custom callback if provided
      if (onStatusChange) {
        onStatusChange(currentStatus, previousStatus);
      }

      // Show toast notifications if enabled
      if (showToast && typeof window !== 'undefined') {
        // Dynamic import to avoid SSR issues
        import('sonner').then(({ toast }) => {
          switch (currentStatus) {
            case 'active':
              toast.success('✅ Escrow is now active - all parties funded!');
              break;
            case 'released':
              toast.success('🎉 Funds have been released!');
              break;
            case 'refunded':
              toast.info('💰 Refund processed');
              break;
            case 'cancelled':
              toast.error('❌ Escrow cancelled');
              break;
          }
        });
      }
    }

    prevStatusRef.current = currentStatus;
  }, [escrow?.status, onStatusChange, showToast]);

  return {
    escrow,
    loading,
    error,
    status: escrow?.status,
    isActive: escrow?.status === 'active',
    isReleased: escrow?.status === 'released',
    isRefunded: escrow?.status === 'refunded',
    isCancelled: escrow?.status === 'cancelled',
    participants: escrow?.escrow_transaction_users || [],
    conditions: escrow?.conditions || [],
    totalAmount: escrow?.total_amount || escrow?.amount || 0,
    activatedAt: escrow?.activated_at,
    releasedAt: escrow?.released_at,
    blockchainTxHash: escrow?.blockchain_tx_hash,
  };
}
