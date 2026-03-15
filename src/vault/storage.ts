import { mkdirSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export function getVaultDir(): string {
  return process.env.MINDCLAUDE_VAULT_DIR || join(homedir(), ".mindclaude", "vault");
}

export function ensureVaultDir(): string {
  const dir = getVaultDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function getProjectVaultDir(project: string): string {
  const dir = join(getVaultDir(), "projects", project);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function getSessionsVaultDir(project: string): string {
  const dir = join(getProjectVaultDir(project), "sessions");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function slugify(title: string): string {
  return title
    .replace(/<[^>]*>/g, "")  // strip HTML tags before slugifying
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function vaultNotePath(project: string, nodeId: string, title: string): string {
  const slug = slugify(title);
  const filename = slug ? `${slug}--${nodeId}.md` : `${nodeId}.md`;
  return join(getProjectVaultDir(project), filename);
}

export function findVaultNoteById(project: string, nodeId: string): string | null {
  const dir = getProjectVaultDir(project);
  if (!existsSync(dir)) return null;
  const suffix = `--${nodeId}.md`;
  const files = readdirSync(dir).filter(f => f.endsWith(suffix));
  return files.length > 0 ? join(dir, files[0]) : null;
}
