const express = require('express');
const router = express.Router();
const { getPropertyById } = require('../services/property.service');
const { logger } = require('../utils/logger');

// GET /api/properties/:id
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const property = await getPropertyById(id);

    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found',
      });
    }

    return res.json({
      success: true,
      data: property,
    });
  } catch (error) {
    logger.error('Error fetching property details', { id, error: error.message });
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
});

module.exports = router;
