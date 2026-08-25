import express, { Router } from 'express';
import { resolveDisputeHandler } from './resolve-dispute.handler';

const router: Router = express.Router();

// No authMiddleware — this is a TrustlessWork callback
router.post('/api/escrows/resolve-dispute', resolveDisputeHandler);

export default router;
