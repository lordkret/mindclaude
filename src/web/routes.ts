import { Router, json } from "express";
import { listMapFiles, mapFilePath, mapExists } from "../storage.js";
import { readXMind } from "../xmind/reader.js";
import { writeXMind } from "../xmind/writer.js";
import { createDocument, activeSheet, buildIndices } from "../model/mindmap.js";
import { docToJsMind, jsMindToDoc, JsMindData } from "./converter.js";
import { gitCommitAndPush } from "./git-ops.js";
import { unlinkSync } from "node:fs";

const router = Router();
router.use(json());

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
  const { doc } = readXMind(path);
  const jsMindData = docToJsMind(doc);
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
  const jsMindData = docToJsMind(doc);
  res.status(201).json(jsMindData);
});

// PUT /api/maps/:name — save jsMind JSON
router.put("/maps/:name", async (req, res) => {
  const { name } = req.params;
  const jsMindData: JsMindData = req.body;

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
  } else {
    // New map from jsMind data
    doc = createDocument(name);
    const result = jsMindToDoc(jsMindData, doc);
    doc = result.doc;
    idMapper = result.idMapper;
  }

  writeXMind(doc, path, idMapper);

  let gitResult = "";
  try {
    gitResult = await gitCommitAndPush(path, name);
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

export { router };
