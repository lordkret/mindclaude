import { mkdirSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

function getBaseDir(): string {
  return process.env.MINDCLAUDE_DIR || join(homedir(), ".mindclaude", "maps");
}

export function ensureStorageDir(): string {
  const dir = getBaseDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function mapFilePath(name: string): string {
  const sanitized = name.replace(/[^a-zA-Z0-9_\-. ]/g, "_");
  const fileName = sanitized.endsWith(".xmind") ? sanitized : `${sanitized}.xmind`;
  return join(ensureStorageDir(), fileName);
}

export function listMapFiles(): { name: string; path: string; modifiedAt: Date }[] {
  const dir = ensureStorageDir();
  const files = readdirSync(dir).filter((f) => f.endsWith(".xmind"));
  return files.map((f) => {
    const fullPath = join(dir, f);
    const stat = statSync(fullPath);
    return {
      name: f.replace(/\.xmind$/, ""),
      path: fullPath,
      modifiedAt: stat.mtime,
    };
  });
}

export function mapExists(name: string): boolean {
  return existsSync(mapFilePath(name));
}
