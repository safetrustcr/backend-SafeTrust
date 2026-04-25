const app = require('./app');
const port = process.env.WEBHOOK_PORT || 3001;

app.listen(port, () => {
  console.log(`Webhook server listening on port ${port}`);
});
