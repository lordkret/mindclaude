import AdmZip from "adm-zip";
import { XMindContent, XMindTopic, XMindRelationship } from "./format.js";
import { MindMapDocument, MindMapNode, MindMapSheet, Relationship, IdMapper } from "../model/types.js";
import { createIdMapper, mapId } from "../model/id.js";
import { buildIndices } from "../model/mindmap.js";

export function readXMind(filePath: string): { doc: MindMapDocument; idMapper: IdMapper } {
  const zip = new AdmZip(filePath);
  const contentEntry = zip.getEntry("content.json");
  if (!contentEntry) throw new Error("Invalid XMind file: missing content.json");

  const contentJson = contentEntry.getData().toString("utf8");
  const sheets: XMindContent[] = JSON.parse(contentJson);

  if (!Array.isArray(sheets) || sheets.length === 0) {
    throw new Error("Invalid XMind file: content.json must be a non-empty array");
  }

  const idMapper = createIdMapper();

  const mappedSheets: MindMapSheet[] = sheets.map((xSheet) => {
    const rootTopic = convertTopic(xSheet.rootTopic, idMapper);
    const relationships = (xSheet.relationships || []).map((xRel) =>
      convertRelationship(xRel, idMapper)
    );
    return {
      id: mapId(idMapper, xSheet.id),
      title: xSheet.title,
      rootTopic,
      relationships,
    };
  });

  // Extract name from file path
  const name = filePath.split("/").pop()?.replace(/\.xmind$/, "") || "untitled";

  const doc: MindMapDocument = {
    name,
    sheets: mappedSheets,
    nodeIndex: new Map(),
    parentIndex: new Map(),
    activeSheetIndex: 0,
    focusNodeId: null,
    dirty: false,
  };

  buildIndices(doc);
  return { doc, idMapper };
}

function convertTopic(xTopic: XMindTopic, idMapper: IdMapper): MindMapNode {
  const shortId = mapId(idMapper, xTopic.id);
  const children: MindMapNode[] = [];

  if (xTopic.children?.attached) {
    for (const child of xTopic.children.attached) {
      children.push(convertTopic(child, idMapper));
    }
  }

  const node: MindMapNode = {
    id: shortId,
    title: xTopic.title,
    folded: xTopic["branch-folded"] === true,
    children,
  };

  if (xTopic.notes?.plain?.content) {
    node.notes = xTopic.notes.plain.content;
  }
  if (xTopic.labels && xTopic.labels.length > 0) {
    node.labels = xTopic.labels;
  }
  if (xTopic.markers && xTopic.markers.length > 0) {
    node.markers = xTopic.markers.map((m) => m.markerId);
  }

  return node;
}

function convertRelationship(xRel: XMindRelationship, idMapper: IdMapper): Relationship {
  return {
    id: mapId(idMapper, xRel.id),
    end1Id: mapId(idMapper, xRel.end1Id),
    end2Id: mapId(idMapper, xRel.end2Id),
    title: xRel.title,
  };
}
