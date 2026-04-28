const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const apartmentRoutes = require('./routes/apartments');
const reconciliationRoutes = require('./routes/reconciliation/sync-escrows.route');

const { authenticateFirebase } = require('./middleware/auth');

const app = express();
const port = process.env.WEBHOOK_PORT || 3001;

// Middleware
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

// Routes
// Protected API routes
app.use('/api', authenticateFirebase);
app.use('/api/auth', authRoutes);
app.use('/api/apartments', apartmentRoutes);

// ── Reconciliation (server-to-server, no Firebase auth) ───────────────────────
// Called by Hasura cron trigger every 15 minutes.
// Optionally protected by HASURA_EVENT_SECRET env var.
app.use('/reconciliation', reconciliationRoutes);

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal Server Error' });
});

app.listen(port, () => {
  console.log(`Webhook service listening at http://localhost:${port}`);
});
