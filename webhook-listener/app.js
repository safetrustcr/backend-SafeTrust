import express from "express";
import bodyParser from "body-parser";
import winston from "winston";

const app = express();
const PORT = 3000;

// Middleware to parse JSON body
app.use(bodyParser.json());

// Logger setup
const logger = winston.createLogger({
  level: "info",
  format: winston.format.json(),
  transports: [new winston.transports.Console()],
});

// POST API to listen for escrow transaction events
app.post("/event/escrow-transaction", (req, res) => {
  const eventData = req.body;

  // Log event data
  logger.info("Received escrow transaction event", { eventData });

  res.status(200).json({ message: "Event received" });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
