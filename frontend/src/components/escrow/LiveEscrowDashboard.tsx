'use client';

import { useEscrowStatus } from '@/hooks/useEscrowStatus';
import { useFundingProgress } from '@/hooks/useFundingProgress';
import { FundingProgressBar } from './FundingProgressBar';
import { ConditionChecklist } from './ConditionChecklist';
import { StatusBadge } from './StatusBadge';

interface LiveEscrowDashboardProps {
  escrowId: string;
}

export function LiveEscrowDashboard({ escrowId }: LiveEscrowDashboardProps) {
  const {
    escrow,
    loading: statusLoading,
    error: statusError,
    status,
    isActive,
    isReleased,
    participants,
    conditions,
    totalAmount,
    activatedAt,
    releasedAt,
    blockchainTxHash,
  } = useEscrowStatus(escrowId);

  const {
    participants: fundingParticipants,
    progress,
    isFullyFunded,
    fundedCount,
    totalParticipants,
    loading: fundingLoading,
  } = useFundingProgress(escrowId);

  if (statusLoading || fundingLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        <span className="ml-3 text-gray-600">Loading escrow details...</span>
      </div>
    );
  }

  if (statusError) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <p className="text-red-800">
          Error loading escrow: {statusError.message}
        </p>
      </div>
    );
  }

  if (!escrow) {
    return (
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
        <p className="text-yellow-800">Escrow not found</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Escrow {escrow.contract_id}</h1>
          <p className="text-gray-600 mt-1">
            Total Amount: ${totalAmount.toLocaleString()} USDC
          </p>
        </div>
        <StatusBadge status={status || 'unknown'} />
      </div>

      {/* Funding Progress - Live Updates! */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-xl font-semibold mb-4">
          💰 Funding Progress
          {isFullyFunded && (
            <span className="ml-2 text-green-600 text-sm">✅ Fully Funded</span>
          )}
        </h2>
        <FundingProgressBar
          progress={progress}
          participants={fundingParticipants}
          fundedCount={fundedCount}
          totalParticipants={totalParticipants}
        />
      </div>

      {/* Conditions - Live Updates! */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-xl font-semibold mb-4">📋 Conditions</h2>
        <ConditionChecklist conditions={conditions} />
      </div>

      {/* Participants List */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-xl font-semibold mb-4">👥 Participants</h2>
        <div className="space-y-2">
          {participants.map((participant) => (
            <div
              key={participant.id}
              className="flex items-center justify-between p-3 bg-gray-50 rounded"
            >
              <div>
                <p className="font-medium">{participant.user.email}</p>
                <p className="text-sm text-gray-500">
                  Role: {participant.role} • Amount: ${participant.amount.toLocaleString()}
                </p>
              </div>
              <span
                className={`px-3 py-1 rounded-full text-sm ${
                  participant.funding_status === 'funded'
                    ? 'bg-green-100 text-green-800'
                    : participant.funding_status === 'pending'
                    ? 'bg-yellow-100 text-yellow-800'
                    : 'bg-red-100 text-red-800'
                }`}
              >
                {participant.funding_status}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Blockchain Transaction Info */}
      {blockchainTxHash && (
        <div className="bg-blue-50 rounded-lg p-4">
          <p className="text-sm text-blue-800">
            🔗 Blockchain Transaction:{' '}
            <a
              href={`https://polygonscan.com/tx/${blockchainTxHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-blue-600"
            >
              {blockchainTxHash.slice(0, 10)}...
            </a>
          </p>
        </div>
      )}

      {/* Timestamps */}
      <div className="grid grid-cols-2 gap-4 text-sm text-gray-600">
        {activatedAt && (
          <div>
            <span className="font-medium">Activated:</span>{' '}
            {new Date(activatedAt).toLocaleString()}
          </div>
        )}
        {releasedAt && (
          <div>
            <span className="font-medium">Released:</span>{' '}
            {new Date(releasedAt).toLocaleString()}
          </div>
        )}
      </div>

      {/* Live Status Updates */}
      <div className="text-sm text-gray-500 text-center">
        🔴 Live updates enabled • Last updated:{' '}
        {new Date(escrow.updated_at).toLocaleString()}
      </div>
    </div>
  );
}
