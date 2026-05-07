const express = require('express');

const apartmentsGetOneRoute = require('./routes/apartments/get-one.route');
const escrowsInitializeRoute = require('./routes/escrows/initialize.route');

function createApp() {
  const app = express();

  app.use(express.json());

  app.get('/health', (_req, res) => res.status(200).json({ ok: true }));

  app.use('/api/apartments', apartmentsGetOneRoute);
  app.use('/api/escrows', escrowsInitializeRoute);

  // Basic JSON 404
  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

  // JSON error handler (must be 4-arg)
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    console.error('[app] unhandled error', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };

