import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { setFolded, searchNodes as searchNodesFn, findNode } from "../model/mindmap.js";
import { renderMap } from "../render/ascii.js";
import { getOpenDoc, getAllOpenDocs } from "./map-lifecycle.js";
import { MindMapDocument } from "../model/types.js";

function getDoc(name?: string): MindMapDocument {
  if (name) {
    const entry = getOpenDoc(name);
    if (!entry) throw new Error(`Map "${name}" is not open.`);
    return entry.doc;
  }
  const first = [...getAllOpenDocs().values()][0];
  if (!first) throw new Error("No maps are open.");
  return first.doc;
}

export function registerNavigationTools(server: McpServer): void {
  server.tool(
    "render_map",
    "Render the current mindmap as ASCII tree",
    { map: z.string().optional().describe("Map name") },
    async ({ map }) => {
      const doc = getDoc(map);
      const ascii = renderMap(doc);
      return { content: [{ type: "text", text: ascii }] };
    }
  );

  server.tool(
    "focus_node",
    "Focus rendering on a specific node (shows only its subtree)",
    {
      node_id: z.string().describe("Short ID of the node to focus on"),
      map: z.string().optional().describe("Map name"),
    },
    async ({ node_id, map }) => {
      const doc = getDoc(map);
      if (!doc.nodeIndex.has(node_id)) {
        return { content: [{ type: "text", text: `Node [${node_id}] not found.` }], isError: true };
      }
      doc.focusNodeId = node_id;
      const ascii = renderMap(doc);
      return { content: [{ type: "text", text: ascii }] };
    }
  );

  server.tool(
    "unfocus",
    "Remove focus, show full map",
    { map: z.string().optional().describe("Map name") },
    async ({ map }) => {
      const doc = getDoc(map);
      doc.focusNodeId = null;
      const ascii = renderMap(doc);
      return { content: [{ type: "text", text: ascii }] };
    }
  );

  server.tool(
    "fold_node",
    "Collapse a node's children",
    {
      node_id: z.string().describe("Short ID of the node to fold"),
      map: z.string().optional().describe("Map name"),
    },
    async ({ node_id, map }) => {
      const doc = getDoc(map);
      setFolded(doc, node_id, true);
      const ascii = renderMap(doc);
      return { content: [{ type: "text", text: `Folded [${node_id}].\n\n${ascii}` }] };
    }
  );

  server.tool(
    "unfold_node",
    "Expand a node's children",
    {
      node_id: z.string().describe("Short ID of the node to unfold"),
      map: z.string().optional().describe("Map name"),
    },
    async ({ node_id, map }) => {
      const doc = getDoc(map);
      setFolded(doc, node_id, false);
      const ascii = renderMap(doc);
      return { content: [{ type: "text", text: `Unfolded [${node_id}].\n\n${ascii}` }] };
    }
  );

  server.tool(
    "switch_sheet",
    "Switch to a different sheet in the mindmap",
    {
      sheet_index: z.number().describe("0-based sheet index"),
      map: z.string().optional().describe("Map name"),
    },
    async ({ sheet_index, map }) => {
      const doc = getDoc(map);
      if (sheet_index < 0 || sheet_index >= doc.sheets.length) {
        return {
          content: [{ type: "text", text: `Invalid sheet index. Map has ${doc.sheets.length} sheet(s).` }],
          isError: true,
        };
      }
      doc.activeSheetIndex = sheet_index;
      doc.focusNodeId = null;
      const ascii = renderMap(doc);
      return { content: [{ type: "text", text: `Switched to sheet "${doc.sheets[sheet_index].title}".\n\n${ascii}` }] };
    }
  );

  server.tool(
    "search_nodes",
    "Search nodes by title, notes, or labels",
    {
      query: z.string().describe("Search query"),
      map: z.string().optional().describe("Map name"),
    },
    async ({ query, map }) => {
      const doc = getDoc(map);
      const results = searchNodesFn(doc, query);
      if (results.length === 0) {
        return { content: [{ type: "text", text: `No nodes matching "${query}".` }] };
      }
      const lines = results.map((n) => {
        const parent = doc.parentIndex.get(n.id);
        const parentLabel = parent ? ` (under [${parent}])` : " (root)";
        return `[${n.id}] ${n.title}${parentLabel}`;
      });
      return { content: [{ type: "text", text: `Found ${results.length} node(s):\n${lines.join("\n")}` }] };
    }
  );
}
