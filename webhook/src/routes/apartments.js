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
 * @route POST /api/apartments
 * @desc Create apartment listing for authenticated owner
 * @access Protected
 */
router.post('/', async (req, res) => {
  const ownerId = req.user?.uid;
  const {
    name,
    location,
    pricePerMonth,
    promotionPercent = null,
    rooms = 1,
    bathrooms = 1,
    petFriendly = false,
    description = '',
  } = req.body || {};

  if (!ownerId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!name || !location || pricePerMonth === undefined || pricePerMonth === null) {
    return res.status(400).json({
      error: 'Missing required fields: name, location, pricePerMonth',
    });
  }

  const parsedPrice = Number(pricePerMonth);
  if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
    return res.status(400).json({ error: 'Invalid pricePerMonth' });
  }

  const parsedRooms = Number(rooms);
  if (!Number.isInteger(parsedRooms) || parsedRooms < 1) {
    return res.status(400).json({ error: 'Invalid rooms value' });
  }

  if (promotionPercent !== null) {
    const promo = Number(promotionPercent);
    if (!Number.isFinite(promo) || promo < 0 || promo > 100) {
      return res.status(400).json({ error: 'Invalid promotionPercent' });
    }
  }

  const parsedBathrooms = Number(bathrooms);
  if (!Number.isFinite(parsedBathrooms) || parsedBathrooms < 1) {
    return res.status(400).json({ error: 'Invalid bathrooms value' });
  }

  const insertSql = `
    INSERT INTO public.apartments (
      owner_id,
      name,
      description,
      price,
      warranty_deposit,
      coordinates,
      address,
      available_from,
      bedrooms,
      pet_friendly
    )
    VALUES ($1, $2, $3, $4, $5, point(0, 0), $6::jsonb, NOW(), $7, $8)
    RETURNING *
  `;

  const payloadAddress = {
    location,
    bathrooms: parsedBathrooms,
    promotionPercent,
  };

  try {
    const result = await db.query(insertSql, [
      ownerId,
      String(name).trim(),
      String(description ?? ''),
      parsedPrice,
      parsedPrice,
      JSON.stringify(payloadAddress),
      parsedRooms,
      Boolean(petFriendly),
    ]);

    return res.status(201).json({ apartment: result.rows[0] });
  } catch (error) {
    console.error('[apartments/create] ❌', error.message);
    return res.status(500).json({ error: 'Failed to create apartment' });
  }
});

module.exports = router;
