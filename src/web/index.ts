#!/usr/bin/env node

import express, { Request, Response, NextFunction } from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { request as httpRequest } from "node:http";
import { connect as netConnect, Socket } from "node:net";
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

  // Global JSON body parser with generous limit
  app.use(express.json({ limit: "50mb" }));

  // Basic auth (enabled when env vars are set)
  app.use(basicAuth);

  // Static files from public/
  const publicDir = join(__dirname, "..", "..", "public");
  app.use(express.static(publicDir));

  // API routes
  app.use("/api", router);

  // Terminal proxy — forward /terminal/:id/* HTTP requests to ttyd
  app.use("/terminal/:id", (req, res) => {
    const port = getTerminalPort(req.params.id);
    console.log(`[proxy] ${req.method} ${req.originalUrl} -> port=${port}`);
    if (!port) {
      res.status(404).send("Terminal session not found");
      return;
    }

    const proxyReq = httpRequest(
      {
        hostname: "127.0.0.1",
        port,
        path: req.originalUrl,
        method: req.method,
        headers: req.headers,
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
        proxyRes.pipe(res);
      }
    );

    proxyReq.on("error", (err) => {
      console.log(`[proxy] error for ${req.originalUrl}: ${err.message}`);
      if (!res.headersSent) res.status(502).send("Terminal proxy error");
    });

    req.pipe(proxyReq);
  });

  const server = app.listen(PORT, () => {
    console.log(`MindClaude web server running on http://localhost:${PORT}`);
  });

  // WebSocket upgrade: raw TCP proxy to ttyd
  // We use a raw TCP connection so the entire HTTP 101 handshake flows
  // through byte-for-byte, preserving Sec-WebSocket-Accept matching.
  server.on("upgrade", (req, socket: Socket, head) => {
    console.log(`[ws-upgrade] ${req.url}`);
    const match = req.url?.match(/^\/terminal\/([^/]+)/);
    if (!match) { socket.destroy(); return; }

    const sessionId = match[1];
    const port = getTerminalPort(sessionId);
    if (!port) { socket.destroy(); return; }

    // Skip auth for terminal WS upgrades — the browser's WebSocket()
    // constructor cannot send Authorization headers. The user already
    // authenticated when loading the terminal HTML page via basic auth.
    console.log(`[ws-upgrade] raw TCP proxy to 127.0.0.1:${port}`);

    const upstream = netConnect(port, "127.0.0.1", () => {
      // Reconstruct the HTTP upgrade request and send it raw to ttyd
      let rawReq = `GET ${req.url} HTTP/1.1\r\n`;
      rawReq += `Host: 127.0.0.1:${port}\r\n`;
      rawReq += `Upgrade: websocket\r\n`;
      rawReq += `Connection: Upgrade\r\n`;
      for (const key of ["sec-websocket-key", "sec-websocket-version", "sec-websocket-protocol", "sec-websocket-extensions"]) {
        const val = req.headers[key];
        if (val) rawReq += `${key}: ${Array.isArray(val) ? val[0] : val}\r\n`;
      }
      rawReq += `\r\n`;

      upstream.write(rawReq);
      if (head.length > 0) upstream.write(head);

      // Now pipe everything bidirectionally — the 101 response from ttyd
      // flows back to Caddy with the correct Sec-WebSocket-Accept intact
      upstream.pipe(socket);
      socket.pipe(upstream);
    });

    upstream.on("error", (err) => {
      console.log(`[ws-upgrade] upstream error: ${err.message}`);
      socket.destroy();
    });
    socket.on("error", () => upstream.destroy());
    upstream.on("close", () => socket.destroy());
    socket.on("close", () => upstream.destroy());
  });

  // Clean up terminal processes on exit
  process.on("SIGTERM", () => { killAllTerminals(); process.exit(0); });
  process.on("SIGINT", () => { killAllTerminals(); process.exit(0); });
}

main().catch((err) => {
  console.error("MindClaude web server error:", err);
  process.exit(1);
});
