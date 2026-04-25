require('dotenv').config();

const { createApp } = require('./app');

const port = Number(process.env.WEBHOOK_PORT || process.env.PORT || 3001);
const app = createApp();

const server = app.listen(port, () => {
  console.log(`[server] listening on ${port}`);
});

server.on('error', (err) => {
  console.error('[server] failed to start', err);
  process.exit(1);
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    console.log(`[server] ${sig} received, shutting down`);
    server.close(() => process.exit(0));
  });
}

