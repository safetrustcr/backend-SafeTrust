import express, { Router } from 'express';
import { fundEscrowHandler } from './fund.handler';

const router: Router = express.Router();

// No authMiddleware — this is a TrustlessWork callback, not a user request
router.post('/api/escrows/fund', fundEscrowHandler);

export default router;
