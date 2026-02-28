import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { addNode, removeNode, moveNode, editNode } from "../model/mindmap.js";
import { MindMapDocument } from "../model/types.js";
import { renderMap } from "../render/ascii.js";
import { getOpenDoc, getAllOpenDocs } from "./map-lifecycle.js";

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

export function registerNodeTools(server: McpServer): void {
  server.tool(
    "add_node",
    "Add a child node to a parent node",
    {
      parent_id: z.string().describe("Short ID of the parent node"),
      title: z.string().describe("Title for the new node"),
      index: z.number().optional().describe("Position among siblings (0-based)"),
      map: z.string().optional().describe("Map name (defaults to first open map)"),
    },
    async ({ parent_id, title, index, map }) => {
      const doc = getDoc(map);
      const node = addNode(doc, parent_id, title, index);
      const ascii = renderMap(doc);
      return { content: [{ type: "text", text: `Added node [${node.id}] "${title}".\n\n${ascii}` }] };
    }
  );

  server.tool(
    "remove_node",
    "Remove a node and all its descendants",
    {
      node_id: z.string().describe("Short ID of the node to remove"),
      map: z.string().optional().describe("Map name"),
    },
    async ({ node_id, map }) => {
      const doc = getDoc(map);
      removeNode(doc, node_id);
      const ascii = renderMap(doc);
      return { content: [{ type: "text", text: `Removed node [${node_id}].\n\n${ascii}` }] };
    }
  );

  server.tool(
    "move_node",
    "Move a node to a new parent",
    {
      node_id: z.string().describe("Short ID of the node to move"),
      new_parent_id: z.string().describe("Short ID of the new parent"),
      index: z.number().optional().describe("Position among new siblings"),
      map: z.string().optional().describe("Map name"),
    },
    async ({ node_id, new_parent_id, index, map }) => {
      const doc = getDoc(map);
      moveNode(doc, node_id, new_parent_id, index);
      const ascii = renderMap(doc);
      return { content: [{ type: "text", text: `Moved node [${node_id}] to [${new_parent_id}].\n\n${ascii}` }] };
    }
  );

  server.tool(
    "edit_node",
    "Edit a node's title, notes, labels, or markers",
    {
      node_id: z.string().describe("Short ID of the node to edit"),
      title: z.string().optional().describe("New title"),
      notes: z.string().optional().describe("New notes content"),
      labels: z.array(z.string()).optional().describe("New labels"),
      markers: z.array(z.string()).optional().describe("New markers"),
      map: z.string().optional().describe("Map name"),
    },
    async ({ node_id, title, notes, labels, markers, map }) => {
      const doc = getDoc(map);
      const node = editNode(doc, node_id, { title, notes, labels, markers });
      const ascii = renderMap(doc);
      return { content: [{ type: "text", text: `Updated node [${node.id}].\n\n${ascii}` }] };
    }
  );

  server.tool(
    "bulk_add_nodes",
    "Add multiple nodes at once (each with parent_id and title)",
    {
      nodes: z.array(z.object({
        parent_id: z.string().describe("Short ID of the parent"),
        title: z.string().describe("Title for the new node"),
      })).describe("Array of nodes to add"),
      map: z.string().optional().describe("Map name"),
    },
    async ({ nodes, map }) => {
      const doc = getDoc(map);
      const added = nodes.map((n) => {
        const node = addNode(doc, n.parent_id, n.title);
        return `[${node.id}] "${n.title}"`;
      });
      const ascii = renderMap(doc);
      return {
        content: [{ type: "text", text: `Added ${added.length} nodes:\n${added.join("\n")}\n\n${ascii}` }],
      };
    }
  );
}
