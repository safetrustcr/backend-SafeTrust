import express, { Router } from 'express';
import { initializeEscrowHandler } from './initialize.handler';

const router: Router = express.Router();

// No authMiddleware — TrustlessWork is the caller, not a Firebase-authenticated user
router.post('/api/escrows/initialize', initializeEscrowHandler);

export default router;
