import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { addRelationship, removeRelationship, activeSheet } from "../model/mindmap.js";
import { renderMap } from "../render/ascii.js";
import { getOpenDoc, getAllOpenDocs } from "./map-lifecycle.js";

function getDoc(name?: string) {
  if (name) {
    const entry = getOpenDoc(name);
    if (!entry) throw new Error(`Map "${name}" is not open.`);
    return entry.doc;
  }
  const first = [...getAllOpenDocs().values()][0];
  if (!first) throw new Error("No maps are open.");
  return first.doc;
}

export function registerRelationshipTools(server: McpServer): void {
  server.tool(
    "add_link",
    "Create a cross-link between two nodes",
    {
      end1_id: z.string().describe("Short ID of first node"),
      end2_id: z.string().describe("Short ID of second node"),
      title: z.string().optional().describe("Label for the relationship"),
      map: z.string().optional().describe("Map name"),
    },
    async ({ end1_id, end2_id, title, map }) => {
      const doc = getDoc(map);
      const rel = addRelationship(doc, end1_id, end2_id, title);
      const ascii = renderMap(doc);
      return { content: [{ type: "text", text: `Created link [${rel.id}] between [${end1_id}] and [${end2_id}].\n\n${ascii}` }] };
    }
  );

  server.tool(
    "remove_link",
    "Remove a cross-link",
    {
      link_id: z.string().describe("Short ID of the relationship to remove"),
      map: z.string().optional().describe("Map name"),
    },
    async ({ link_id, map }) => {
      const doc = getDoc(map);
      removeRelationship(doc, link_id);
      const ascii = renderMap(doc);
      return { content: [{ type: "text", text: `Removed link [${link_id}].\n\n${ascii}` }] };
    }
  );

  server.tool(
    "list_links",
    "List all cross-links in the active sheet",
    { map: z.string().optional().describe("Map name") },
    async ({ map }) => {
      const doc = getDoc(map);
      const sheet = activeSheet(doc);
      if (sheet.relationships.length === 0) {
        return { content: [{ type: "text", text: "No cross-links in this sheet." }] };
      }
      const lines = sheet.relationships.map((r) => {
        const n1 = doc.nodeIndex.get(r.end1Id);
        const n2 = doc.nodeIndex.get(r.end2Id);
        const titlePart = r.title ? ` "${r.title}"` : "";
        return `[${r.id}] [${r.end1Id}] ${n1?.title || "?"} <--${titlePart}--> [${r.end2Id}] ${n2?.title || "?"}`;
      });
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );
}
