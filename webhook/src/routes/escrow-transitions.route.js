'use strict';

const express = require('express');
const router = express.Router();
const { getTransitionTable } = require('../../../crates/escrow-state-machine');

// GET /api/escrow/transitions — returns full transition table
router.get('/api/escrow/transitions', (_req, res) => {
  try {
    const tableStr = getTransitionTable();
    const table = JSON.parse(tableStr);
    return res.status(200).json({ transitions: table });
  } catch (error) {
    console.error('Failed to get transition table:', error);
    return res.status(500).json({ error: 'Failed to get transition table' });
  }
});

module.exports = router;
