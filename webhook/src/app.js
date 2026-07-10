require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { initializeFirebaseAdmin } = require('./config/firebase-admin');

initializeFirebaseAdmin();
const routes = require('./routes');
const reconciliationRoutes = require('./routes/reconciliation/sync-escrows.route');

const app = express();

// Middleware
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*'
}));
app.use(express.json());

// Routes
app.use('/', routes);

// Reconciliation — server-to-server, no Firebase auth (Hasura cron trigger)
app.use('/reconciliation', reconciliationRoutes);


// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal Server Error' });
});

module.exports = app;
