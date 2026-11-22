import express, { Router } from 'express';
import { approveMilestoneHandler } from './approve-milestone.handler';
import { validate } from '../../middleware/validate'
import { approveMilestoneSchema } from '../../validation'

const router: Router = express.Router();

router.post('/api/escrows/approve-milestone', validate(approveMilestoneSchema), approveMilestoneHandler);

export default router;
