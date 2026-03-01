import { MindMapDocument, MindMapNode, IdMapper } from "../model/types.js";
import { buildIndices, activeSheet } from "../model/mindmap.js";

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

/**
 * Convert doc to jsMind format using stable XMind long IDs.
 * This ensures IDs are consistent across stateless reads.
 */
export function docToJsMind(doc: MindMapDocument, idMapper: IdMapper): JsMindData {
  const sheet = activeSheet(doc);
  const nodes: JsMindNode[] = [];
  walkNode(sheet.rootTopic, null, nodes, idMapper);
  return {
    meta: { name: doc.name, author: "mindclaude" },
    format: "node_array",
    data: nodes,
  };
}

function toLongId(shortId: string, idMapper: IdMapper): string {
  return idMapper.shortToLong.get(shortId) || shortId;
}

function toShortId(longId: string, idMapper: IdMapper): string {
  return idMapper.longToShort.get(longId) || longId;
}

function walkNode(node: MindMapNode, parentShortId: string | null, out: JsMindNode[], idMapper: IdMapper): void {
  const longId = toLongId(node.id, idMapper);
  const jNode: JsMindNode = {
    id: longId,
    topic: node.title,
  };
  if (parentShortId === null) {
    jNode.isroot = true;
  } else {
    jNode.parentid = toLongId(parentShortId, idMapper);
  }
  if (node.notes) jNode["data-notes"] = node.notes;
  if (node.labels && node.labels.length > 0) jNode["data-labels"] = JSON.stringify(node.labels);
  if (node.markers && node.markers.length > 0) jNode["data-markers"] = JSON.stringify(node.markers);
  out.push(jNode);
  for (const child of node.children) {
    walkNode(child, node.id, out, idMapper);
  }
}

/**
 * Apply jsMind data (with long IDs) back to an existing doc.
 * Converts long IDs to short IDs using the idMapper before reconciliation.
 */
export function jsMindToDoc(
  jsMindData: JsMindData,
  existingDoc: MindMapDocument,
  idMapper: IdMapper
): { doc: MindMapDocument; idMapper: IdMapper } {
  const sheet = activeSheet(existingDoc);

  // Convert incoming long IDs to short IDs
  const translated: JsMindNode[] = jsMindData.data.map((jNode) => ({
    ...jNode,
    id: toShortId(jNode.id, idMapper),
    parentid: jNode.parentid ? toShortId(jNode.parentid, idMapper) : undefined,
  }));

  const incomingById = new Map<string, JsMindNode>();
  for (const jNode of translated) {
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

  // Add new nodes (these have long IDs not in idMapper — generate new short IDs for them)
  for (const jNode of translated) {
    if (!existingIds.has(jNode.id)) {
      const parentId = jNode.parentid;
      if (!parentId) continue;
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
  for (const jNode of translated) {
    const node = existingDoc.nodeIndex.get(jNode.id);
    if (!node) continue;

    if (node.title !== jNode.topic) {
      node.title = jNode.topic;
    }

    applyJsMindExtras(node, jNode);

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
  buildIndices(existingDoc);
  return { doc: existingDoc, idMapper };
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
