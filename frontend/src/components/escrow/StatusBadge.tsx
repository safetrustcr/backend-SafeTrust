'use client';

interface StatusBadgeProps {
  status: string;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const getStatusConfig = (status: string) => {
    switch (status.toLowerCase()) {
      case 'active':
        return {
          label: 'Active',
          className: 'bg-green-100 text-green-800 border-green-300',
          icon: '✅',
        };
      case 'released':
        return {
          label: 'Released',
          className: 'bg-blue-100 text-blue-800 border-blue-300',
          icon: '🎉',
        };
      case 'refunded':
        return {
          label: 'Refunded',
          className: 'bg-purple-100 text-purple-800 border-purple-300',
          icon: '💰',
        };
      case 'cancelled':
        return {
          label: 'Cancelled',
          className: 'bg-red-100 text-red-800 border-red-300',
          icon: '❌',
        };
      case 'pending':
        return {
          label: 'Pending',
          className: 'bg-yellow-100 text-yellow-800 border-yellow-300',
          icon: '⏳',
        };
      default:
        return {
          label: status,
          className: 'bg-gray-100 text-gray-800 border-gray-300',
          icon: '❓',
        };
    }
  };

  const config = getStatusConfig(status);

  return (
    <div
      className={`px-4 py-2 rounded-full border-2 font-semibold flex items-center space-x-2 ${config.className}`}
    >
      <span>{config.icon}</span>
      <span>{config.label}</span>
    </div>
  );
}
