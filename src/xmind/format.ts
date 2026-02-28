// XMind content.json type definitions

export interface XMindContent {
  id: string;
  class: string; // "sheet"
  title: string;
  rootTopic: XMindTopic;
  relationships?: XMindRelationship[];
}

export interface XMindTopic {
  id: string;
  class: string; // "topic"
  title: string;
  structureClass?: string;
  children?: {
    attached?: XMindTopic[];
    detached?: XMindTopic[];
  };
  notes?: {
    plain?: { content: string };
    html?: { content: string };
  };
  labels?: string[];
  markers?: XMindMarker[];
  extensions?: unknown[];
  "branch-folded"?: boolean; // XMind 8+ fold flag (hyphenated key)
}

export interface XMindMarker {
  markerId: string;
}

export interface XMindRelationship {
  id: string;
  end1Id: string;
  end2Id: string;
  title?: string;
}

export interface XMindMetadata {
  creator: {
    name: string;
    version: string;
  };
}

export interface XMindManifest {
  "file-entries": Record<string, string>;
}
