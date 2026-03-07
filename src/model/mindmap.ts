import { MindMapDocument, MindMapNode, MindMapSheet, Relationship } from "./types.js";
import { generateShortId } from "./id.js";

export function createDocument(name: string): MindMapDocument {
  const rootId = generateShortId();
  const rootTopic: MindMapNode = {
    id: rootId,
    title: name,
    folded: false,
    children: [],
  };
  const sheetId = generateShortId();
  const sheet: MindMapSheet = {
    id: sheetId,
    title: "Sheet 1",
    rootTopic,
    relationships: [],
  };
  const nodeIndex = new Map<string, MindMapNode>();
  const parentIndex = new Map<string, string>();
  nodeIndex.set(rootId, rootTopic);

  return {
    name,
    sheets: [sheet],
    nodeIndex,
    parentIndex,
    activeSheetIndex: 0,
    focusNodeId: null,
    dirty: true,
  };
}

export function buildIndices(doc: MindMapDocument): void {
  doc.nodeIndex.clear();
  doc.parentIndex.clear();
  for (const sheet of doc.sheets) {
    indexNode(doc, sheet.rootTopic, null);
  }
}

function indexNode(doc: MindMapDocument, node: MindMapNode, parentId: string | null): void {
  doc.nodeIndex.set(node.id, node);
  if (parentId) {
    doc.parentIndex.set(node.id, parentId);
  }
  for (const child of node.children) {
    indexNode(doc, child, node.id);
  }
}

export function activeSheet(doc: MindMapDocument): MindMapSheet {
  return doc.sheets[doc.activeSheetIndex];
}

export function findNode(doc: MindMapDocument, id: string): MindMapNode | undefined {
  return doc.nodeIndex.get(id);
}

export function addNode(
  doc: MindMapDocument,
  parentId: string,
  title: string,
  index?: number
): MindMapNode {
  const parent = doc.nodeIndex.get(parentId);
  if (!parent) throw new Error(`Node not found: ${parentId}`);

  const newNode: MindMapNode = {
    id: generateShortId(),
    title,
    folded: false,
    children: [],
  };

  if (index !== undefined && index >= 0 && index <= parent.children.length) {
    parent.children.splice(index, 0, newNode);
  } else {
    parent.children.push(newNode);
  }

  doc.nodeIndex.set(newNode.id, newNode);
  doc.parentIndex.set(newNode.id, parentId);
  doc.dirty = true;
  return newNode;
}

export function removeNode(doc: MindMapDocument, id: string): void {
  const parentId = doc.parentIndex.get(id);
  if (!parentId) throw new Error(`Cannot remove root node or node not found: ${id}`);

  const parent = doc.nodeIndex.get(parentId);
  if (!parent) throw new Error(`Parent not found: ${parentId}`);

  const idx = parent.children.findIndex((c) => c.id === id);
  if (idx === -1) throw new Error(`Node not found in parent's children: ${id}`);

  const [removed] = parent.children.splice(idx, 1);
  removeFromIndices(doc, removed);

  // Remove relationships referencing removed nodes
  for (const sheet of doc.sheets) {
    sheet.relationships = sheet.relationships.filter(
      (r) => doc.nodeIndex.has(r.end1Id) && doc.nodeIndex.has(r.end2Id)
    );
  }

  doc.dirty = true;
}

function removeFromIndices(doc: MindMapDocument, node: MindMapNode): void {
  doc.nodeIndex.delete(node.id);
  doc.parentIndex.delete(node.id);
  for (const child of node.children) {
    removeFromIndices(doc, child);
  }
}

export function moveNode(
  doc: MindMapDocument,
  nodeId: string,
  newParentId: string,
  index?: number
): void {
  const oldParentId = doc.parentIndex.get(nodeId);
  if (!oldParentId) throw new Error(`Cannot move root node or node not found: ${nodeId}`);

  const oldParent = doc.nodeIndex.get(oldParentId)!;
  const newParent = doc.nodeIndex.get(newParentId);
  if (!newParent) throw new Error(`Target parent not found: ${newParentId}`);

  // Prevent moving a node under itself
  let check: string | undefined = newParentId;
  while (check) {
    if (check === nodeId) throw new Error("Cannot move a node under itself");
    check = doc.parentIndex.get(check);
  }

  const idx = oldParent.children.findIndex((c) => c.id === nodeId);
  const [node] = oldParent.children.splice(idx, 1);

  if (index !== undefined && index >= 0 && index <= newParent.children.length) {
    newParent.children.splice(index, 0, node);
  } else {
    newParent.children.push(node);
  }

  doc.parentIndex.set(nodeId, newParentId);
  doc.dirty = true;
}

