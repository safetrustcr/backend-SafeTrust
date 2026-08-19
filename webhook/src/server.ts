import app from './app'

const rawPort = process.env.WEBHOOK_PORT
const port = rawPort ? parseInt(rawPort, 10) : 3001

if (isNaN(port) || port < 1 || port > 65535) {
  console.error(`❌ Invalid WEBHOOK_PORT: "${rawPort}" — must be between 1 and 65535`)
  process.exit(1)
}

app.listen(port, () => {
  console.log(`[api] Webhook service running at http://localhost:${port}`)
})
