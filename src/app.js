const express = require('express');

const apartmentsGetOneRoute = require('./routes/apartments/get-one.route');

function createApp() {
  const app = express();

  app.use(express.json());

  app.get('/health', (_req, res) => res.status(200).json({ ok: true }));

  app.use('/api/apartments', apartmentsGetOneRoute);

  // Basic JSON 404
  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

  return app;
}

module.exports = { createApp };

