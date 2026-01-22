// Try to load config if it exists (for Firebase setup)
let config = null;
try {
  const configModule = require('./config');
  config = configModule.config || configModule;
  if (config && config.FIREBASE_PROJECT_ID) {
    console.log("Environment loaded for project:", config.FIREBASE_PROJECT_ID);
  }
} catch (e) {
  // Config file not found or not needed - continue without it
  console.log("Config file not found, continuing without Firebase config");
}

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const webhooksRoutes = require('./webhooks');
const forgotPasswordRoutes = require('./forgot-password');
const resetPasswordRoutes = require('./reset-password');
const prepareEscrowContractRoutes = require('./prepare-escrow-contract');

// Event trigger handlers
const escrowCreatedHandler = require('./events/escrow-created');
const userFundedHandler = require('./events/user-funded');
const allFundedHandler = require('./events/all-funded');
const conditionVerifiedHandler = require('./events/condition-verified');
const allConditionsMetHandler = require('./events/all-conditions-met');
const fundReleasedHandler = require('./events/fund-released');
const refundRequestedHandler = require('./events/refund-requested');

const app = express();

// Middleware
app.use(express.json());
app.use(cors({
  credentials: true,
  origin: true,
}));
app.use(morgan('tiny'));
app.disable('x-powered-by');

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Debug middleware to log all requests
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// Routes
app.use('/webhooks', webhooksRoutes);
app.use('/api/auth', forgotPasswordRoutes);
app.use('/api/auth', resetPasswordRoutes);
app.use(prepareEscrowContractRoutes);

// Event trigger endpoints (Hasura event triggers)
// Note: These endpoints should be protected with Hasura admin secret validation
app.post('/events/escrow-created', escrowCreatedHandler);
app.post('/events/user-funded', userFundedHandler);
app.post('/events/all-funded', allFundedHandler);
app.post('/events/condition-verified', conditionVerifiedHandler);
app.post('/events/all-conditions-met', allConditionsMetHandler);
app.post('/events/fund-released', fundReleasedHandler);
app.post('/events/refund-requested', refundRequestedHandler);

// Error handler
app.use((err, req, res, next) => {
  if (err) {
    console.error(err.message);
    console.error(err.stack);
    return res.status(500).json({ error: err.message });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Webhook service listening on port ${port}`);
  console.log('Available routes:');
  console.log('- GET /health');
  console.log('- GET /api/auth/validate-reset-token');
  console.log('- POST /api/auth/reset-password');
  console.log('- POST /api/auth/forgot-password');
  console.log('- POST /webhooks/firebase/user-created');
  console.log('- POST /webhooks/firebase/user-updated');
  console.log('- POST /webhooks/firebase/user-deleted');
  console.log('- GET /webhooks/firebase/health');
  console.log('- POST /events/escrow-created');
  console.log('- POST /events/user-funded');
  console.log('- POST /events/all-funded');
  console.log('- POST /events/condition-verified');
  console.log('- POST /events/all-conditions-met');
  console.log('- POST /events/fund-released');
  console.log('- POST /events/refund-requested');
});
