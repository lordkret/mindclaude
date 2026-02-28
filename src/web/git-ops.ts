import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ensureStorageDir } from "../storage.js";

function exec(cmd: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd }, (err, stdout, stderr) => {
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

export async function gitCommitAndPush(filePath: string, mapName: string): Promise<string> {
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
  const msg = `Update ${mapName} - ${timestamp}`;
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
