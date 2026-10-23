import express, { Router } from 'express';
import { releaseFundsHandler } from './release-funds.handler';

const router: Router = express.Router();
router.post('/api/escrows/release-funds', releaseFundsHandler);

export default router;
