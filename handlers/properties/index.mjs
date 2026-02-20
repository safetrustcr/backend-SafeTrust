import express from "express";
import { getProperties } from "../../services/properties.service.mjs";

const router = express.Router();

router.get("/api/properties", async (req, res) => {
  try {
    const type = req.query.type || "all";
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const offset = parseInt(req.query.offset) || 0;

    if (!["apartment", "hotel", "all"].includes(type)) {
      return res.status(400).json({
        success: false,
        error: "Invalid type filter",
      });
    }

    const properties = await getProperties({ type, limit, offset });

    return res.json({
      success: true,
      data: properties,
      pagination: { limit, offset },
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch properties",
    });
  }
});

export default router;
