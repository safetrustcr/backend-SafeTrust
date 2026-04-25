const express = require('express');
const cors = require('cors');
const { initializeFirebaseAdmin } = require('./config/firebase-admin');
const routes = require('./routes');

const app = express();

// Initialize Firebase Admin
initializeFirebaseAdmin();

// Middleware
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*'
}));
app.use(express.json());

// Routes
app.use('/', routes);

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal Server Error' });
});

module.exports = app;
