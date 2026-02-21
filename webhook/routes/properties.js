const express = require('express');
const router = express.Router();
const { getPropertyById } = require('../services/property.service');
const { createEndpointLimiter } = require('../middleware/rate-limiter');
const { logger } = require('../utils/logger');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const propertyLimiter = createEndpointLimiter(60, 15 * 60 * 1000, 'rl:properties:');

// GET /api/properties/:id
router.get('/:id', propertyLimiter, async (req, res) => {
  const { id } = req.params;

  if (!UUID_RE.test(id)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid property ID format',
    });
  }

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
