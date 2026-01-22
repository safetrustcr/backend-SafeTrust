import { useSubscription } from '@apollo/client';
import { useEffect, useRef } from 'react';
import { SUBSCRIBE_USER_NOTIFICATIONS } from '@/graphql/subscriptions/notification-subscriptions';

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  metadata: Record<string, any>;
  read: boolean;
  created_at: string;
  escrow_transaction_id: string | null;
}

interface NotificationsData {
  notifications: Notification[];
}

interface UseNotificationsOptions {
  limit?: number;
  onNewNotification?: (notification: Notification) => void;
  showToast?: boolean;
}

export function useNotifications(
  userId: string | null | undefined,
  options: UseNotificationsOptions = {}
) {
  const { limit = 20, onNewNotification, showToast = true } = options;
  const prevNotificationIdsRef = useRef<Set<string>>(new Set());

  const { data, loading, error } = useSubscription<NotificationsData>(
    SUBSCRIBE_USER_NOTIFICATIONS,
    {
      variables: { user_id: userId, limit },
      skip: !userId,
      onError: (error) => {
        console.error('Notifications subscription error:', error);
      },
    }
  );

  const notifications = data?.notifications || [];
  // Calculate unread count from notifications array (all are unread by filter)
  const unreadCount = loading ? 0 : notifications.length;

  // Detect new notifications
  useEffect(() => {
    if (!notifications.length) return;

    const currentIds = new Set(notifications.map((n) => n.id));
    const newNotifications = notifications.filter(
      (n) => !prevNotificationIdsRef.current.has(n.id)
    );

    newNotifications.forEach((notification) => {
      if (onNewNotification) {
        onNewNotification(notification);
      }

      if (showToast && typeof window !== 'undefined') {
        import('sonner').then(({ toast }) => {
          toast.info(notification.title, {
            description: notification.message,
            duration: 5000,
          });
        });
      }
    });

    prevNotificationIdsRef.current = currentIds;
  }, [notifications, onNewNotification, showToast]);

  return {
    notifications,
    unreadCount,
    loading,
    error,
    hasUnread: unreadCount > 0,
  };
}
