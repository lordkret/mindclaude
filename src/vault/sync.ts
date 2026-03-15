import { readFileSync, writeFileSync, readdirSync, unlinkSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { MindMapDocument, MindMapNode } from "../model/types.js";
import { activeSheet, addNode, editNode } from "../model/mindmap.js";
import { nodeToMarkdown, markdownToNodeData } from "./format.js";
import { getProjectVaultDir, vaultNotePath, findVaultNoteById, slugify } from "./storage.js";

export interface SyncResult {
  written: string[];
  updated: string[];
  deleted: string[];
  conflicts: string[];
}

function hasVaultMarker(node: MindMapNode): boolean {
  return (node.markers || []).some(m => m === "vault:true");
}

function walkNodes(node: MindMapNode, fn: (n: MindMapNode, parentId: string | undefined) => void, parentId?: string): void {
  fn(node, parentId);
  for (const child of node.children) {
    walkNodes(child, fn, node.id);
  }
}

export function syncMapToVault(doc: MindMapDocument, project: string): SyncResult {
  const result: SyncResult = { written: [], updated: [], deleted: [], conflicts: [] };
  const root = activeSheet(doc).rootTopic;
  const vaultNodeIds = new Set<string>();

  // Walk doc, find nodes with vault:true marker
  walkNodes(root, (node, parentId) => {
    if (!hasVaultMarker(node)) return;
    vaultNodeIds.add(node.id);

    const md = nodeToMarkdown(node, project, parentId, doc);
    const expectedPath = vaultNotePath(project, node.id, node.title);

    // Check if file exists at a different path (title changed)
    const existingPath = findVaultNoteById(project, node.id);
    if (existingPath && existingPath !== expectedPath) {
      // Title changed — remove old file, write new
      try { unlinkSync(existingPath); } catch { /* ignore */ }
    }

    // Compare with existing content
    let shouldWrite = true;
    if (existsSync(expectedPath)) {
      const existing = readFileSync(expectedPath, "utf-8");
      // Compare body content (skip synced_at in comparison)
      const existingClean = existing.replace(/^synced_at:.*$/m, "");
      const newClean = md.replace(/^synced_at:.*$/m, "");
      if (existingClean === newClean) shouldWrite = false;
    }

    if (shouldWrite) {
      writeFileSync(expectedPath, md, "utf-8");
      result.written.push(expectedPath);
    }
  });

  // Delete orphaned vault files (ID no longer in map or lost vault:true)
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
  const root = activeSheet(doc).rootTopic;

  for (const f of files) {
    const filePath = join(projectDir, f);
    const content = readFileSync(filePath, "utf-8");
    const noteData = markdownToNodeData(content);
    if (!noteData) continue;

    const node = doc.nodeIndex.get(noteData.id);
    if (!node) {
      // New vault file without matching node — create under root with vault:orphan label
      const newNode = addNode(doc, root.id, noteData.title);
      const markers = ["vault:true"];
      const labels = [...(noteData.labels || []), "vault:orphan"];
      editNode(doc, newNode.id, {
        notes: noteData.body || undefined,
        labels,
        markers,
      });
      result.updated.push(noteData.id);
      continue;
    }

    // Check if vault file is newer than synced_at
    const fileStat = statSync(filePath);
    const syncedAt = noteData.synced_at ? new Date(noteData.synced_at) : new Date(0);
    if (fileStat.mtime <= syncedAt) continue;

    // Vault wins on body content, map wins on structure
    let changed = false;
    if (noteData.body && noteData.body !== (node.notes || "")) {
      editNode(doc, node.id, { notes: noteData.body });
      changed = true;
    }
    if (noteData.title && noteData.title !== node.title) {
      editNode(doc, node.id, { title: noteData.title });
      changed = true;
    }
    // Sync labels from vault
    if (noteData.labels.length > 0) {
      editNode(doc, node.id, { labels: noteData.labels });
      changed = true;
    }

    if (changed) {
      result.updated.push(noteData.id);
      // Re-write the file with updated synced_at
      const parentId = doc.parentIndex.get(node.id);
      const updatedMd = nodeToMarkdown(node, project, parentId, doc);
      writeFileSync(filePath, updatedMd, "utf-8");
      result.written.push(filePath);
    }
  }

  return result;
}
