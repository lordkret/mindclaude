import { spawn, ChildProcess } from "node:child_process";
import { generateShortId } from "../model/id.js";

export interface TerminalSession {
  port: number;
  process: ChildProcess;
  createdAt: string;
}

const sessions = new Map<string, TerminalSession>();

// Port range for ttyd instances
const PORT_MIN = 10000;
const PORT_MAX = 11000;

function getRandomPort(): number {
  const usedPorts = new Set([...sessions.values()].map((s) => s.port));
  for (let i = 0; i < 100; i++) {
    const port = PORT_MIN + Math.floor(Math.random() * (PORT_MAX - PORT_MIN));
    if (!usedPorts.has(port)) return port;
  }
  throw new Error("No available ports for terminal session");
}

export function createTerminal(): { sessionId: string; port: number } {
  const sessionId = generateShortId();
  const port = getRandomPort();
  const basePath = `/terminal/${sessionId}`;

  const proc = spawn("ttyd", [
    "--port", String(port),
    "--base-path", basePath,
    "claude",
  ], {
    stdio: "ignore",
    detached: false,
  });

  proc.on("exit", () => {
    sessions.delete(sessionId);
  });

  proc.on("error", () => {
    sessions.delete(sessionId);
  });

  sessions.set(sessionId, {
    port,
    process: proc,
    createdAt: new Date().toISOString(),
  });

  return { sessionId, port };
}

export function listTerminals(): Array<{ sessionId: string; createdAt: string }> {
  return [...sessions.entries()].map(([id, s]) => ({
    sessionId: id,
    createdAt: s.createdAt,
  }));
}

export function getTerminalPort(sessionId: string): number | undefined {
  return sessions.get(sessionId)?.port;
}

export function killTerminal(sessionId: string): boolean {
  const session = sessions.get(sessionId);
  if (!session) return false;
  session.process.kill();
  sessions.delete(sessionId);
  return true;
}

export function killAllTerminals(): void {
  for (const [id, session] of sessions) {
    session.process.kill();
    sessions.delete(id);
  }
}
