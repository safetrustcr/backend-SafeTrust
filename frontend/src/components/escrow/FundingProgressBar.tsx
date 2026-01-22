'use client';

interface Participant {
  id: string;
  user_id: string;
  funding_status: string;
  funded_at: string | null;
  amount: number;
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
}

interface FundingProgressBarProps {
  progress: number;
  participants: Participant[];
  fundedCount: number;
  totalParticipants: number;
}

export function FundingProgressBar({
  progress,
  participants,
  fundedCount,
  totalParticipants,
}: FundingProgressBarProps) {
  return (
    <div className="space-y-4">
      {/* Progress Bar */}
      <div className="relative">
        <div className="w-full bg-gray-200 rounded-full h-6 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-blue-500 to-green-500 transition-all duration-500 ease-out"
            style={{ width: `${Math.min(progress, 100)}%` }}
          >
            <div className="h-full flex items-center justify-end pr-2">
              <span className="text-xs font-semibold text-white">
                {Math.round(progress)}%
              </span>
            </div>
          </div>
        </div>
        <div className="mt-2 text-sm text-gray-600 text-center">
          {fundedCount} of {totalParticipants} participants funded
        </div>
      </div>

      {/* Participant List */}
      <div className="space-y-2">
        {participants.map((participant) => (
          <div
            key={participant.id}
            className="flex items-center justify-between p-2 bg-gray-50 rounded"
          >
            <div className="flex items-center space-x-3">
              <div
                className={`w-3 h-3 rounded-full ${
                  participant.funding_status === 'funded'
                    ? 'bg-green-500'
                    : 'bg-gray-300'
                }`}
              />
              <div>
                <p className="text-sm font-medium">
                  {participant.user.first_name && participant.user.last_name
                    ? `${participant.user.first_name} ${participant.user.last_name}`
                    : participant.user.email}
                </p>
                <p className="text-xs text-gray-500">
                  {participant.role} • ${participant.amount.toLocaleString()}
                  {participant.user.user_wallets?.[0] && (
                    <span className="ml-2 text-gray-400">
                      • {participant.user.user_wallets[0].wallet_address.slice(0, 6)}...
                    </span>
                  )}
                </p>
              </div>
            </div>
            <div className="text-right">
              <span
                className={`text-xs px-2 py-1 rounded ${
                  participant.funding_status === 'funded'
                    ? 'bg-green-100 text-green-800'
                    : 'bg-yellow-100 text-yellow-800'
                }`}
              >
                {participant.funding_status}
              </span>
              {participant.funded_at && (
                <p className="text-xs text-gray-500 mt-1">
                  {new Date(participant.funded_at).toLocaleDateString()}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
