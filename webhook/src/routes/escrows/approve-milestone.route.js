'use strict';

const express = require('express');
const { approveMilestoneHandler } = require('./approve-milestone.handler');

const router = express.Router();

router.post('/approve-milestone', approveMilestoneHandler);

module.exports = router;
