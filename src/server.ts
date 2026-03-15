import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerLifecycleTools } from "./tools/map-lifecycle.js";
import { registerNodeTools } from "./tools/node-ops.js";
import { registerRelationshipTools } from "./tools/relationship-ops.js";
import { registerNavigationTools } from "./tools/navigation.js";
import { registerSessionTools } from "./tools/session-ops.js";
import { registerSpeckitTools } from "./tools/speckit-ops.js";
import { registerVaultTools } from "./tools/vault-ops.js";
import { registerResources } from "./resources.js";
import { registerPrompts } from "./prompts.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "mindclaude",
    version: "0.1.0",
  });

  registerLifecycleTools(server);
  registerNodeTools(server);
  registerRelationshipTools(server);
  registerNavigationTools(server);
  registerSessionTools(server);
  registerSpeckitTools(server);
  registerVaultTools(server);
  registerResources(server);
  registerPrompts(server);

  return server;
}
