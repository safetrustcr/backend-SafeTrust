import express, { Router } from 'express';
import { releaseFundsHandler } from './release-funds.handler';
import { validate } from '../../middleware/validate'
import { releaseFundsSchema } from '../../validation'

const router: Router = express.Router();
router.post('/api/escrows/release-funds', validate(releaseFundsSchema), releaseFundsHandler);

export default router;
