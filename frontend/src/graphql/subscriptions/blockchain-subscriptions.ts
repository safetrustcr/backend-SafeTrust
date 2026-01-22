import { gql } from '@apollo/client';

/**
 * Subscription 6: Track blockchain transaction confirmation progress
 */
export const SUBSCRIBE_BLOCKCHAIN_CONFIRMATIONS = gql`
  subscription SubscribeBlockchainConfirmations($tx_hash: String!) {
    blockchain_transactions(
      where: { transaction_hash: { _eq: $tx_hash } }
    ) {
      id
      transaction_hash
      confirmations
      required_confirmations
      block_number
      status
      network
      gas_used
      gas_price
      from_address
      to_address
      value
      metadata
      updated_at
      confirmed_at
    }
  }
`;
