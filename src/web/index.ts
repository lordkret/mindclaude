#!/usr/bin/env node

import express, { Request, Response, NextFunction } from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { timingSafeEqual } from "node:crypto";
import type { Socket } from "node:net";
import { createProxyMiddleware } from "http-proxy-middleware";
import { router } from "./routes.js";
import { ensureStorageDir } from "../storage.js";
import { initGitRepo } from "./git-ops.js";
import { getTerminalPort, killAllTerminals } from "./terminal.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = parseInt(process.env.MINDCLAUDE_PORT || "3917", 10);
const AUTH_USER = process.env.MINDCLAUDE_USER || "";
const AUTH_PASS = process.env.MINDCLAUDE_PASS || "";

function basicAuth(req: Request, res: Response, next: NextFunction): void {
  if (!AUTH_USER || !AUTH_PASS) { next(); return; }

  const header = req.headers.authorization;
  if (!header || !header.startsWith("Basic ")) {
    res.set("WWW-Authenticate", 'Basic realm="MindClaude"');
    res.status(401).send("Authentication required");
    return;
  }

  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const sep = decoded.indexOf(":");
  if (sep === -1) { res.status(401).send("Invalid credentials"); return; }

  const user = decoded.slice(0, sep);
  const pass = decoded.slice(sep + 1);

  const userBuf = Buffer.from(user);
  const passBuf = Buffer.from(pass);
  const expectedUser = Buffer.from(AUTH_USER);
  const expectedPass = Buffer.from(AUTH_PASS);

  const userOk = userBuf.length === expectedUser.length && timingSafeEqual(userBuf, expectedUser);
  const passOk = passBuf.length === expectedPass.length && timingSafeEqual(passBuf, expectedPass);

  if (userOk && passOk) { next(); return; }

  res.set("WWW-Authenticate", 'Basic realm="MindClaude"');
  res.status(401).send("Invalid credentials");
}

async function main() {
  ensureStorageDir();
  await initGitRepo();

  const app = express();

  // Basic auth (enabled when env vars are set)
  app.use(basicAuth);

  // Static files from public/
  const publicDir = join(__dirname, "..", "..", "public");
  app.use(express.static(publicDir));

  // API routes
  app.use("/api", router);

  // Terminal proxy — forward /terminal/:id/* to ttyd on its local port
  app.use("/terminal/:id", (req, res, next) => {
    const port = getTerminalPort(req.params.id);
    if (!port) {
      res.status(404).send("Terminal session not found");
      return;
    }
    const proxy = createProxyMiddleware({
      target: `http://127.0.0.1:${port}`,
      ws: true,
      changeOrigin: true,
    });
    proxy(req, res, next);
  });

  const server = app.listen(PORT, () => {
    console.log(`MindClaude web server running on http://localhost:${PORT}`);
  });

  // Handle WebSocket upgrade for terminal proxy
  server.on("upgrade", (req, socket, head) => {
    // Extract session ID from URL: /terminal/:id/ws
    const match = req.url?.match(/^\/terminal\/([^/]+)/);
    if (!match) return;

    const sessionId = match[1];
    const port = getTerminalPort(sessionId);
    if (!port) {
      socket.destroy();
      return;
    }

    // Check basic auth on WebSocket upgrade if auth is enabled
    if (AUTH_USER && AUTH_PASS) {
      const header = req.headers.authorization;
      if (!header || !header.startsWith("Basic ")) {
        socket.destroy();
        return;
      }
      const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
      const sep = decoded.indexOf(":");
      if (sep === -1) { socket.destroy(); return; }
      const user = decoded.slice(0, sep);
      const pass = decoded.slice(sep + 1);
      const userBuf = Buffer.from(user);
      const passBuf = Buffer.from(pass);
      const expectedUser = Buffer.from(AUTH_USER);
      const expectedPass = Buffer.from(AUTH_PASS);
      const userOk = userBuf.length === expectedUser.length && timingSafeEqual(userBuf, expectedUser);
      const passOk = passBuf.length === expectedPass.length && timingSafeEqual(passBuf, expectedPass);
      if (!userOk || !passOk) { socket.destroy(); return; }
    }

    const proxy = createProxyMiddleware({
      target: `http://127.0.0.1:${port}`,
      ws: true,
      changeOrigin: true,
    });
    proxy.upgrade!(req, socket as Socket, head);
  });

  // Clean up terminal processes on exit
  process.on("SIGTERM", () => { killAllTerminals(); process.exit(0); });
  process.on("SIGINT", () => { killAllTerminals(); process.exit(0); });
}

main().catch((err) => {
  console.error("MindClaude web server error:", err);
  process.exit(1);
});
