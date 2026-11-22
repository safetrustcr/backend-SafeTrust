import express, { Router } from 'express';
import { resolveDisputeHandler } from './resolve-dispute.handler';
import { validate } from '../../middleware/validate'
import { resolveDisputeSchema } from '../../validation'

const router: Router = express.Router();

// No authMiddleware — this is a TrustlessWork callback
router.post('/api/escrows/resolve-dispute', validate(resolveDisputeSchema), resolveDisputeHandler);

export default router;
