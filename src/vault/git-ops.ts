import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ensureVaultDir } from "./storage.js";

function exec(cmd: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${cmd} ${args.join(" ")} failed: ${stderr || err.message}`));
      else resolve(stdout.trim());
    });
  });
}

export async function initVaultRepo(): Promise<void> {
  const dir = ensureVaultDir();
  if (!existsSync(join(dir, ".git"))) {
    await exec("git", ["init"], dir);
  }
}

export async function vaultCommitAndPush(files: string[], message: string): Promise<string> {
  const dir = ensureVaultDir();
  await initVaultRepo();

  for (const f of files) {
    await exec("git", ["add", f], dir);
  }

  // Also stage deletions
  await exec("git", ["add", "-u"], dir);

  try {
    await exec("git", ["diff", "--cached", "--quiet"], dir);
    return "No changes to commit";
  } catch {
    // staged changes exist
  }

  const commitResult = await exec("git", ["commit", "-m", message], dir);

  let pushResult = "";
  try {
    pushResult = await exec("git", ["push"], dir);
  } catch (e) {
    pushResult = `Push skipped: ${(e as Error).message}`;
  }

  return `${commitResult}\n${pushResult}`;
}

export async function vaultPull(): Promise<string> {
  const dir = ensureVaultDir();
  await initVaultRepo();
  try {
    return await exec("git", ["pull"], dir);
  } catch (e) {
    return `Pull failed: ${(e as Error).message}`;
  }
}
