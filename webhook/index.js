import { config } from "./config";

console.log("Environment loaded for project:", config.FIREBASE_PROJECT_ID);

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const webhooksRoutes = require('./webhooks');
const forgotPasswordRoutes = require('./forgot-password');
const resetPasswordRoutes = require('./reset-password');
const prepareEscrowContractRoutes = require('./prepare-escrow-contract');

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
});
