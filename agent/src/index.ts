#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createBookingAgentServer } from './server';

async function main(): Promise<void> {
  const secretKey = process.env.STELLAR_SECRET_KEY?.trim();
  if (!secretKey) {
    process.stderr.write(
      'Error: STELLAR_SECRET_KEY environment variable is required.\n'
    );
    process.exit(1);
  }

  const { server } = createBookingAgentServer({
    secretKey,
    apiBaseUrl: process.env.SAFETRUST_API_URL,
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Fatal MCP server error: ${message}\n`);
  process.exit(1);
});
