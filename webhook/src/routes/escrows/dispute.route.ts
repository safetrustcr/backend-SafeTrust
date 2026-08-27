import express, { Router } from 'express';
import { disputeEscrowHandler } from './dispute.handler';

const router: Router = express.Router();
router.post('/api/escrows/dispute', disputeEscrowHandler);

export default router;
