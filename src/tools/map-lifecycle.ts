import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MindMapDocument, IdMapper } from "../model/types.js";
import { createDocument } from "../model/mindmap.js";
import { readXMind } from "../xmind/reader.js";
import { writeXMind } from "../xmind/writer.js";
import { listMapFiles, mapFilePath, mapExists } from "../storage.js";
import { renderMap } from "../render/ascii.js";
import { gitPull } from "../web/git-ops.js";

export interface OpenDocEntry {
  doc: MindMapDocument;
  idMapper?: IdMapper;
  sessionNodeId?: string;    // current active session node ID
  projectPath?: string;      // absolute path for git operations
}

// Shared state: open documents
const openDocs = new Map<string, OpenDocEntry>();

export function getOpenDoc(name: string): OpenDocEntry | undefined {
  return openDocs.get(name);
}

export function setOpenDoc(name: string, entry: OpenDocEntry): void {
  openDocs.set(name, entry);
}

export function getAllOpenDocs(): Map<string, OpenDocEntry> {
  return openDocs;
}

export function registerLifecycleTools(server: McpServer): void {
  server.tool(
    "list_maps",
    "List all available mindmaps in storage",
    {},
    async () => {
      const files = listMapFiles();
      const openNames = [...openDocs.keys()];
      const lines = files.map((f) => {
        const isOpen = openNames.includes(f.name) ? " [open]" : "";
        return `${f.name}${isOpen} (modified: ${f.modifiedAt.toISOString()})`;
      });
      if (lines.length === 0) lines.push("No maps found. Use create_map to create one.");
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  server.tool(
    "create_map",
    "Create a new mindmap with the given name",
    { name: z.string().describe("Name for the new mindmap") },
    async ({ name }) => {
      if (openDocs.has(name)) {
        return { content: [{ type: "text", text: `Map "${name}" is already open.` }], isError: true };
      }
      const doc = createDocument(name);
      openDocs.set(name, { doc });
      const ascii = renderMap(doc);
      return { content: [{ type: "text", text: `Created map "${name}".\n\n${ascii}` }] };
    }
  );

  server.tool(
    "open_map",
    "Open an existing mindmap from disk",
    { name: z.string().describe("Name of the map to open") },
    async ({ name }) => {
      if (openDocs.has(name)) {
        const doc = openDocs.get(name)!.doc;
        const ascii = renderMap(doc);
        return { content: [{ type: "text", text: `Map "${name}" is already open.\n\n${ascii}` }] };
      }
      if (!mapExists(name)) {
        return { content: [{ type: "text", text: `Map "${name}" not found on disk.` }], isError: true };
      }
      const path = mapFilePath(name);
      const { doc, idMapper } = readXMind(path);
      openDocs.set(name, { doc, idMapper });
      const ascii = renderMap(doc);
      return { content: [{ type: "text", text: `Opened map "${name}".\n\n${ascii}` }] };
    }
  );

  server.tool(
    "save_map",
    "Save a mindmap to disk as .xmind file",
    { name: z.string().optional().describe("Name of the map to save (defaults to first open map)") },
    async ({ name }) => {
      const mapName = name || [...openDocs.keys()][0];
      if (!mapName) {
        return { content: [{ type: "text", text: "No maps are open." }], isError: true };
      }
      const entry = openDocs.get(mapName);
      if (!entry) {
        return { content: [{ type: "text", text: `Map "${mapName}" is not open.` }], isError: true };
      }
      const path = mapFilePath(mapName);
      writeXMind(entry.doc, path, entry.idMapper);
      return { content: [{ type: "text", text: `Saved "${mapName}" to ${path}` }] };
    }
  );

  server.tool(
    "close_map",
    "Close an open mindmap (prompts to save if dirty)",
    {
      name: z.string().describe("Name of the map to close"),
      force: z.boolean().optional().describe("Close without saving even if dirty"),
    },
    async ({ name, force }) => {
      const entry = openDocs.get(name);
      if (!entry) {
        return { content: [{ type: "text", text: `Map "${name}" is not open.` }], isError: true };
      }
      if (entry.doc.dirty && !force) {
        return {
          content: [{ type: "text", text: `Map "${name}" has unsaved changes. Use save_map first or close with force=true.` }],
          isError: true,
        };
      }
      openDocs.delete(name);
      return { content: [{ type: "text", text: `Closed map "${name}".` }] };
    }
  );

  server.tool(
    "sync_maps",
    "Pull latest changes from git remote and reload all open maps",
    {},
    async () => {
      const pullResult = await gitPull();
      const reloaded: string[] = [];
      for (const [name, entry] of openDocs) {
        if (!mapExists(name)) continue;
        const path = mapFilePath(name);
        try {
          const { doc, idMapper } = readXMind(path);
          entry.doc = doc;
          entry.idMapper = idMapper;
          reloaded.push(name);
        } catch (e) {
          reloaded.push(`${name} (reload failed: ${(e as Error).message})`);
        }
      }
      const reloadMsg = reloaded.length > 0
        ? `\nReloaded maps: ${reloaded.join(", ")}`
        : "\nNo open maps to reload.";
      return { content: [{ type: "text", text: `Git pull: ${pullResult}${reloadMsg}` }] };
    }
  );
}
