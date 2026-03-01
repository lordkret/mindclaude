import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { ensureStorageDir } from "../storage.js";

function exec(cmd: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`${cmd} ${args.join(" ")} failed: ${stderr || err.message}`));
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

export async function initGitRepo(): Promise<void> {
  const dir = ensureStorageDir();
  if (!existsSync(join(dir, ".git"))) {
    await exec("git", ["init"], dir);
  }
}

export async function gitCommitAndPush(filePath: string, mapName: string, message?: string): Promise<string> {
  const dir = ensureStorageDir();
  await initGitRepo();
  await exec("git", ["add", filePath], dir);

  // Check if there's anything to commit
  try {
    await exec("git", ["diff", "--cached", "--quiet"], dir);
    return "No changes to commit";
  } catch {
    // diff --cached --quiet exits 1 when there are staged changes
  }

  const timestamp = new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "Z");
  const msg = message || `Update ${mapName} - ${timestamp}`;
  const commitResult = await exec("git", ["commit", "-m", msg], dir);

  // Push (non-fatal if it fails)
  let pushResult = "";
  try {
    pushResult = await exec("git", ["push"], dir);
  } catch (e) {
    pushResult = `Push skipped: ${(e as Error).message}`;
  }

  return `${commitResult}\n${pushResult}`;
}

export async function gitPull(): Promise<string> {
  const dir = ensureStorageDir();
  await initGitRepo();
  try {
    return await exec("git", ["pull"], dir);
  } catch (e) {
    return `Pull failed: ${(e as Error).message}`;
  }
}

export interface GitLogEntry {
  sha: string;
  message: string;
  date: string;
  author: string;
}

export async function gitLog(filePath: string, limit: number = 5, offset: number = 0): Promise<GitLogEntry[]> {
  const dir = ensureStorageDir();
  await initGitRepo();
  const skip = offset;
  const relPath = relative(dir, filePath);
  const output = await exec("git", [
    "log",
    `--max-count=${limit}`,
    `--skip=${skip}`,
    "--format=%H%n%s%n%aI%n%an%n---",
    "--",
    relPath,
  ], dir);

  if (!output) return [];

  const entries: GitLogEntry[] = [];
  const blocks = output.split("\n---\n");
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    const lines = trimmed.split("\n");
    if (lines.length < 4) continue;
    entries.push({
      sha: lines[0],
      message: lines[1],
      date: lines[2],
      author: lines[3],
    });
  }
  return entries;
}

export async function gitShowFile(filePath: string, sha: string): Promise<Buffer> {
  const dir = ensureStorageDir();
  await initGitRepo();
  const relPath = relative(dir, filePath);
  return new Promise((resolve, reject) => {
    execFile("git", ["show", `${sha}:${relPath}`], { cwd: dir, maxBuffer: 10 * 1024 * 1024, encoding: "buffer" }, (err, stdout) => {
      if (err) {
        reject(new Error(`git show failed: ${err.message}`));
      } else {
        resolve(stdout as unknown as Buffer);
      }
    });
  });
}
