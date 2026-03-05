#!/usr/bin/env node

import express, { Request, Response, NextFunction } from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { request as httpRequest } from "node:http";
import type { Socket } from "node:net";
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

function checkAuth(headers: Record<string, string | string[] | undefined>): boolean {
  if (!AUTH_USER || !AUTH_PASS) return true;
  const header = headers.authorization;
  if (!header || typeof header !== "string" || !header.startsWith("Basic ")) return false;
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const sep = decoded.indexOf(":");
  if (sep === -1) return false;
  const user = decoded.slice(0, sep);
  const pass = decoded.slice(sep + 1);
  const userBuf = Buffer.from(user);
  const passBuf = Buffer.from(pass);
  const expectedUser = Buffer.from(AUTH_USER);
  const expectedPass = Buffer.from(AUTH_PASS);
  const userOk = userBuf.length === expectedUser.length && timingSafeEqual(userBuf, expectedUser);
  const passOk = passBuf.length === expectedPass.length && timingSafeEqual(passBuf, expectedPass);
  return userOk && passOk;
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
  // Express has NOT sent a 101 yet — we get the raw socket and must handle
  // the full upgrade handshake ourselves by proxying to ttyd.
  server.on("upgrade", (req, socket: Socket, head) => {
    console.log(`[ws-upgrade] ${req.url}`);
    const match = req.url?.match(/^\/terminal\/([^/]+)/);
    if (!match) { socket.destroy(); return; }

    const sessionId = match[1];
    const port = getTerminalPort(sessionId);
    if (!port) { socket.destroy(); return; }

    if (!checkAuth(req.headers)) { console.log("[ws-upgrade] auth failed"); socket.destroy(); return; }

    // Build the raw HTTP upgrade request to send to ttyd
    const upstreamHeaders: Record<string, string> = {
      "Host": `127.0.0.1:${port}`,
      "Upgrade": "websocket",
      "Connection": "Upgrade",
    };
    for (const key of ["sec-websocket-key", "sec-websocket-version", "sec-websocket-protocol", "sec-websocket-extensions"]) {
      const val = req.headers[key];
      if (val) upstreamHeaders[key] = Array.isArray(val) ? val[0] : val;
    }

    console.log(`[ws-upgrade] proxying to 127.0.0.1:${port}`);

    const proxyReq = httpRequest({
      hostname: "127.0.0.1",
      port,
      path: req.url,
      method: "GET",
      headers: upstreamHeaders,
    });

    proxyReq.on("upgrade", (_proxyRes, proxySocket, proxyHead) => {
      console.log(`[ws-upgrade] ttyd accepted upgrade`);

      // Write the raw 101 response from ttyd back to the client socket
      // We need to construct it from the proxyRes
      let response = `HTTP/1.1 101 Switching Protocols\r\n`;
      response += `Upgrade: websocket\r\n`;
      response += `Connection: Upgrade\r\n`;
      if (_proxyRes.headers["sec-websocket-accept"]) {
        response += `Sec-WebSocket-Accept: ${_proxyRes.headers["sec-websocket-accept"]}\r\n`;
      }
      if (_proxyRes.headers["sec-websocket-protocol"]) {
        response += `Sec-WebSocket-Protocol: ${_proxyRes.headers["sec-websocket-protocol"]}\r\n`;
      }
      response += `\r\n`;

      socket.write(response);
      if (proxyHead.length > 0) socket.write(proxyHead);

      // Bidirectional pipe — raw WebSocket frames flow through
      proxySocket.pipe(socket);
      socket.pipe(proxySocket);

      proxySocket.on("error", () => socket.destroy());
      socket.on("error", () => proxySocket.destroy());
      proxySocket.on("close", () => socket.destroy());
      socket.on("close", () => proxySocket.destroy());
    });

    proxyReq.on("response", (res) => {
      console.log(`[ws-upgrade] ttyd returned HTTP ${res.statusCode} instead of upgrade`);
      socket.destroy();
    });

    proxyReq.on("error", (err) => {
      console.log(`[ws-upgrade] proxy error: ${err.message}`);
      socket.destroy();
    });

    // Send any buffered head data
    if (head.length > 0) proxyReq.write(head);
    proxyReq.end();
  });

  // Clean up terminal processes on exit
  process.on("SIGTERM", () => { killAllTerminals(); process.exit(0); });
  process.on("SIGINT", () => { killAllTerminals(); process.exit(0); });
}

main().catch((err) => {
  console.error("MindClaude web server error:", err);
  process.exit(1);
});
