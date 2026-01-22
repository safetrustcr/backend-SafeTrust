import { ApolloClient, InMemoryCache, HttpLink, split } from '@apollo/client';
import { GraphQLWsLink } from '@apollo/client/link/subscriptions';
import { getMainDefinition } from '@apollo/client/utilities';
import { createClient } from 'graphql-ws';

// HTTP link for queries and mutations
const httpLink = new HttpLink({
  uri: process.env.NEXT_PUBLIC_HASURA_GRAPHQL_URL || 'http://localhost:8080/v1/graphql',
  headers: {
    'x-hasura-admin-secret': process.env.NEXT_PUBLIC_HASURA_ADMIN_SECRET || '',
  },
});

// WebSocket link for subscriptions
// Note: In production, use wss:// and JWT tokens instead of admin secret
const wsLink = new GraphQLWsLink(
  createClient({
    url: process.env.NEXT_PUBLIC_HASURA_WS_URL || 'ws://localhost:8080/v1/graphql',
    connectionParams: () => {
      // In production, get JWT token from auth context
      const token = typeof window !== 'undefined' 
        ? localStorage.getItem('auth_token') 
        : null;
      
      return {
        headers: token
          ? { Authorization: `Bearer ${token}` }
          : { 'x-hasura-admin-secret': process.env.NEXT_PUBLIC_HASURA_ADMIN_SECRET || '' },
      };
    },
    retryAttempts: 5,
    retryWait: async (retries) => {
      await new Promise(resolve => 
        setTimeout(resolve, Math.min(1000 * 2 ** retries, 10000))
      );
    },
    shouldRetry: () => true,
    on: {
      opened: () => console.log('🔌 WebSocket connection opened'),
      closed: () => console.log('🔌 WebSocket connection closed'),
      error: (error) => console.error('🔌 WebSocket error:', error),
    },
  })
);

// Split link: use WS for subscriptions, HTTP for queries/mutations
const splitLink = split(
  ({ query }) => {
    const definition = getMainDefinition(query);
    return (
      definition.kind === 'OperationDefinition' &&
      definition.operation === 'subscription'
    );
  },
  wsLink,
  httpLink
);

export const apolloClient = new ApolloClient({
  link: splitLink,
  cache: new InMemoryCache({
    typePolicies: {
      // Optimize cache for subscriptions
      escrow_transactions: {
        keyFields: ['id'],
        fields: {
          escrow_transaction_users: {
            merge(existing = [], incoming) {
              return incoming;
            },
          },
          conditions: {
            merge(existing = [], incoming) {
              return incoming;
            },
          },
        },
      },
      escrow_transaction_users: {
        keyFields: ['id'],
      },
      escrow_conditions: {
        keyFields: ['id'],
      },
      notifications: {
        keyFields: ['id'],
      },
      blockchain_transactions: {
        keyFields: ['id'],
      },
    },
  }),
  defaultOptions: {
    watchQuery: {
      fetchPolicy: 'cache-and-network',
    },
    query: {
      fetchPolicy: 'cache-first',
    },
  },
});
