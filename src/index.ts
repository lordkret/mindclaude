#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { ensureStorageDir } from "./storage.js";

async function main() {
  ensureStorageDir();
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("MindClaude server error:", err);
  process.exit(1);
});
