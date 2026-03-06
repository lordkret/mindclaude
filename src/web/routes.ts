import { Router, json } from "express";
import { listMapFiles, mapFilePath, mapExists } from "../storage.js";
import { readXMind } from "../xmind/reader.js";
import { writeXMind } from "../xmind/writer.js";
import { createDocument, activeSheet, buildIndices } from "../model/mindmap.js";
import { IdMapper } from "../model/types.js";
import { docToJsMind, jsMindToDoc, JsMindData } from "./converter.js";
import { gitCommitAndPush, gitLog, gitShowFile } from "./git-ops.js";
import { unlinkSync, writeFileSync } from "node:fs";
import { createTerminal, listTerminals, killTerminal } from "./terminal.js";

const router = Router();
router.use(json({ limit: "10mb" }));

// GET /api/maps — list all maps
router.get("/maps", (_req, res) => {
  const files = listMapFiles();
  res.json(files.map((f) => ({ name: f.name, modifiedAt: f.modifiedAt.toISOString() })));
});

// GET /api/maps/:name — map as jsMind JSON
router.get("/maps/:name", (req, res) => {
  const { name } = req.params;
  if (!mapExists(name)) {
    res.status(404).json({ error: `Map "${name}" not found` });
    return;
  }
  const path = mapFilePath(name);
  const { doc, idMapper } = readXMind(path);
  const jsMindData = docToJsMind(doc, idMapper);
  res.json(jsMindData);
});

// POST /api/maps — create new map
router.post("/maps", (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== "string") {
    res.status(400).json({ error: "name is required" });
    return;
  }
  if (mapExists(name)) {
    res.status(409).json({ error: `Map "${name}" already exists` });
    return;
  }
  const doc = createDocument(name);
  const path = mapFilePath(name);
  writeXMind(doc, path);
  // Read back to get stable idMapper with long IDs
  const { doc: savedDoc, idMapper: newIdMapper } = readXMind(path);
  const jsMindData = docToJsMind(savedDoc, newIdMapper);
  res.status(201).json(jsMindData);
});

// PUT /api/maps/:name — save jsMind JSON
router.put("/maps/:name", async (req, res) => {
  const { name } = req.params;
  const { comment, ...rest } = req.body;
  // Support both { data, meta, ... } directly and { comment, data, meta, ... }
  const jsMindData: JsMindData = rest.data ? rest : req.body;

  if (!jsMindData || !jsMindData.data || !Array.isArray(jsMindData.data)) {
    res.status(400).json({ error: "Invalid jsMind data" });
    return;
  }

  const path = mapFilePath(name);
  let doc;
  let idMapper;

  if (mapExists(name)) {
    const existing = readXMind(path);
    const existingNodeCount = existing.doc.nodeIndex.size;
    const incomingNodeCount = jsMindData.data.length;
    console.log(`[save] ${name}: incoming=${incomingNodeCount} existing=${existingNodeCount}`);
    // Safety: refuse to save if incoming data would delete >80% of nodes
    if (existingNodeCount > 5 && incomingNodeCount < existingNodeCount * 0.2 && req.query.force !== "true") {
      res.status(400).json({
        error: `Safety: save rejected. Incoming data has ${incomingNodeCount} nodes vs ${existingNodeCount} on disk. Reload and try again.`
      });
      return;
    }
    const result = jsMindToDoc(jsMindData, existing.doc, existing.idMapper);
    doc = result.doc;
    idMapper = result.idMapper;
    const savedNodeCount = doc.nodeIndex.size;
    console.log(`[save] ${name}: after merge=${savedNodeCount} (removed=${existingNodeCount - savedNodeCount + (savedNodeCount - incomingNodeCount)})`);
  } else {
    // New map from jsMind data
    doc = createDocument(name);
    const emptyMapper = { shortToLong: new Map<string, string>(), longToShort: new Map<string, string>() };
    const result = jsMindToDoc(jsMindData, doc, emptyMapper);
    doc = result.doc;
    idMapper = result.idMapper;
  }

  writeXMind(doc, path, idMapper);

  let gitResult = "";
  try {
    gitResult = await gitCommitAndPush(path, name, comment || undefined);
  } catch (e) {
    gitResult = `Git error: ${(e as Error).message}`;
  }

  res.json({ ok: true, git: gitResult });
});

