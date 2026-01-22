import { gql } from '@apollo/client';

/**
 * Subscription 1: Monitor real-time status changes for a specific escrow
 */
export const SUBSCRIBE_ESCROW_STATUS = gql`
  subscription SubscribeEscrowStatus($escrow_id: uuid!) {
    escrow_transactions_by_pk(id: $escrow_id) {
      id
      contract_id
      status
      total_amount
      amount
      activated_at
      released_at
      blockchain_tx_hash
      updated_at
      created_at
      escrow_transaction_users {
        id
        user_id
        funding_status
        funded_at
        amount
        role
        user {
          id
          email
        }
      }
      conditions: escrow_conditions {
        id
        condition_type
        description
        status
        verified_at
        verified_by
        metadata
      }
    }
  }
`;

/**
 * Subscription 2: Track real-time funding progress across all participants
 */
export const SUBSCRIBE_FUNDING_PROGRESS = gql`
  subscription SubscribeFundingProgress($escrow_id: uuid!) {
    escrow_transaction_users(
      where: { escrow_transaction_id: { _eq: $escrow_id } }
      order_by: { created_at: asc }
    ) {
      id
      user_id
      funding_status
      funded_at
      amount
      blockchain_tx_hash
      role
      user {
        id
        email
      }
    }
    escrow_transaction_users_aggregate(
      where: { 
        escrow_transaction_id: { _eq: $escrow_id }
        funding_status: { _eq: "funded" }
      }
    ) {
      aggregate {
        count
        sum {
          amount
        }
      }
    }
  }
`;

/**
 * Subscription 3: Monitor condition verification status in real-time
 */
export const SUBSCRIBE_CONDITION_UPDATES = gql`
  subscription SubscribeConditionUpdates($escrow_id: uuid!) {
    escrow_conditions(
      where: { escrow_transaction_id: { _eq: $escrow_id } }
      order_by: { created_at: asc }
    ) {
      id
      condition_type
      description
      status
      verified_at
      verified_by
      metadata
      verifier {
        id
        email
      }
    }
    escrow_conditions_aggregate(
      where: { 
        escrow_transaction_id: { _eq: $escrow_id }
        status: { _eq: "verified" }
      }
    ) {
      aggregate {
        count
      }
    }
  }
`;
