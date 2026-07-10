'use strict';

const express = require('express');
const { approveMilestoneHandler } = require('./approve-milestone.handler');

const router = express.Router();

router.post('/api/escrows/approve-milestone', approveMilestoneHandler);

module.exports = router;