export function editNode(
  doc: MindMapDocument,
  id: string,
  updates: { title?: string; notes?: string; labels?: string[]; markers?: string[] }
): MindMapNode {
  const node = doc.nodeIndex.get(id);
  if (!node) throw new Error(`Node not found: ${id}`);

  if (updates.title !== undefined) node.title = updates.title;
  if (updates.notes !== undefined) node.notes = updates.notes;
  if (updates.labels !== undefined) node.labels = updates.labels;
  if (updates.markers !== undefined) node.markers = updates.markers;
  doc.dirty = true;
  return node;
}

export function addRelationship(
  doc: MindMapDocument,
  end1Id: string,
  end2Id: string,
  title?: string
): Relationship {
  if (!doc.nodeIndex.has(end1Id)) throw new Error(`Node not found: ${end1Id}`);
  if (!doc.nodeIndex.has(end2Id)) throw new Error(`Node not found: ${end2Id}`);

  const rel: Relationship = {
    id: generateShortId(),
    end1Id,
    end2Id,
    title,
  };

  activeSheet(doc).relationships.push(rel);
  doc.dirty = true;
  return rel;
}

export function removeRelationship(doc: MindMapDocument, relId: string): void {
  const sheet = activeSheet(doc);
  const idx = sheet.relationships.findIndex((r) => r.id === relId);
  if (idx === -1) throw new Error(`Relationship not found: ${relId}`);
  sheet.relationships.splice(idx, 1);
  doc.dirty = true;
}

export function setFolded(doc: MindMapDocument, id: string, folded: boolean): void {
  const node = doc.nodeIndex.get(id);
  if (!node) throw new Error(`Node not found: ${id}`);
  node.folded = folded;
}

export function countDescendants(node: MindMapNode): number {
  let count = 0;
  for (const child of node.children) {
    count += 1 + countDescendants(child);
  }
  return count;
}

export function findChildByTitle(
  doc: MindMapDocument,
  parentId: string,
  title: string
): MindMapNode | undefined {
  const parent = doc.nodeIndex.get(parentId);
  if (!parent) return undefined;
  return parent.children.find((c) => c.title === title);
}

export function createProjectMap(name: string): MindMapDocument {
  const doc = createDocument(name);
  const rootId = activeSheet(doc).rootTopic.id;
  const contextNode = addNode(doc, rootId, "Context");
  const purposeNode = addNode(doc, contextNode.id, "Project Purpose");
  editNode(doc, purposeNode.id, { notes: "Describe what this project does" });
  addNode(doc, rootId, "Memory");
  addNode(doc, rootId, "Tasks");
  addNode(doc, rootId, "Bugs to fix");
  addNode(doc, rootId, "Features to add");
  addNode(doc, rootId, "Improvements to add");
  addNode(doc, rootId, "Sessions");
  return doc;
}

export function createGlobalMap(): MindMapDocument {
  const doc = createDocument("global");
  const rootId = activeSheet(doc).rootTopic.id;
  addNode(doc, rootId, "Preferences");
  addNode(doc, rootId, "Tools");
  addNode(doc, rootId, "Projects");
  return doc;
}

export function searchNodes(doc: MindMapDocument, query: string): MindMapNode[] {
  const lower = query.toLowerCase();
  const results: MindMapNode[] = [];
  for (const [, node] of doc.nodeIndex) {
    if (
      node.title.toLowerCase().includes(lower) ||
      node.notes?.toLowerCase().includes(lower) ||
      node.labels?.some((l) => l.toLowerCase().includes(lower))
    ) {
      results.push(node);
    }
  }
  return results;
}
