require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const storageRoutes = require('./routes/storage');

const app = express();

// Middleware
app.use(express.json());
app.use(cors({
  credentials: true,
  origin: true,
}));
app.use(morgan('tiny'));
app.disable('x-powered-by');

// Routes
app.use('/storage', storageRoutes);

// Error handler
app.use((err, req, res, next) => {
  if (err) {
    console.error(err.message);
    console.error(err.stack);
    return res.status(500).json({ error: err.message });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`listening on port ${port}`);
});
