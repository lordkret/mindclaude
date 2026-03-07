import { spawn, execSync, ChildProcess } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
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

// Resolve full path to claude binary — systemd services have a limited PATH
function findClaude(): string {
  // Try common locations
  const candidates = [
    join(homedir(), ".local", "bin", "claude"),
    "/usr/local/bin/claude",
    "/usr/bin/claude",
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  // Fall back to which
  try {
    return execSync("which claude", { encoding: "utf8" }).trim();
  } catch {
    return "claude"; // hope it's on PATH
  }
}

const CLAUDE_PATH = findClaude();

export function createTerminal(claudeArgs?: string[]): { sessionId: string; port: number } {
  const sessionId = generateShortId();
  const port = getRandomPort();
  const basePath = `/terminal/${sessionId}`;

  // Build the command: use bash login shell to get full user environment
  // Everything must be in a single string after "bash -l -c" since -c only
  // takes one argument as the command string.
  const claudeCmd = claudeArgs?.length
    ? `${CLAUDE_PATH} ${claudeArgs.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(" ")}`
    : CLAUDE_PATH;

  const args = [
    "--writable",
    "--port", String(port),
    "--base-path", basePath,
    "bash", "-l", "-c", claudeCmd,
  ];

  console.log(`[terminal] spawning: ttyd ${args.join(" ")}`);

  const proc = spawn("ttyd", args, {
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
    env: {
      ...process.env,
      HOME: homedir(),
      USER: process.env.USER || "rafal",
      SHELL: "/bin/bash",
      TERM: "xterm-256color",
      PATH: `${join(homedir(), ".local", "bin")}:${join(homedir(), ".cargo", "bin")}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`,
    },
  });

  proc.stdout?.on("data", (data: Buffer) => {
    console.log(`[terminal ${sessionId} stdout] ${data.toString().trim()}`);
  });

  proc.stderr?.on("data", (data: Buffer) => {
    console.log(`[terminal ${sessionId} stderr] ${data.toString().trim()}`);
  });

  proc.on("exit", (code, signal) => {
    console.log(`[terminal ${sessionId}] exited code=${code} signal=${signal}`);
    sessions.delete(sessionId);
  });

  proc.on("error", (err) => {
    console.log(`[terminal ${sessionId}] spawn error: ${err.message}`);
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
