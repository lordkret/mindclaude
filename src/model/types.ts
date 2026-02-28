export interface MindMapNode {
  id: string; // 8-char short ID
  title: string;
  notes?: string;
  labels?: string[];
  markers?: string[];
  folded: boolean;
  children: MindMapNode[];
}

export interface Relationship {
  id: string;
  end1Id: string; // short ID
  end2Id: string; // short ID
  title?: string;
}

export interface MindMapSheet {
  id: string;
  title: string;
  rootTopic: MindMapNode;
  relationships: Relationship[];
}

export interface MindMapDocument {
  name: string;
  sheets: MindMapSheet[];
  nodeIndex: Map<string, MindMapNode>; // short ID -> node
  parentIndex: Map<string, string>; // child short ID -> parent short ID
  activeSheetIndex: number;
  focusNodeId: string | null;
  dirty: boolean;
}

export interface IdMapper {
  shortToLong: Map<string, string>;
  longToShort: Map<string, string>;
}
