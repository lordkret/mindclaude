import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getOpenDoc, getAllOpenDocs, OpenDocEntry } from "./map-lifecycle.js";
import { activeSheet, editNode } from "../model/mindmap.js";
import { writeXMind } from "../xmind/writer.js";
import { mapFilePath } from "../storage.js";
import { gitCommitAndPush } from "../web/git-ops.js";
import { syncMapToVault, syncVaultToMap } from "../vault/sync.js";
import { vaultCommitAndPush, vaultPull } from "../vault/git-ops.js";
import { findVaultNoteById, getProjectVaultDir, vaultNotePath } from "../vault/storage.js";
import { nodeToMarkdown, markdownToNodeData } from "../vault/format.js";
import { writeFileSync } from "node:fs";

function findProjectEntry(mapName?: string): { name: string; entry: OpenDocEntry } | null {
  if (mapName) {
    const entry = getOpenDoc(mapName);
    if (entry) return { name: mapName, entry };
    return null;
  }
  for (const [name, e] of getAllOpenDocs()) {
    if (e.sessionNodeId) return { name, entry: e };
  }
  for (const [name, e] of getAllOpenDocs()) {
    if (name !== "global") return { name, entry: e };
  }
  return null;
}

export function registerVaultTools(server: McpServer): void {
  server.tool(
    "vault_sync",
    "Full bidirectional sync between mindmap and vault, then commit vault",
    {
      project: z.string().optional().describe("Project name (defaults to active project map)"),
    },
    async ({ project }) => {
      const found = findProjectEntry(project);
      if (!found) {
        return { content: [{ type: "text" as const, text: "No project map is open." }], isError: true };
      }

      // Pull vault first
      const pullResult = await vaultPull();
      const lines: string[] = [`Vault pull: ${pullResult}`];

      // Vault→Map sync first (vault wins on content)
      const v2m = syncVaultToMap(found.entry.doc, found.name);
      if (v2m.updated.length > 0) {
        lines.push(`Vault→Map: updated ${v2m.updated.length} node(s)`);
        // Save mindmap
        const path = mapFilePath(found.name);
        writeXMind(found.entry.doc, path, found.entry.idMapper);
        try {
          await gitCommitAndPush(path, found.name, `Vault sync: updated ${v2m.updated.length} nodes from vault`);
        } catch { /* non-fatal */ }
      }

      // Map→Vault sync
      const m2v = syncMapToVault(found.entry.doc, found.name);
      if (m2v.written.length > 0 || m2v.deleted.length > 0) {
        lines.push(`Map→Vault: wrote ${m2v.written.length}, deleted ${m2v.deleted.length} file(s)`);
      }

      // Commit vault changes
      const allFiles = [...m2v.written];
      if (allFiles.length > 0 || m2v.deleted.length > 0) {
        try {
          const commitResult = await vaultCommitAndPush(allFiles, `Sync ${found.name}: ${m2v.written.length} written, ${m2v.deleted.length} deleted`);
          lines.push(`Vault commit: ${commitResult}`);
        } catch (e) {
          lines.push(`Vault commit failed: ${(e as Error).message}`);
        }
      } else {
        lines.push("No vault changes to commit.");
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );

  server.tool(
    "vault_write",
    "Add vault:true marker to a node and write it to the vault",
    {
      node_id: z.string().describe("Short ID of the node to write to vault"),
      recursive: z.boolean().optional().describe("Also write all descendants"),
      map: z.string().optional().describe("Map name (defaults to active project map)"),
    },
    async ({ node_id, recursive, map }) => {
      const found = findProjectEntry(map);
      if (!found) {
        return { content: [{ type: "text" as const, text: "No project map is open." }], isError: true };
      }

      const doc = found.entry.doc;
      const node = doc.nodeIndex.get(node_id);
      if (!node) {
        return { content: [{ type: "text" as const, text: `Node "${node_id}" not found.` }], isError: true };
      }

      const nodesToWrite: string[] = [];

      function addVaultMarker(n: NonNullable<typeof node>): void {
        const markers = n.markers || [];
        if (!markers.includes("vault:true")) {
          markers.push("vault:true");
          editNode(doc, n.id, { markers });
        }
        nodesToWrite.push(n.id);
        if (recursive) {
          for (const child of n.children) {
            addVaultMarker(child);
          }
        }
      }

      addVaultMarker(node);

      // Write to vault
      const result = syncMapToVault(doc, found.name);

      // Save mindmap
      const path = mapFilePath(found.name);
      writeXMind(doc, path, found.entry.idMapper);
      try {
        await gitCommitAndPush(path, found.name, `Add vault:true to ${nodesToWrite.length} node(s)`);
      } catch { /* non-fatal */ }

      // Commit vault
      if (result.written.length > 0) {
        try {
          await vaultCommitAndPush(result.written, `Write ${nodesToWrite.length} node(s) to vault`);
        } catch { /* non-fatal */ }
      }

      return {
        content: [{
          type: "text" as const,
          text: `Wrote ${result.written.length} file(s) to vault for ${nodesToWrite.length} node(s).`,
        }],
      };
    }
  );

  server.tool(
    "vault_read",
    "Read vault note content for a node",
    {
      node_id: z.string().describe("Short ID of the node"),
      map: z.string().optional().describe("Map name (defaults to active project map)"),
    },
    async ({ node_id, map }) => {
      const found = findProjectEntry(map);
      if (!found) {
        return { content: [{ type: "text" as const, text: "No project map is open." }], isError: true };
      }

      const filePath = findVaultNoteById(found.name, node_id);
      if (!filePath) {
        return { content: [{ type: "text" as const, text: `No vault note found for node "${node_id}".` }], isError: true };
      }

      const content = readFileSync(filePath, "utf-8");
      return { content: [{ type: "text" as const, text: content }] };
    }
  );

  server.tool(
    "vault_status",
    "List vault-enabled nodes and their sync status",
    {
      project: z.string().optional().describe("Project name (defaults to active project map)"),
    },
    async ({ project }) => {
      const found = findProjectEntry(project);
      if (!found) {
        return { content: [{ type: "text" as const, text: "No project map is open." }], isError: true };
      }

      const doc = found.entry.doc;
      const lines: string[] = [];
      let vaultCount = 0;

      for (const [id, node] of doc.nodeIndex) {
        const markers = node.markers || [];
        if (!markers.includes("vault:true")) continue;
        vaultCount++;

        const filePath = findVaultNoteById(found.name, id);
        const status = filePath && existsSync(filePath) ? "synced" : "missing";
        lines.push(`- [${id}] ${node.title} (${status})`);
      }

      if (vaultCount === 0) {
        lines.push("No vault-enabled nodes found. Use vault_write to add nodes to the vault.");
      } else {
        lines.unshift(`## Vault nodes (${vaultCount}):`);
      }

      // Also list any orphan files in vault
      const projectDir = getProjectVaultDir(found.name);
      if (existsSync(projectDir)) {
        const files = readdirSync(projectDir).filter(f => f.endsWith(".md"));
        const orphans = files.filter(f => {
          const idMatch = f.match(/--([a-zA-Z0-9_-]{8})\.md$/);
          if (!idMatch) return false;
          const node = doc.nodeIndex.get(idMatch[1]);
          return !node || !(node.markers || []).includes("vault:true");
        });
        if (orphans.length > 0) {
          lines.push(`\n## Orphan vault files (${orphans.length}):`);
          for (const f of orphans) {
            lines.push(`- ${f}`);
          }
        }
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );
}
