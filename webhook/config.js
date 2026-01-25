// Webhook service configuration
// This file loads environment variables and exports config

require('dotenv').config();

module.exports = {
  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID || '',
  },
  hasura: {
    endpoint: process.env.NEXT_PUBLIC_HASURA_GRAPHQL_URL || process.env.HASURA_GRAPHQL_ENDPOINT || 'http://localhost:8080/v1/graphql',
    adminSecret: process.env.HASURA_GRAPHQL_ADMIN_SECRET || 'myadminsecretkey',
  },
  database: {
    url: process.env.DATABASE_URL || 'postgres://postgres:postgrespassword@localhost:5432/postgres',
  },
};
