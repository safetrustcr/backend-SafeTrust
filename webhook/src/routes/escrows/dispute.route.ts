import express, { Router } from 'express';
import { disputeEscrowHandler } from './dispute.handler';
import { validate } from '../../middleware/validate'
import { disputeEscrowSchema } from '../../validation'

const router: Router = express.Router();
router.post('/api/escrows/dispute', validate(disputeEscrowSchema), disputeEscrowHandler);

export default router;
