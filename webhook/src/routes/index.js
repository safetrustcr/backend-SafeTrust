// webhook/src/routes/index.js
const express = require('express');
const router = express.Router();

// Auth routes
const authRoutes = require('./auth');
router.use('/api/auth', authRoutes);

// Apartment routes
const apartmentRoutes = require('./apartments/list.route');
router.use('/api/apartments', apartmentRoutes);

// Escrow routes
const initializeRoute = require('./escrows/initialize.route');
const fundRoute = require('./escrows/fund.route');
const approveMilestoneRoute = require('./escrows/approve-milestone.route');
const releaseFundsRoute = require('./escrows/release-funds.route');
const disputeRoute = require('./escrows/dispute.route');
const resolveDisputeRoute = require('./escrows/resolve-dispute.route');
router.use(initializeRoute);
router.use(fundRoute);
router.use(approveMilestoneRoute);
router.use(releaseFundsRoute);
router.use(disputeRoute);
router.use(resolveDisputeRoute);

// Bid requests
const bidRequestsRoute = require('./bid-requests');
router.use('/api/bid-requests', bidRequestsRoute);

// Reservations
const reservationsRoute = require('./reservations');
router.use(reservationsRoute);

// Hotel conversations
const hotelConversationsRoute = require('./hotel/conversations/send.route');
router.use(hotelConversationsRoute);

module.exports = router;