import AdmZip from "adm-zip";
import { MindMapDocument, MindMapNode, MindMapSheet, Relationship, IdMapper } from "../model/types.js";
import { XMindContent, XMindTopic, XMindRelationship, XMindMetadata, XMindManifest } from "./format.js";
import { generateShortId } from "../model/id.js";

export function writeXMind(doc: MindMapDocument, filePath: string, idMapper?: IdMapper): void {
  const mapper = idMapper || { shortToLong: new Map(), longToShort: new Map() };

  const content: XMindContent[] = doc.sheets.map((sheet) => ({
    id: resolveLongId(mapper, sheet.id),
    class: "sheet",
    title: sheet.title,
    rootTopic: convertToXMindTopic(sheet.rootTopic, mapper),
    relationships: sheet.relationships.map((r) => convertToXMindRelationship(r, mapper)),
  }));

  const metadata: XMindMetadata = {
    creator: {
      name: "mindclaude",
      version: "0.1.0",
    },
  };

  const manifest: XMindManifest = {
    "file-entries": {
      "content.json": "",
      "metadata.json": "",
    },
  };

  const zip = new AdmZip();
  zip.addFile("content.json", Buffer.from(JSON.stringify(content, null, 2), "utf8"));
  zip.addFile("metadata.json", Buffer.from(JSON.stringify(metadata, null, 2), "utf8"));
  zip.addFile("manifest.json", Buffer.from(JSON.stringify(manifest, null, 2), "utf8"));
  zip.writeZip(filePath);

  doc.dirty = false;
}

function resolveLongId(mapper: IdMapper, shortId: string): string {
  const existing = mapper.shortToLong.get(shortId);
  if (existing) return existing;
  const longId = generateXMindId();
  mapper.shortToLong.set(shortId, longId);
  mapper.longToShort.set(longId, shortId);
  return longId;
}

function generateXMindId(): string {
  // XMind uses 26-char IDs like "1a2b3c4d5e6f7g8h9i0j1k2l3m"
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < 26; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

function convertToXMindTopic(node: MindMapNode, mapper: IdMapper): XMindTopic {
  const topic: XMindTopic = {
    id: resolveLongId(mapper, node.id),
    class: "topic",
    title: node.title,
  };

  if (node.children.length > 0) {
    topic.children = {
      attached: node.children.map((c) => convertToXMindTopic(c, mapper)),
    };
  }

  if (node.notes) {
    topic.notes = {
      plain: { content: node.notes },
    };
  }

  if (node.labels && node.labels.length > 0) {
    topic.labels = node.labels;
  }

  if (node.markers && node.markers.length > 0) {
    topic.markers = node.markers.map((m) => ({ markerId: m }));
  }

  if (node.folded) {
    topic["branch-folded"] = true;
  }

  return topic;
}

function convertToXMindRelationship(rel: Relationship, mapper: IdMapper): XMindRelationship {
  const xRel: XMindRelationship = {
    id: resolveLongId(mapper, rel.id),
    end1Id: resolveLongId(mapper, rel.end1Id),
    end2Id: resolveLongId(mapper, rel.end2Id),
  };
  if (rel.title) {
    xRel.title = rel.title;
  }
  return xRel;
}
