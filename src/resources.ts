import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { renderMap } from "./render/ascii.js";
import { getAllOpenDocs } from "./tools/map-lifecycle.js";
import { listMapFiles } from "./storage.js";

export function registerResources(server: McpServer): void {
  // Resource template for individual maps
  server.resource(
    "map",
    "mindmap://{name}",
    { description: "Current ASCII render of an open mindmap" },
    async (uri) => {
      const name = uri.pathname?.replace(/^\/\//, "") || uri.host || "";
      const entry = getAllOpenDocs().get(name);
      if (!entry) {
        return {
          contents: [{ uri: uri.href, mimeType: "text/plain", text: `Map "${name}" is not open.` }],
        };
      }
      const ascii = renderMap(entry.doc);
      return {
        contents: [{ uri: uri.href, mimeType: "text/plain", text: ascii }],
      };
    }
  );

  // Static resource listing all maps
  server.resource(
    "map-list",
    "mindmap://list",
    { description: "List of all available mindmaps" },
    async (uri) => {
      const files = listMapFiles();
      const openNames = [...getAllOpenDocs().keys()];
      const lines = files.map((f) => {
        const isOpen = openNames.includes(f.name) ? " [open]" : "";
        return `${f.name}${isOpen}`;
      });
      if (openNames.length > 0) {
        const openOnly = openNames.filter((n) => !files.some((f) => f.name === n));
        for (const n of openOnly) {
          lines.push(`${n} [open, unsaved]`);
        }
      }
      if (lines.length === 0) lines.push("No maps available.");
      return {
        contents: [{ uri: uri.href, mimeType: "text/plain", text: lines.join("\n") }],
      };
    }
  );
}
