import { readFileSync, writeFileSync, readdirSync, unlinkSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { MindMapDocument, MindMapNode } from "../model/types.js";
import { activeSheet, editNode } from "../model/mindmap.js";
import { nodeToMarkdown, markdownToNodeData, isDocumentNode } from "./format.js";
import { getProjectVaultDir, vaultNotePath, findVaultNoteById } from "./storage.js";

export interface SyncResult {
  written: string[];
  updated: string[];
  deleted: string[];
  conflicts: string[];
}

function walkNodes(node: MindMapNode, fn: (n: MindMapNode, parentId: string | undefined, depth: number) => void, parentId?: string, depth = 0): void {
  fn(node, parentId, depth);
  for (const child of node.children) {
    walkNodes(child, fn, node.id, depth + 1);
  }
}

/** Strip the generated content section for comparison (everything after the prose) */
function extractProse(md: string): string {
  const lines = md.split("\n");
  const h1Index = lines.findIndex(l => /^# /.test(l));
  if (h1Index === -1) return "";
  const proseLines: string[] = [];
  for (let i = h1Index + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^\*\*Up:\*\*/.test(line) || /^## /.test(line) || /^- /.test(line)) break;
    proseLines.push(line);
  }
  return proseLines.join("\n").trim();
}

export function syncMapToVault(doc: MindMapDocument, project: string): SyncResult {
  const result: SyncResult = { written: [], updated: [], deleted: [], conflicts: [] };
  const root = activeSheet(doc).rootTopic;
  const vaultNodeIds = new Set<string>();

  walkNodes(root, (node, parentId, depth) => {
    if (!isDocumentNode(node, depth)) return;
    vaultNodeIds.add(node.id);

    const md = nodeToMarkdown(node, project, parentId, doc);
    const expectedPath = vaultNotePath(project, node.id, node.title);

    // Check if file exists at a different path (title changed)
    const existingPath = findVaultNoteById(project, node.id);
    if (existingPath && existingPath !== expectedPath) {
      try { unlinkSync(existingPath); } catch { /* ignore */ }
    }

    // Compare with existing content — only compare prose section
    let shouldWrite = true;
    if (existsSync(expectedPath)) {
      const existing = readFileSync(expectedPath, "utf-8");
      if (extractProse(existing) === extractProse(md) && existing === md) shouldWrite = false;
    }

    if (shouldWrite) {
      writeFileSync(expectedPath, md, "utf-8");
      result.written.push(expectedPath);
    }
  });

  // Delete orphaned vault files
  const projectDir = getProjectVaultDir(project);
  if (existsSync(projectDir)) {
    const files = readdirSync(projectDir).filter(f => f.endsWith(".md"));
    for (const f of files) {
      const idMatch = f.match(/--([a-zA-Z0-9_-]{8})\.md$/);
      if (!idMatch) continue;
      const fileNodeId = idMatch[1];
      if (!vaultNodeIds.has(fileNodeId)) {
        const filePath = join(projectDir, f);
        unlinkSync(filePath);
        result.deleted.push(filePath);
      }
    }
  }

  return result;
}

export function syncVaultToMap(doc: MindMapDocument, project: string): SyncResult {
  const result: SyncResult = { written: [], updated: [], deleted: [], conflicts: [] };
  const projectDir = getProjectVaultDir(project);
  if (!existsSync(projectDir)) return result;

  const files = readdirSync(projectDir).filter(f => f.endsWith(".md"));

  for (const f of files) {
    const filePath = join(projectDir, f);
    const content = readFileSync(filePath, "utf-8");
    const noteData = markdownToNodeData(content);
    if (!noteData) continue;

    const node = doc.nodeIndex.get(noteData.id);
    if (!node) continue;

    // Regenerate what the map would produce to compare prose
    const parentId = doc.parentIndex.get(node.id);
    const mapMd = nodeToMarkdown(node, project, parentId, doc);

    if (extractProse(content) === extractProse(mapMd)) continue;

    // Vault wins on body content and title; map wins on structure
    let changed = false;
    if (noteData.body !== (node.notes || "")) {
      editNode(doc, node.id, { notes: noteData.body || undefined });
      changed = true;
    }
    if (noteData.title && noteData.title !== node.title) {
      editNode(doc, node.id, { title: noteData.title });
      changed = true;
    }

    if (changed) {
      result.updated.push(noteData.id);
      const updatedMd = nodeToMarkdown(node, project, parentId, doc);
      writeFileSync(filePath, updatedMd, "utf-8");
      result.written.push(filePath);
    }
  }

  return result;
}
