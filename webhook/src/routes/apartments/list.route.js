const express = require('express');
const { authMiddleware } = require('../../middleware/auth.middleware');
const { listApartments, createApartment, getApartmentById } = require('./list.handler');

const router = express.Router();

router.get('/',     authMiddleware, listApartments);
router.post('/',    authMiddleware, createApartment);
router.get('/:id',  authMiddleware, getApartmentById);

module.exports = router;