import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { execFile } from "node:child_process";
import { MindMapNode } from "../model/types.js";
import {
  createProjectMap,
  createGlobalMap,
  findChildByTitle,
  addNode,
  removeNode,
  moveNode,
  editNode,
  setFolded,
  activeSheet,
} from "../model/mindmap.js";
import { readXMind } from "../xmind/reader.js";
import { writeXMind } from "../xmind/writer.js";
import { mapFilePath, mapExists } from "../storage.js";
import { renderMap } from "../render/ascii.js";
import { getOpenDoc, setOpenDoc, getAllOpenDocs, OpenDocEntry } from "./map-lifecycle.js";
import { gitCommitAndPush, gitPull } from "../web/git-ops.js";

function exec(cmd: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${cmd} ${args.join(" ")} failed: ${stderr || err.message}`));
      else resolve(stdout.trim());
    });
  });
}

function openOrCreateProjectMap(name: string): OpenDocEntry {
  let entry = getOpenDoc(name);
  if (entry) return entry;

  if (mapExists(name)) {
    const path = mapFilePath(name);
    const { doc, idMapper } = readXMind(path);
    entry = { doc, idMapper };
  } else {
    const doc = createProjectMap(name);
    entry = { doc };
    // Save to disk immediately
    const path = mapFilePath(name);
    writeXMind(entry.doc, path, entry.idMapper);
  }
  setOpenDoc(name, entry);
  return entry;
}

async function detectChanges(
  entry: OpenDocEntry,
  sessionsNodeId: string
): Promise<string> {
  const lines: string[] = [];

  // Check Sessions node labels for last_end and last_head
  const sessionsNode = entry.doc.nodeIndex.get(sessionsNodeId);
  const labels = sessionsNode?.labels || [];
  const lastHead = labels.find((l) => l.startsWith("last_head:"))?.slice("last_head:".length);
  const lastEnd = labels.find((l) => l.startsWith("last_end:"))?.slice("last_end:".length);

  if (lastEnd) {
    lines.push(`Last session ended: ${lastEnd}`);
  }

  // Detect git changes in the project directory
  if (entry.projectPath) {
    try {
      const status = await exec("git", ["status", "--porcelain"], entry.projectPath);
      if (status) {
        const fileCount = status.split("\n").length;
        lines.push(`Working tree: ${fileCount} changed file(s)`);
        lines.push(status);
      } else {
        lines.push("Working tree: clean");
      }
    } catch {
      lines.push("Working tree: could not check git status");
    }

    if (lastHead) {
      try {
        const log = await exec(
          "git",
          ["log", `${lastHead}..HEAD`, "--oneline"],
          entry.projectPath
        );
        if (log) {
          const commitCount = log.split("\n").length;
          lines.push(`\n${commitCount} new commit(s) since last session:`);
          lines.push(log);
        } else {
          lines.push("No new commits since last session.");
        }
      } catch {
        lines.push("Could not check commit history (last_head may be invalid).");
      }
    }
  }

  return lines.length > 0 ? lines.join("\n") : "No previous session data found.";
}

/** Extract bullet points from markdown content. Returns array of point texts, or empty if not a bullet list. */
function extractBullets(content: string): string[] {
  const lines = content.split("\n").map((l) => l.trim()).filter(Boolean);
  const bulletPattern = /^(?:[-*•]|\d+[.)]) (.+)$/;
  const bullets = lines
    .map((l) => { const m = l.match(bulletPattern); return m ? m[1].trim() : null; })
    .filter((b): b is string => b !== null);
  // Only treat as bullet list if most lines are bullets
  return bullets.length >= 2 && bullets.length >= lines.length * 0.6 ? bullets : [];
}

export function registerSessionTools(server: McpServer): void {
  server.tool(
    "start_session",
    "Start a new session for a project — opens/creates project map, creates session node, detects changes",
    {
      project: z.string().describe("Project name (used as map name)"),
      project_path: z.string().optional().describe("Absolute path to the project directory for git operations"),
    },
    async ({ project, project_path }) => {
      const entry = openOrCreateProjectMap(project);

      if (project_path) {
        entry.projectPath = project_path;
      }

      // Also open global map if it exists
      if (mapExists("global") && !getOpenDoc("global")) {
        const globalPath = mapFilePath("global");
        const { doc, idMapper } = readXMind(globalPath);
        setOpenDoc("global", { doc, idMapper });
      }

      // Register project in global map's Projects branch if not already there
      const globalEntry = getOpenDoc("global");
      if (globalEntry) {
        const globalRoot = activeSheet(globalEntry.doc).rootTopic.id;
        const projectsBranch = findChildByTitle(globalEntry.doc, globalRoot, "Projects");
        if (projectsBranch && !findChildByTitle(globalEntry.doc, projectsBranch.id, project)) {
          const projNode = addNode(globalEntry.doc, projectsBranch.id, project);
          editNode(globalEntry.doc, projNode.id, { markers: ["node-type:project"] });
          if (project_path) {
            editNode(globalEntry.doc, projNode.id, { notes: project_path });
          }
          const globalPath = mapFilePath("global");
          writeXMind(globalEntry.doc, globalPath, globalEntry.idMapper);
        }
      }

      const rootId = activeSheet(entry.doc).rootTopic.id;
      const sessionsNode = findChildByTitle(entry.doc, rootId, "Sessions");
      if (!sessionsNode) {
        return {
          content: [{ type: "text" as const, text: "Error: Sessions branch not found in map." }],
          isError: true,
        };
      }

      // Detect changes before creating the new session
      const changesReport = await detectChanges(entry, sessionsNode.id);

      // Create session node with ISO timestamp
      const timestamp = new Date().toISOString();
      const sessionNode = addNode(entry.doc, sessionsNode.id, timestamp);
      entry.sessionNodeId = sessionNode.id;

      // Fold older sessions (keep latest 5 visible)
      const sessionChildren = sessionsNode.children;
      for (let i = 0; i < sessionChildren.length - 5; i++) {
        setFolded(entry.doc, sessionChildren[i].id, true);
      }

      // Save map so session node persists across reloads (e.g. session_apply)
      const savePath = mapFilePath(project);
      writeXMind(entry.doc, savePath, entry.idMapper);

      // Focus Context branch for rendering
      const contextNode = findChildByTitle(entry.doc, rootId, "Context");
      if (contextNode) {
        entry.doc.focusNodeId = contextNode.id;
      }

      const ascii = renderMap(entry.doc);

      // Unfocus after rendering so full map is accessible
      entry.doc.focusNodeId = null;

      const output = [
        `Session started for "${project}" at ${timestamp}`,
        "",
        "--- Changes since last session ---",
        changesReport,
        "",
        "--- Context ---",
        ascii,
      ].join("\n");

      return { content: [{ type: "text" as const, text: output }] };
    }
  );

  server.tool(
    "end_session",
    "End the current session — saves summary and metadata to the session node",
    {
      summary: z.string().describe("Summary of what was done this session"),
      decisions: z.string().optional().describe("Key decisions made"),
      files_changed: z.string().optional().describe("List of files changed"),
    },
    async ({ summary, decisions, files_changed }) => {
      // Find the project map with an active session
      let projectName: string | undefined;
      let entry: OpenDocEntry | undefined;

      // Search all open docs for one with a sessionNodeId
      for (const [name, e] of getAllOpenDocs()) {
        if (e.sessionNodeId) {
          projectName = name;
          entry = e;
          break;
        }
      }

      if (!projectName || !entry || !entry.sessionNodeId) {
        return {
          content: [{ type: "text" as const, text: "No active session found. Use start_session first." }],
          isError: true,
        };
      }

      // Build structured notes
      const notesParts = [`Summary: ${summary}`];
      if (decisions) notesParts.push(`Decisions: ${decisions}`);
      if (files_changed) notesParts.push(`Files changed: ${files_changed}`);
      const notes = notesParts.join("\n\n");

      // Update the session node
      editNode(entry.doc, entry.sessionNodeId, { notes });

      // Update Sessions branch labels with metadata
      const rootId = activeSheet(entry.doc).rootTopic.id;
      const sessionsNode = findChildByTitle(entry.doc, rootId, "Sessions");
      if (sessionsNode) {
        const now = new Date().toISOString();
        const newLabels = (sessionsNode.labels || []).filter(
          (l) => !l.startsWith("last_end:") && !l.startsWith("last_head:")
        );
        newLabels.push(`last_end:${now}`);

        // Get current git HEAD if project path is available
        if (entry.projectPath) {
          try {
            const head = await exec("git", ["rev-parse", "HEAD"], entry.projectPath);
            newLabels.push(`last_head:${head}`);
          } catch {
            // no git HEAD available
          }
        }

        editNode(entry.doc, sessionsNode.id, { labels: newLabels });
      }

      // Save the map
      const path = mapFilePath(projectName);
      writeXMind(entry.doc, path, entry.idMapper);

      // Git commit
      try {
        await gitCommitAndPush(path, projectName, `End session: ${summary.slice(0, 50)}`);
      } catch {
        // non-fatal
      }

      // Clear session
      entry.sessionNodeId = undefined;

      return {
        content: [{ type: "text" as const, text: `Session ended for "${projectName}". Summary saved.` }],
      };
    }
  );

  server.tool(
    "init_global_map",
    "Initialize the global mindmap with Preferences, Tools, Projects branches",
    {},
    async () => {
      if (getOpenDoc("global")) {
        const doc = getOpenDoc("global")!.doc;
        const ascii = renderMap(doc);
        return { content: [{ type: "text" as const, text: `Global map already exists and is open.\n\n${ascii}` }] };
      }

      if (mapExists("global")) {
        const path = mapFilePath("global");
        const { doc, idMapper } = readXMind(path);
        setOpenDoc("global", { doc, idMapper });
        const ascii = renderMap(doc);
        return { content: [{ type: "text" as const, text: `Opened existing global map.\n\n${ascii}` }] };
      }

      const doc = createGlobalMap();
      const entry: OpenDocEntry = { doc };
      setOpenDoc("global", entry);
      const path = mapFilePath("global");
      writeXMind(doc, path);

      try {
        await gitCommitAndPush(path, "global", "Initialize global mindmap");
      } catch {
        // non-fatal
      }

      const ascii = renderMap(doc);
      return { content: [{ type: "text" as const, text: `Created global map.\n\n${ascii}` }] };
    }
  );

  server.tool(
    "migrate_memory",
    "Migrate markdown memory content into a project mindmap's Context and Memory branches",
    {
      project: z.string().describe("Project name (map name)"),
      markdown_content: z.string().describe("Markdown content to parse and import"),
    },
    async ({ project, markdown_content }) => {
      const entry = openOrCreateProjectMap(project);
      const rootId = activeSheet(entry.doc).rootTopic.id;
      const contextNode = findChildByTitle(entry.doc, rootId, "Context");
      const memoryNode = findChildByTitle(entry.doc, rootId, "Memory");

      if (!contextNode || !memoryNode) {
        return {
          content: [{ type: "text" as const, text: "Error: Context or Memory branch not found." }],
          isError: true,
        };
      }

      // Parse markdown into ## sections
      const sections: { title: string; content: string }[] = [];
      const sectionRegex = /^## (.+)$/gm;
      let match: RegExpExecArray | null;
      const matches: { title: string; start: number }[] = [];

      while ((match = sectionRegex.exec(markdown_content)) !== null) {
        matches.push({ title: match[1], start: match.index + match[0].length });
      }

      for (let i = 0; i < matches.length; i++) {
        const end = i + 1 < matches.length ? matches[i + 1].start - matches[i + 1].title.length - 4 : markdown_content.length;
        const content = markdown_content.slice(matches[i].start, end).trim();
        sections.push({ title: matches[i].title, content });
      }

      // Categorize sections into Context vs Memory
      const contextKeywords = [
        "architecture", "overview", "deployment", "tech stack", "api", "files",
        "key files", "project overview", "environment", "web server", "frontend",
        "node data", "id architecture", "file sizes",
      ];
      const memoryKeywords = [
        "conventions", "patterns", "preferences", "issues", "encountered",
        "workflow", "tips",
      ];

      let contextCount = 0;
      let memoryCount = 0;

      for (const section of sections) {
        const titleLower = section.title.toLowerCase();
        const isContext = contextKeywords.some((k) => titleLower.includes(k));
        const isMemory = memoryKeywords.some((k) => titleLower.includes(k));

        const parentNode: MindMapNode = isMemory && !isContext ? memoryNode : contextNode;
        const newNode = addNode(entry.doc, parentNode.id, section.title);
        if (section.content) {
          const bullets = extractBullets(section.content);
          if (bullets.length > 1) {
            for (const bullet of bullets) {
              addNode(entry.doc, newNode.id, bullet);
            }
          } else {
            editNode(entry.doc, newNode.id, { notes: section.content });
          }
        }

        if (parentNode === contextNode) contextCount++;
        else memoryCount++;
      }

      // Save
      const path = mapFilePath(project);
      writeXMind(entry.doc, path, entry.idMapper);

      try {
        await gitCommitAndPush(path, project, `Migrate memory: ${sections.length} sections`);
      } catch {
        // non-fatal
      }

      const ascii = renderMap(entry.doc);
      return {
        content: [{
          type: "text" as const,
          text: `Migrated ${sections.length} sections (${contextCount} to Context, ${memoryCount} to Memory).\n\n${ascii}`,
        }],
      };
    }
  );

  server.tool(
    "session_apply",
    "Reload the mindmap and detect new/modified nodes since last apply — returns actionable changes",
    {},
    async () => {
      // Pull latest maps from git remote
      const pullResult = await gitPull();
      const lines: string[] = [`Maps git pull: ${pullResult}`];

      // Find active project map
      let projectName: string | undefined;
      let entry: OpenDocEntry | undefined;

      for (const [name, e] of getAllOpenDocs()) {
        if (e.sessionNodeId) {
          projectName = name;
          entry = e;
          break;
        }
      }
      if (!projectName) {
        for (const [name, e] of getAllOpenDocs()) {
          if (name !== "global") {
            projectName = name;
            entry = e;
            break;
          }
        }
      }

      if (!projectName || !entry) {
        return {
          content: [{ type: "text" as const, text: "No project map is open. Use start_session first." }],
          isError: true,
        };
      }

      // Re-read the map from disk
      const path = mapFilePath(projectName);
      if (mapExists(projectName)) {
        const sessionNodeId = entry.sessionNodeId;
        const projectPath = entry.projectPath;
        const { doc, idMapper } = readXMind(path);
        entry.doc = doc;
        entry.idMapper = idMapper;
        entry.sessionNodeId = sessionNodeId;
        entry.projectPath = projectPath;
        lines.push(`Reloaded "${projectName}" from disk.`);
      }

      const doc = entry.doc;
      const rootId = activeSheet(doc).rootTopic.id;
      const sessionsNode = findChildByTitle(doc, rootId, "Sessions");
      if (!sessionsNode) {
        return {
          content: [{ type: "text" as const, text: "Error: Sessions branch not found." }],
          isError: true,
        };
      }

      // Build current snapshot: { [nodeId]: "title\0notes" }
      const currentSnapshot: Record<string, string> = {};
      for (const [id, node] of doc.nodeIndex) {
        currentSnapshot[id] = node.title + "\0" + (node.notes || "");
      }

      // Load previous snapshot from _apply_snapshot node
      // Find ALL snapshot nodes (deduplicate if web saves created extras)
      const snapshotNodes = sessionsNode.children.filter((c) => c.title === "_apply_snapshot");
      let snapshotNode: MindMapNode | undefined;
      let previousSnapshot: Record<string, string> = {};
      let firstRun = false;

      if (snapshotNodes.length > 0) {
        // Use the one with valid JSON notes, prefer latest (last in array)
        for (let i = snapshotNodes.length - 1; i >= 0; i--) {
          if (snapshotNodes[i].notes) {
            try {
              previousSnapshot = JSON.parse(snapshotNodes[i].notes!);
              snapshotNode = snapshotNodes[i];
              break;
            } catch {
              // corrupt, try next
            }
          }
        }
        // Remove duplicates (keep only the chosen one)
        for (const sn of snapshotNodes) {
          if (sn !== snapshotNode) {
            removeNode(doc, sn.id);
          }
        }
        if (!snapshotNode) {
          // All were corrupt — reuse the first one
          snapshotNode = snapshotNodes[0] || undefined;
          firstRun = true;
        }
      } else {
        firstRun = true;
      }

      // On first run, use empty baseline so default nodes are reported as actionable
      if (firstRun) {
        previousSnapshot = {};
      }

      // Diff: find new and modified nodes
      const newNodes: string[] = [];
      const modifiedNodes: string[] = [];

      // Structural node titles to skip (branch headers, not actionable)
      const structuralTitles = new Set([
        "_apply_snapshot", "Context", "Memory", "Tasks", "Sessions",
        "Bugs to fix", "Features to add", "Improvements to add",
      ]);

      // Collect session node IDs to skip (sessions branch children)
      const sessionChildIds = new Set(sessionsNode.children.map((c) => c.id));

      for (const [id, content] of Object.entries(currentSnapshot)) {
        const node = doc.nodeIndex.get(id)!;
        // Skip root, structural branch nodes, session nodes, and done nodes
        if (id === rootId) continue;
        if (structuralTitles.has(node.title)) continue;
        if (sessionChildIds.has(id)) continue;
        if (node.labels?.includes("done")) continue;

        if (!(id in previousSnapshot)) {
          newNodes.push(id);
        } else if (previousSnapshot[id] !== content) {
          modifiedNodes.push(id);
        }
      }

      // Build path-from-root for a node
      function nodePath(nodeId: string): string {
        const parts: string[] = [];
        let current: string | undefined = nodeId;
        while (current) {
          const n = doc.nodeIndex.get(current);
          if (n) parts.unshift(n.title);
          current = doc.parentIndex.get(current);
        }
        return parts.join(" > ");
      }

      // Save current snapshot
      if (!snapshotNode) {
        snapshotNode = addNode(doc, sessionsNode.id, "_apply_snapshot");
      }
      editNode(doc, snapshotNode.id, { notes: JSON.stringify(currentSnapshot) });

      // Save map with updated snapshot
      writeXMind(doc, path, entry.idMapper);
      try {
        await gitCommitAndPush(path, projectName, "Update apply snapshot");
      } catch {
        // non-fatal
      }

      // Format output
      if (newNodes.length === 0 && modifiedNodes.length === 0) {
        lines.push("\nNo new or modified nodes since last /apply.");
        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      }

      const allIds: string[] = [];

      if (newNodes.length > 0) {
        lines.push(`\n## New nodes (${newNodes.length}):`);
        for (const id of newNodes) {
          const node = doc.nodeIndex.get(id)!;
          const shortId = entry.idMapper!.longToShort.get(id) || id;
          const pathStr = nodePath(id);
          lines.push(`- [${shortId}] **${pathStr}**`);
          if (node.notes) lines.push(`  Notes: ${node.notes}`);
          allIds.push(shortId);
        }
      }

      if (modifiedNodes.length > 0) {
        lines.push(`\n## Modified nodes (${modifiedNodes.length}):`);
        for (const id of modifiedNodes) {
          const node = doc.nodeIndex.get(id)!;
          const shortId = entry.idMapper!.longToShort.get(id) || id;
          const pathStr = nodePath(id);
          lines.push(`- [${shortId}] **${pathStr}**`);
          if (node.notes) lines.push(`  Notes: ${node.notes}`);
          allIds.push(shortId);
        }
      }

      lines.push("\nReview the above nodes and implement any actionable instructions.");
      lines.push(`After completing each node, call mark_applied with its ID to mark it done.`);
      lines.push(`Node IDs: ${allIds.join(", ")}`);

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );

  server.tool(
    "mark_applied",
    "Mark one or more mindmap nodes as done after processing them. Use action='delete' to remove task nodes, 'done' to label them, or 'move' to relocate to a target branch.",
    {
      node_ids: z.array(z.string()).describe("Short IDs of nodes to mark as done"),
      action: z.enum(["done", "delete", "move"]).default("delete").describe("Action: 'delete' removes the node, 'done' adds a done label, 'move' relocates to move_target"),
      move_target: z.string().optional().describe("Title of the branch to move nodes to (e.g., 'Key Bugs Fixed'). Only used with action='move'."),
      map: z.string().optional().describe("Map name (defaults to active project map)"),
    },
    async ({ node_ids, action, move_target, map }) => {
      // Find the project map
      let projectName = map;
      let entry: OpenDocEntry | undefined;

      if (projectName) {
        entry = getOpenDoc(projectName);
      } else {
        for (const [name, e] of getAllOpenDocs()) {
          if (e.sessionNodeId) { projectName = name; entry = e; break; }
        }
        if (!projectName) {
          for (const [name, e] of getAllOpenDocs()) {
            if (name !== "global") { projectName = name; entry = e; break; }
          }
        }
      }

      if (!projectName || !entry) {
        return { content: [{ type: "text" as const, text: "No project map is open." }], isError: true };
      }

      const doc = entry.doc;
      const processed: string[] = [];

      // For move action, find the target branch
      let moveTargetNode: MindMapNode | undefined;
      if (action === "move" && move_target) {
        const rootId = activeSheet(doc).rootTopic.id;
        // Search all top-level branches and their children for the target
        const root = doc.nodeIndex.get(rootId);
        if (root) {
          for (const branch of root.children) {
            if (branch.title === move_target) {
              moveTargetNode = branch;
              break;
            }
            const child = findChildByTitle(doc, branch.id, move_target);
            if (child) {
              moveTargetNode = child;
              break;
            }
          }
        }
        if (!moveTargetNode) {
          return { content: [{ type: "text" as const, text: `Move target "${move_target}" not found.` }], isError: true };
        }
      }

      for (const shortId of node_ids) {
        const node = doc.nodeIndex.get(shortId);
        if (!node) continue;

        if (action === "delete") {
          removeNode(doc, shortId);
        } else if (action === "move" && moveTargetNode) {
          moveNode(doc, shortId, moveTargetNode.id);
          const labels = node.labels || [];
          if (!labels.includes("done")) labels.push("done");
          editNode(doc, shortId, { labels });
        } else {
          // action === "done"
          const labels = node.labels || [];
          if (!labels.includes("done")) labels.push("done");
          editNode(doc, shortId, { labels });
        }
        processed.push(shortId);
      }

      // Save and commit
      const path = mapFilePath(projectName);
      writeXMind(doc, path, entry.idMapper);
      const actionVerb = action === "delete" ? "deleted" : action === "move" ? "moved" : "marked done";
      try {
        await gitCommitAndPush(path, projectName, `${actionVerb} ${processed.length} node(s)`);
      } catch {
        // non-fatal
      }

      return {
        content: [{ type: "text" as const, text: `${processed.length} node(s) ${actionVerb}: ${processed.join(", ")}` }],
      };
    }
  );

  server.tool(
    "session_reload",
    "Re-read the mindmap from disk/repo and check if something needs attention",
    {},
    async () => {
      const lines: string[] = [];

      // Pull latest maps from git remote
      const pullResult = await gitPull();
      lines.push(`Maps git pull: ${pullResult}`);

      // Find active project map (one with sessionNodeId, or first open)
      let projectName: string | undefined;
      let entry: OpenDocEntry | undefined;

      for (const [name, e] of getAllOpenDocs()) {
        if (e.sessionNodeId) {
          projectName = name;
          entry = e;
          break;
        }
      }
      if (!projectName) {
        // Fall back to first open non-global doc
        for (const [name, e] of getAllOpenDocs()) {
          if (name !== "global") {
            projectName = name;
            entry = e;
            break;
          }
        }
      }

      if (!projectName || !entry) {
        return {
          content: [{ type: "text" as const, text: "No project map is open. Use start_session first." }],
          isError: true,
        };
      }

      // Re-read the map from disk
      const path = mapFilePath(projectName);
      if (mapExists(projectName)) {
        const sessionNodeId = entry.sessionNodeId;
        const projectPath = entry.projectPath;
        const { doc, idMapper } = readXMind(path);
        entry.doc = doc;
        entry.idMapper = idMapper;
        entry.sessionNodeId = sessionNodeId;
        entry.projectPath = projectPath;
        lines.push(`Reloaded "${projectName}" from disk.`);
      }

      // Check project git status
      if (entry.projectPath) {
        try {
          const status = await exec("git", ["status", "--porcelain"], entry.projectPath);
          if (status) {
            const fileCount = status.split("\n").length;
            lines.push(`\nWorking tree: ${fileCount} changed file(s)`);
            lines.push(status);
          } else {
            lines.push("\nWorking tree: clean");
          }
        } catch {
          lines.push("\nWorking tree: could not check git status");
        }

        // Check for unpushed commits
        try {
          const unpushed = await exec(
            "git",
            ["log", "@{u}..HEAD", "--oneline"],
            entry.projectPath
          );
          if (unpushed) {
            lines.push(`\nUnpushed commits:\n${unpushed}`);
          }
        } catch {
          // no upstream or other issue, skip
        }
      }

      // Render the Context branch
      const rootId = activeSheet(entry.doc).rootTopic.id;
      const contextNode = findChildByTitle(entry.doc, rootId, "Context");
      if (contextNode) {
        entry.doc.focusNodeId = contextNode.id;
        const ascii = renderMap(entry.doc);
        entry.doc.focusNodeId = null;
        lines.push(`\n--- Context ---\n${ascii}`);
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );
}
