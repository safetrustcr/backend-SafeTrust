require('dotenv').config();

const { createApp } = require('./app');

const port = Number(process.env.WEBHOOK_PORT || process.env.PORT || 3001);
const app = createApp();

app.listen(port, () => {
  console.log(`[server] listening on ${port}`);
});

