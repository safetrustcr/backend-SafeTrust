const express = require('express');
const router = express.Router();
const db = require('../services/db');
const { authenticateFirebase } = require('../middleware/auth');

/**
 * @route GET /api/apartments
 * @desc Get list of apartments with filtering and pagination
 * @access Protected
 */
router.get('/', authenticateFirebase, async (req, res) => {
  try {
    const {
      location,
      minPrice,
      maxPrice,
      bedrooms,
      petFriendly,
      category,
      page = 1,
      limit = 10,
      sortBy = 'created_at_desc'
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const queryLimit = parseInt(limit);

    let whereClause = ['a.deleted_at IS NULL'];
    let queryParams = [];
    let paramIndex = 1;

    if (location) {
      whereClause.push(`a.name ILIKE $${paramIndex} OR a.description ILIKE $${paramIndex}`);
      queryParams.push(`%${location}%`);
      paramIndex++;
    }

    if (minPrice) {
      whereClause.push(`a.price >= $${paramIndex}`);
      queryParams.push(parseFloat(minPrice));
      paramIndex++;
    }

    if (maxPrice) {
      whereClause.push(`a.price <= $${paramIndex}`);
      queryParams.push(parseFloat(maxPrice));
      paramIndex++;
    }

    if (bedrooms) {
      whereClause.push(`a.bedrooms = $${paramIndex}`);
      queryParams.push(parseInt(bedrooms));
      paramIndex++;
    }

    if (petFriendly !== undefined) {
      whereClause.push(`a.pet_friendly = $${paramIndex}`);
      queryParams.push(petFriendly === 'true');
      paramIndex++;
    }

    if (category) {
      whereClause.push(`a.category = $${paramIndex}`);
      queryParams.push(category);
      paramIndex++;
    }

    const whereString = whereClause.length > 0 ? `WHERE ${whereClause.join(' AND ')}` : '';

    // Sorting logic
    let orderClause = 'a.created_at DESC';
    if (sortBy === 'price_asc') orderClause = 'a.price ASC';
    else if (sortBy === 'price_desc') orderClause = 'a.price DESC';
    else if (sortBy === 'created_at_desc') orderClause = 'a.created_at DESC';

    // Count query
    const countQuery = `
      SELECT COUNT(*) as total 
      FROM public.apartments a
      ${whereString}
    `;
    const countResult = await db.query(countQuery, queryParams);
    const totalCount = parseInt(countResult.rows[0].total);

    // Data query
    const dataQuery = `
      SELECT 
        a.id, 
        a.name, 
        a.description, 
        a.price, 
        a.warranty_deposit, 
        a.address, 
        a.is_available, 
        a.available_from, 
        a.available_until,
        a.bedrooms,
        a.pet_friendly,
        a.category,
        a.created_at,
        u.email as owner_email
      FROM public.apartments a
      JOIN public.users u ON a.owner_id = u.id
      ${whereString}
      ORDER BY ${orderClause}
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    
    const finalParams = [...queryParams, queryLimit, offset];
    const dataResult = await db.query(dataQuery, finalParams);

    const totalPages = Math.ceil(totalCount / queryLimit);

    res.status(200).json({
      apartments: dataResult.rows,
      total: totalCount,
      page: parseInt(page),
      totalPages
    });
  } catch (error) {
    console.error('[apartments] ❌ error:', error.message);
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;
