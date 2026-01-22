import { gql } from '@apollo/client';

/**
 * Subscription 5: Monitor all escrows where user is a participant
 */
export const SUBSCRIBE_USER_ESCROWS = gql`
  subscription SubscribeUserEscrows($user_id: String!) {
    escrow_transactions(
      where: {
        escrow_transaction_users: {
          user_id: { _eq: $user_id }
        }
      }
      order_by: { created_at: desc }
    ) {
      id
      contract_id
      status
      total_amount
      amount
      created_at
      updated_at
      escrow_transaction_users_aggregate {
        aggregate {
          count
        }
      }
      escrow_transaction_users(where: { user_id: { _eq: $user_id } }) {
        funding_status
        funded_at
        amount
        role
      }
    }
  }
`;
