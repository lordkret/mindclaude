import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerPrompts(server: McpServer): void {
  server.prompt(
    "save",
    "Save the current mindmap to disk",
    { name: z.string().optional().describe("Map name (defaults to first open map)") },
    ({ name }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: name
              ? `Please save the mindmap "${name}" to disk using the save_map tool.`
              : "Please save the current mindmap to disk using the save_map tool.",
          },
        },
      ],
    })
  );

  server.prompt(
    "refresh",
    "Reload a mindmap from disk (pick up external changes)",
    { name: z.string().describe("Map name to reload") },
    ({ name }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Please close and reopen the mindmap "${name}" to pick up any external changes. Use close_map with force=true, then open_map.`,
          },
        },
      ],
    })
  );
}
