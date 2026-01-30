import { useSubscription } from '@apollo/client';
import { useEffect, useRef } from 'react';
import { SUBSCRIBE_BLOCKCHAIN_CONFIRMATIONS } from '@/graphql/subscriptions/blockchain-subscriptions';

interface BlockchainTransaction {
  id: string;
  transaction_hash: string;
  confirmations: number;
  required_confirmations: number;
  block_number: number | null;
  status: string;
  network: string;
  gas_used: number | null;
  gas_price: number | null;
  from_address: string | null;
  to_address: string | null;
  value: number | null;
  metadata: Record<string, any>;
  updated_at: string;
  confirmed_at: string | null;
}

interface BlockchainConfirmationsData {
  blockchain_transactions: BlockchainTransaction[];
}

interface UseBlockchainConfirmationsOptions {
  onConfirmed?: (transaction: BlockchainTransaction) => void;
  showToast?: boolean;
}

export function useBlockchainConfirmations(
  transactionHash: string | null | undefined,
  options: UseBlockchainConfirmationsOptions = {}
) {
  const { onConfirmed, showToast = true } = options;
  const prevConfirmationsRef = useRef(0);
  const prevStatusRef = useRef<string | null>(null);

  const { data, loading, error } = useSubscription<BlockchainConfirmationsData>(
    SUBSCRIBE_BLOCKCHAIN_CONFIRMATIONS,
    {
      variables: { tx_hash: transactionHash },
      skip: !transactionHash,
      onError: (error) => {
        console.error('Blockchain confirmations subscription error:', error);
      },
    }
  );

  const transaction = data?.blockchain_transactions[0];

  // React to confirmation changes
  useEffect(() => {
    if (!transaction) return;

    const currentConfirmations = transaction.confirmations;
    const currentStatus = transaction.status;
    const requiredConfirmations = transaction.required_confirmations;

    // Notify on new confirmations
    if (currentConfirmations > prevConfirmationsRef.current) {
      if (showToast && typeof window !== 'undefined') {
        import('sonner').then(({ toast }) => {
          toast.info(
            `⛓️ Transaction confirmed: ${currentConfirmations}/${requiredConfirmations} confirmations`
          );
        });
      }
    }

    // Notify when fully confirmed
    if (
      currentStatus === 'confirmed' &&
      prevStatusRef.current !== 'confirmed' &&
      prevStatusRef.current !== null
    ) {
      if (onConfirmed) {
        onConfirmed(transaction);
      }

      if (showToast && typeof window !== 'undefined') {
        import('sonner').then(({ toast }) => {
          toast.success('✅ Transaction fully confirmed on blockchain!');
        });
      }
    }

    prevConfirmationsRef.current = currentConfirmations;
    prevStatusRef.current = currentStatus;
  }, [transaction, onConfirmed, showToast]);

  return {
    transaction,
    loading,
    error,
    confirmations: transaction?.confirmations || 0,
    requiredConfirmations: transaction?.required_confirmations || 3,
    isConfirmed: transaction?.status === 'confirmed',
    isPending: transaction?.status === 'pending',
    progress:
      transaction && transaction.required_confirmations > 0
        ? (transaction.confirmations / transaction.required_confirmations) * 100
        : 0,
    blockNumber: transaction?.block_number,
    network: transaction?.network,
  };
}
