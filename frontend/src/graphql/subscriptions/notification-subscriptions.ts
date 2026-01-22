import { gql } from '@apollo/client';

/**
 * Subscription 4: Real-time notification feed for user-specific alerts
 */
export const SUBSCRIBE_USER_NOTIFICATIONS = gql`
  subscription SubscribeUserNotifications($user_id: String!, $limit: Int = 20) {
    notifications(
      where: { 
        user_id: { _eq: $user_id }
        read: { _eq: false }
      }
      order_by: { created_at: desc }
      limit: $limit
    ) {
      id
      type
      title
      message
      metadata
      read
      created_at
      escrow_transaction_id
    }
  }
`;
