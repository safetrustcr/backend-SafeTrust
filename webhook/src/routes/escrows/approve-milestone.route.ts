import express, { Router } from 'express';
import { approveMilestoneHandler } from './approve-milestone.handler';

const router: Router = express.Router();

router.post('/api/escrows/approve-milestone', approveMilestoneHandler);

export default router;