// DELETE /api/maps/:name
router.delete("/maps/:name", (req, res) => {
  const { name } = req.params;
  if (!mapExists(name)) {
    res.status(404).json({ error: `Map "${name}" not found` });
    return;
  }
  const path = mapFilePath(name);
  unlinkSync(path);
  res.json({ ok: true });
});

// GET /api/maps/:name/versions — git log for a map file
router.get("/maps/:name/versions", async (req, res) => {
  const { name } = req.params;
  if (!mapExists(name)) {
    res.status(404).json({ error: `Map "${name}" not found` });
    return;
  }
  const limit = parseInt(req.query.limit as string) || 5;
  const offset = parseInt(req.query.offset as string) || 0;
  const path = mapFilePath(name);
  try {
    const entries = await gitLog(path, limit, offset);
    res.json(entries);
  } catch (e) {
    res.status(500).json({ error: `Git log failed: ${(e as Error).message}` });
  }
});

// POST /api/maps/:name/versions/:sha/restore — restore a previous version
router.post("/maps/:name/versions/:sha/restore", async (req, res) => {
  const { name, sha } = req.params;
  if (!mapExists(name)) {
    res.status(404).json({ error: `Map "${name}" not found` });
    return;
  }
  const path = mapFilePath(name);
  try {
    const fileBuffer = await gitShowFile(path, sha);
    writeFileSync(path, fileBuffer);
    const shortSha = sha.slice(0, 7);
    const commitMsg = `Restore ${name} to ${shortSha}`;
    const gitResult = await gitCommitAndPush(path, name, commitMsg);
    // Read back the restored map to return to client
    const { doc, idMapper } = readXMind(path);
    const jsMindData = docToJsMind(doc, idMapper);
    res.json({ ok: true, git: gitResult, data: jsMindData });
  } catch (e) {
    res.status(500).json({ error: `Restore failed: ${(e as Error).message}` });
  }
});

// GET /api/maps/:name/relationships
router.get("/maps/:name/relationships", (req, res) => {
  const { name } = req.params;
  if (!mapExists(name)) {
    res.status(404).json({ error: `Map "${name}" not found` });
    return;
  }
  const path = mapFilePath(name);
  const { doc } = readXMind(path);
  const sheet = activeSheet(doc);
  res.json(sheet.relationships);
});

// PUT /api/maps/:name/relationships
router.put("/maps/:name/relationships", async (req, res) => {
  const { name } = req.params;
  const relationships = req.body;
  if (!Array.isArray(relationships)) {
    res.status(400).json({ error: "Body must be an array of relationships" });
    return;
  }

  if (!mapExists(name)) {
    res.status(404).json({ error: `Map "${name}" not found` });
    return;
  }

  const path = mapFilePath(name);
  const { doc, idMapper } = readXMind(path);
  const sheet = activeSheet(doc);
  sheet.relationships = relationships;
  doc.dirty = true;
  writeXMind(doc, path, idMapper);

  let gitResult = "";
  try {
    gitResult = await gitCommitAndPush(path, name);
  } catch (e) {
    gitResult = `Git error: ${(e as Error).message}`;
  }

  res.json({ ok: true, git: gitResult });
});

// --- Terminal endpoints ---

// POST /api/terminals — spawn a new ttyd session
// Optional body: { claudeArgs: string[] } e.g. ["--resume"]
router.post("/terminals", (req, res) => {
  try {
    const claudeArgs = req.body?.claudeArgs as string[] | undefined;
    const { sessionId, port } = createTerminal(claudeArgs);
    res.json({ sessionId, path: `/terminal/${sessionId}/`, port });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// GET /api/terminals — list active sessions
router.get("/terminals", (_req, res) => {
  res.json(listTerminals());
});

// DELETE /api/terminals/:id — kill a session
router.delete("/terminals/:id", (req, res) => {
  const killed = killTerminal(req.params.id);
  if (killed) {
    res.json({ ok: true });
  } else {
    res.status(404).json({ error: "Terminal session not found" });
  }
});

export { router };
