import { fetchProperties } from "../services/properties.service.js";

export async function getProperties(req, res) {
  try {
    let { type = "all", limit = 10, offset = 0 } = req.query;

    limit = parseInt(limit);
    offset = parseInt(offset);

    // Validation
    if (!["apartment", "hotel", "all"].includes(type)) {
      return res.status(400).json({
        success: false,
        error: "Invalid type. Must be apartment, hotel, or all",
      });
    }

    if (isNaN(limit) || isNaN(offset)) {
      return res.status(400).json({
        success: false,
        error: "Limit and offset must be numbers",
      });
    }

    if (limit > 100) {
      return res.status(400).json({
        success: false,
        error: "Limit cannot exceed 100",
      });
    }

    const properties = await fetchProperties({
      type,
      limit,
      offset,
    });

    return res.status(200).json({
      success: true,
      data: properties,
      pagination: {
        limit,
        offset,
        count: properties.length,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message || "Internal server error",
    });
  }
}