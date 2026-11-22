import express, { Router } from 'express';
import { fundEscrowHandler } from './fund.handler';
import { validate } from '../../middleware/validate'
import { fundEscrowSchema } from '../../validation'

const router: Router = express.Router();

// No authMiddleware — this is a TrustlessWork callback, not a user request
router.post('/api/escrows/fund', validate(fundEscrowSchema), fundEscrowHandler);

export default router;
