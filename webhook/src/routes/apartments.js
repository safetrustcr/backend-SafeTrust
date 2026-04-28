const express = require('express');
const router = express.Router();
const db = require('../services/db');

/**
 * @route GET /api/apartments
 * @desc Get list of apartments with advanced filtering, sorting, and pagination.
 * Supports filters for location, price range, bedrooms, pet policy, and category.
 * @access Protected
 */
router.get('/', async (req, res) => {
  try {
    let {
      location,
      minPrice,
      maxPrice,
      bedrooms,
      petFriendly,
      category,
      page = 1,
      limit = 10,
      sort = 'created_at'
    } = req.query;

    // 1. Pagination Validation & Clamping
    const MAX_LIMIT = 100;
    let validatedPage = parseInt(page, 10);
    let validatedLimit = parseInt(limit, 10);

    if (isNaN(validatedPage) || validatedPage < 1) validatedPage = 1;
    if (isNaN(validatedLimit) || validatedLimit < 1) validatedLimit = 10;
    if (validatedLimit > MAX_LIMIT) validatedLimit = MAX_LIMIT;

    const offset = (validatedPage - 1) * validatedLimit;

    // 2. Dynamic WHERE Builder
    let whereClause = ['a.deleted_at IS NULL'];
    let queryParams = [];
    let paramIndex = 1;

    if (location) {
      // Use parentheses for OR expression to prevent logic leaks
      whereClause.push(`(a.name ILIKE $${paramIndex} OR a.description ILIKE $${paramIndex})`);
      queryParams.push(`%${location}%`);
      paramIndex++;
    }

    if (minPrice) {
      const min = parseFloat(minPrice);
      if (isNaN(min)) {
        return res.status(400).json({ error: 'Invalid minPrice value. Expected a number.' });
      }
      whereClause.push(`a.price >= $${paramIndex}`);
      queryParams.push(min);
      paramIndex++;
    }

    if (maxPrice) {
      const max = parseFloat(maxPrice);
      if (isNaN(max)) {
        return res.status(400).json({ error: 'Invalid maxPrice value. Expected a number.' });
      }
      whereClause.push(`a.price <= $${paramIndex}`);
      queryParams.push(max);
      paramIndex++;
    }

    if (bedrooms) {
      const beds = parseInt(bedrooms, 10);
      if (isNaN(beds)) {
        return res.status(400).json({ error: 'Invalid bedrooms value. Expected an integer.' });
      }
      whereClause.push(`a.bedrooms = $${paramIndex}`);
      queryParams.push(beds);
      paramIndex++;
    }

    if (petFriendly !== undefined) {
      const normalizedPet = String(petFriendly).toLowerCase();
      const truthy = ['true', '1', 'yes'];
      const falsy = ['false', '0', 'no'];
      
      if (truthy.includes(normalizedPet)) {
        whereClause.push(`a.pet_friendly = $${paramIndex}`);
        queryParams.push(true);
        paramIndex++;
      } else if (falsy.includes(normalizedPet)) {
        whereClause.push(`a.pet_friendly = $${paramIndex}`);
        queryParams.push(false);
        paramIndex++;
      } else {
        return res.status(400).json({ error: 'Invalid petFriendly value. Expected true, false, 1, 0, yes, or no.' });
      }
    }

    if (category) {
      whereClause.push(`a.category = $${paramIndex}`);
      queryParams.push(category);
      paramIndex++;
    }

    const whereString = `WHERE ${whereClause.join(' AND ')}`;

    // 3. Sorting Whitelist & Mapping
    const allowedSorts = ['price_asc', 'price_desc', 'created_at'];
    if (sort && !allowedSorts.includes(sort)) {
      return res.status(400).json({ error: `Invalid sort parameter. Supported values: ${allowedSorts.join(', ')}` });
    }

    const sortMapping = {
      'price_asc': 'a.price ASC',
      'price_desc': 'a.price DESC',
      'created_at': 'a.created_at DESC'
    };
    const orderClause = sortMapping[sort] || sortMapping['created_at'];

    // 4. Count Query (Must match filtering logic)
    const countQuery = `
      SELECT COUNT(*) as total 
      FROM public.apartments a
      ${whereString}
    `;
    const countResult = await db.query(countQuery, queryParams);
    const totalCount = parseInt(countResult.rows[0].total, 10);

    // 5. Data Query (Use LEFT JOIN to include apartments with missing/unsynced owners)
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
      LEFT JOIN public.users u ON a.owner_id = u.id
      ${whereString}
      ORDER BY ${orderClause}
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    
    const finalParams = [...queryParams, validatedLimit, offset];
    const dataResult = await db.query(dataQuery, finalParams);

    const totalPages = Math.ceil(totalCount / validatedLimit);

    res.status(200).json({
      apartments: dataResult.rows,
      total: totalCount,
      page: validatedPage,
      totalPages
    });
  } catch (error) {
    console.error('[apartments] ❌ error:', error.message);
    res.status(500).json({ error: 'Database error' });
  }
});

/**
 * @route GET /api/apartments/:id
 * @desc Get a single apartment by ID with owner details.
 * @access Protected
 */
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const query = `
      SELECT 
        a.*,
        u.email as owner_email,
        u.last_seen as owner_last_seen
      FROM public.apartments a
      LEFT JOIN public.users u ON a.owner_id = u.id
      WHERE a.id = $1 AND a.deleted_at IS NULL
    `;
    const result = await db.query(query, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Apartment not found' });
    }

    res.status(200).json({ apartment: result.rows[0] });
  } catch (error) {
    console.error('[apartments] ❌ error:', error.message);
    res.status(500).json({ error: 'Database error' });
  }
});

/**
 * @route POST /api/apartments
 * @desc Create a new apartment.
 * @access Protected
 */
router.post('/', async (req, res) => {
  const { 
    name, description, price, warranty_deposit, 
    bedrooms, pet_friendly, category,
    address, coordinates 
  } = req.body;
  const owner_id = req.user.uid;

  // Validation
  if (!name) return res.status(400).json({ error: 'Missing name' });
  if (price === undefined) return res.status(400).json({ error: 'Missing pricePerMonth' });

  try {
    const query = `
      INSERT INTO public.apartments (
        name, description, price, warranty_deposit, 
        bedrooms, pet_friendly, category,
        address, coordinates, owner_id,
        available_from
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
      RETURNING *
    `;
    
    // Convert coordinates to Point string if object
    let pointStr = coordinates;
    if (typeof coordinates === 'object' && coordinates !== null) {
      pointStr = `(${coordinates.x}, ${coordinates.y})`;
    } else if (!coordinates) {
      pointStr = '(0,0)';
    }

    const values = [
      name, description, price, warranty_deposit || price * 2,
      bedrooms || 1, pet_friendly || false, category || 'Apartment',
      JSON.stringify(address || {}), pointStr, owner_id
    ];

    const result = await db.query(query, values);
    res.status(201).json({ apartment: result.rows[0] });
  } catch (error) {
    console.error('[apartments] ❌ error:', error.message);
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;
