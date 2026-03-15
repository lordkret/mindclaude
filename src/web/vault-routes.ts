import { Router } from "express";
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getVaultDir, getProjectVaultDir } from "../vault/storage.js";
import { markdownToNodeData } from "../vault/format.js";
import { readXMind } from "../xmind/reader.js";
import { writeXMind } from "../xmind/writer.js";
import { mapFilePath, mapExists } from "../storage.js";
import { syncMapToVault, syncVaultToMap } from "../vault/sync.js";
import { vaultCommitAndPush } from "../vault/git-ops.js";
import { gitCommitAndPush } from "./git-ops.js";

const vaultRouter = Router();

// GET /api/vault/ — list all projects with vault directories
vaultRouter.get("/", (_req, res) => {
  const projectsDir = join(getVaultDir(), "projects");
  if (!existsSync(projectsDir)) {
    res.json([]);
    return;
  }
  const entries = readdirSync(projectsDir, { withFileTypes: true });
  const projects = entries
    .filter(e => e.isDirectory())
    .map(e => ({ name: e.name }));
  res.json(projects);
});

// GET /api/vault/:project — list vault notes
vaultRouter.get("/:project", (req, res) => {
  const { project } = req.params;
  const dir = getProjectVaultDir(project);
  if (!existsSync(dir)) {
    res.json([]);
    return;
  }
  const files = readdirSync(dir).filter(f => f.endsWith(".md"));
  const notes = files.map(f => {
    const content = readFileSync(join(dir, f), "utf-8");
    const data = markdownToNodeData(content);
    return {
      filename: f,
      id: data?.id || null,
      title: data?.title || f,
      synced_at: null,
    };
  });
  res.json(notes);
});

// GET /api/vault/:project/:id — read note by node ID
vaultRouter.get("/:project/:id", (req, res) => {
  const { project, id } = req.params;
  const dir = getProjectVaultDir(project);
  if (!existsSync(dir)) {
    res.status(404).json({ error: "Project vault not found" });
    return;
  }
  const suffix = `--${id}.md`;
  const files = readdirSync(dir).filter(f => f.endsWith(suffix));
  if (files.length === 0) {
    res.status(404).json({ error: `Note for node "${id}" not found` });
    return;
  }
  const content = readFileSync(join(dir, files[0]), "utf-8");
  res.type("text/markdown").send(content);
});

// PUT /api/vault/:project/:id — update note content
vaultRouter.put("/:project/:id", async (req, res) => {
  const { project, id } = req.params;
  const { content } = req.body;
  if (typeof content !== "string") {
    res.status(400).json({ error: "content field is required" });
    return;
  }
  const dir = getProjectVaultDir(project);
  const suffix = `--${id}.md`;
  const files = readdirSync(dir).filter(f => f.endsWith(suffix));
  if (files.length === 0) {
    res.status(404).json({ error: `Note for node "${id}" not found` });
    return;
  }
  const filePath = join(dir, files[0]);
  writeFileSync(filePath, content, "utf-8");

  try {
    await vaultCommitAndPush([filePath], `Update vault note ${id}`);
  } catch { /* non-fatal */ }

  res.json({ ok: true });
});

// POST /api/vault/:project/sync — trigger full sync
vaultRouter.post("/:project/sync", async (req, res) => {
  const { project } = req.params;
  if (!mapExists(project)) {
    res.status(404).json({ error: `Map "${project}" not found` });
    return;
  }
  const path = mapFilePath(project);
  const { doc, idMapper } = readXMind(path);

  // Vault→Map
  const v2m = syncVaultToMap(doc, project);
  if (v2m.updated.length > 0) {
    writeXMind(doc, path, idMapper);
    try {
      await gitCommitAndPush(path, project, `Vault sync: ${v2m.updated.length} updates from vault`);
    } catch { /* non-fatal */ }
  }

  // Map→Vault
  const m2v = syncMapToVault(doc, project);
  if (m2v.written.length > 0 || m2v.deleted.length > 0) {
    try {
      await vaultCommitAndPush(m2v.written, `Sync: ${m2v.written.length} written, ${m2v.deleted.length} deleted`);
    } catch { /* non-fatal */ }
  }

  res.json({
    vault_to_map: { updated: v2m.updated.length },
    map_to_vault: { written: m2v.written.length, deleted: m2v.deleted.length },
  });
});

export { vaultRouter };
