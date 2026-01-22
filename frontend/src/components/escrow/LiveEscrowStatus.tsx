'use client';

import { useEscrowStatus } from '@/hooks/useEscrowStatus';
import { StatusBadge } from './StatusBadge';

interface LiveEscrowStatusProps {
  escrowId: string;
}

export function LiveEscrowStatus({ escrowId }: LiveEscrowStatusProps) {
  const { escrow, loading, error, status } = useEscrowStatus(escrowId);

  if (loading) {
    return <div>Loading escrow status...</div>;
  }

  if (error) {
    return <div>Error loading escrow: {error.message}</div>;
  }

  if (!escrow) {
    return <div>Escrow not found</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Escrow {escrow.contract_id}</h2>
          <p className="text-sm text-gray-600">
            Last updated: {new Date(escrow.updated_at).toLocaleString()}
          </p>
        </div>
        <StatusBadge status={status || 'unknown'} />
      </div>
      
      <div className="text-sm text-gray-500">
        🔴 Live updates enabled
      </div>
    </div>
  );
}
