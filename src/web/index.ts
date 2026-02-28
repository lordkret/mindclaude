#!/usr/bin/env node

import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { router } from "./routes.js";
import { ensureStorageDir } from "../storage.js";
import { initGitRepo } from "./git-ops.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = parseInt(process.env.MINDCLAUDE_PORT || "3917", 10);

async function main() {
  ensureStorageDir();
  await initGitRepo();

  const app = express();

  // Static files from public/
  const publicDir = join(__dirname, "..", "..", "public");
  app.use(express.static(publicDir));

  // API routes
  app.use("/api", router);

  app.listen(PORT, () => {
    console.log(`MindClaude web server running on http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error("MindClaude web server error:", err);
  process.exit(1);
});
