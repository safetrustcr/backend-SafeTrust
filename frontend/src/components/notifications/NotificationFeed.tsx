'use client';

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  metadata: Record<string, any>;
  read: boolean;
  created_at: string;
  escrow_transaction_id: string | null;
  escrow_transaction: {
    contract_id: string;
    status: string;
  } | null;
}

interface NotificationFeedProps {
  notifications: Notification[];
  onClose: () => void;
}

export function NotificationFeed({
  notifications,
  onClose,
}: NotificationFeedProps) {
  if (notifications.length === 0) {
    return (
      <div className="p-4 text-center text-gray-500">
        <p>No notifications</p>
      </div>
    );
  }

  return (
    <div className="max-h-96 overflow-y-auto">
      <div className="p-4 border-b border-gray-200 flex items-center justify-between">
        <h3 className="font-semibold">Notifications</h3>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600"
        >
          ✕
        </button>
      </div>
      <div className="divide-y divide-gray-200">
        {notifications.map((notification) => (
          <div
            key={notification.id}
            className={`p-4 hover:bg-gray-50 cursor-pointer ${
              !notification.read ? 'bg-blue-50' : ''
            }`}
          >
            <div className="flex items-start space-x-3">
              <div
                className={`flex-shrink-0 w-2 h-2 rounded-full mt-2 ${
                  !notification.read ? 'bg-blue-500' : 'bg-gray-300'
                }`}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900">
                  {notification.title}
                </p>
                <p className="text-sm text-gray-500 mt-1">
                  {notification.message}
                </p>
                {notification.escrow_transaction && (
                  <p className="text-xs text-gray-400 mt-1">
                    Escrow: {notification.escrow_transaction.contract_id}
                  </p>
                )}
                <p className="text-xs text-gray-400 mt-1">
                  {new Date(notification.created_at).toLocaleString()}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
