const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth.middleware');

// Dummy handlers for demonstration if real routes don't exist yet
const placeholder = (name) => (req, res) => res.json({ message: `${name} route`, user: req.user });

// In a real app, these would be imported from separate files:
// const apartmentRoutes = require('./apartment.routes');
// const bidRoutes = require('./bid.routes');
// ...
const apartmentRoutes = placeholder('Apartments');
const bidRoutes = placeholder('Bid Requests');
const escrowRoutes = placeholder('Escrow');
const userRoutes = placeholder('Users');
const healthRoute = (req, res) => res.status(200).send('OK');
const webhookRoutes = (req, res) => res.status(200).json({ status: 'received' });

// --- Protected Routes ---
router.use('/api/apartments', authMiddleware, apartmentRoutes);
router.use('/api/bid-requests', authMiddleware, bidRoutes);
router.use('/api/escrow', authMiddleware, escrowRoutes);
router.use('/api/users', authMiddleware, userRoutes);

// --- Public Routes ---
router.use('/health', healthRoute);
router.use('/webhooks', webhookRoutes);

module.exports = router;
