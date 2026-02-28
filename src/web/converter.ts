import { MindMapDocument, MindMapNode, MindMapSheet, IdMapper } from "../model/types.js";
import { buildIndices, activeSheet } from "../model/mindmap.js";
import { generateShortId } from "../model/id.js";

export interface JsMindNode {
  id: string;
  isroot?: boolean;
  parentid?: string;
  topic: string;
  "data-notes"?: string;
  "data-labels"?: string; // JSON array
  "data-markers"?: string; // JSON array
}

export interface JsMindData {
  meta: { name: string; author: string };
  format: "node_array";
  data: JsMindNode[];
}

export function docToJsMind(doc: MindMapDocument): JsMindData {
  const sheet = activeSheet(doc);
  const nodes: JsMindNode[] = [];
  walkNode(sheet.rootTopic, null, nodes);
  return {
    meta: { name: doc.name, author: "mindclaude" },
    format: "node_array",
    data: nodes,
  };
}

function walkNode(node: MindMapNode, parentId: string | null, out: JsMindNode[]): void {
  const jNode: JsMindNode = {
    id: node.id,
    topic: node.title,
  };
  if (parentId === null) {
    jNode.isroot = true;
  } else {
    jNode.parentid = parentId;
  }
  if (node.notes) jNode["data-notes"] = node.notes;
  if (node.labels && node.labels.length > 0) jNode["data-labels"] = JSON.stringify(node.labels);
  if (node.markers && node.markers.length > 0) jNode["data-markers"] = JSON.stringify(node.markers);
  out.push(jNode);
  for (const child of node.children) {
    walkNode(child, node.id, out);
  }
}

export function jsMindToDoc(
  jsMindData: JsMindData,
  existingDoc: MindMapDocument,
  existingIdMapper?: IdMapper
): { doc: MindMapDocument; idMapper?: IdMapper } {
  const sheet = activeSheet(existingDoc);
  const incomingById = new Map<string, JsMindNode>();
  for (const jNode of jsMindData.data) {
    incomingById.set(jNode.id, jNode);
  }

  const existingIds = new Set(existingDoc.nodeIndex.keys());
  const incomingIds = new Set(incomingById.keys());

  // Find IDs to remove (in existing but not in incoming)
  const toRemove: string[] = [];
  for (const id of existingIds) {
    if (!incomingIds.has(id)) {
      toRemove.push(id);
    }
  }

  // Remove nodes (children first - sort by depth descending)
  const depthOf = (id: string): number => {
    let d = 0;
    let cur = id;
    while (existingDoc.parentIndex.has(cur)) {
      cur = existingDoc.parentIndex.get(cur)!;
      d++;
    }
    return d;
  };
  toRemove.sort((a, b) => depthOf(b) - depthOf(a));
  for (const id of toRemove) {
    const parentId = existingDoc.parentIndex.get(id);
    if (!parentId) continue; // skip root
    const parent = existingDoc.nodeIndex.get(parentId);
    if (!parent) continue;
    const idx = parent.children.findIndex((c) => c.id === id);
    if (idx !== -1) {
      parent.children.splice(idx, 1);
    }
    existingDoc.nodeIndex.delete(id);
    existingDoc.parentIndex.delete(id);
  }

  // Clean up relationships referencing removed nodes
  sheet.relationships = sheet.relationships.filter(
    (r) => existingDoc.nodeIndex.has(r.end1Id) && existingDoc.nodeIndex.has(r.end2Id)
  );

  // Add new nodes
  for (const jNode of jsMindData.data) {
    if (!existingIds.has(jNode.id)) {
      const parentId = jNode.parentid;
      if (!parentId) continue; // new root not supported
      const parent = existingDoc.nodeIndex.get(parentId);
      if (!parent) continue;
      const newNode: MindMapNode = {
        id: jNode.id,
        title: jNode.topic,
        folded: false,
        children: [],
      };
      applyJsMindExtras(newNode, jNode);
      parent.children.push(newNode);
      existingDoc.nodeIndex.set(newNode.id, newNode);
      existingDoc.parentIndex.set(newNode.id, parentId);
    }
  }

  // Update existing nodes: title, reparent, extras
  for (const jNode of jsMindData.data) {
    const node = existingDoc.nodeIndex.get(jNode.id);
    if (!node) continue;

    // Update title
    if (node.title !== jNode.topic) {
      node.title = jNode.topic;
    }

    // Update extras
    applyJsMindExtras(node, jNode);

    // Check reparent
    if (jNode.parentid) {
      const currentParentId = existingDoc.parentIndex.get(jNode.id);
      if (currentParentId && currentParentId !== jNode.parentid) {
        const oldParent = existingDoc.nodeIndex.get(currentParentId);
        const newParent = existingDoc.nodeIndex.get(jNode.parentid);
        if (oldParent && newParent) {
          const idx = oldParent.children.findIndex((c) => c.id === jNode.id);
          if (idx !== -1) {
            const [moved] = oldParent.children.splice(idx, 1);
            newParent.children.push(moved);
            existingDoc.parentIndex.set(jNode.id, jNode.parentid);
          }
        }
      }
    }
  }

  existingDoc.dirty = true;
  // Rebuild indices to ensure consistency
  buildIndices(existingDoc);
  return { doc: existingDoc, idMapper: existingIdMapper };
}

function applyJsMindExtras(node: MindMapNode, jNode: JsMindNode): void {
  node.notes = jNode["data-notes"] || undefined;
  if (jNode["data-labels"]) {
    try { node.labels = JSON.parse(jNode["data-labels"]); } catch { /* ignore */ }
  } else {
    node.labels = undefined;
  }
  if (jNode["data-markers"]) {
    try { node.markers = JSON.parse(jNode["data-markers"]); } catch { /* ignore */ }
  } else {
    node.markers = undefined;
  }
}
