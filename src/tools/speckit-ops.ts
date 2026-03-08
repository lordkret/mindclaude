import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { MindMapNode } from "../model/types.js";
import {
  findChildByTitle,
  addNode,
  editNode,
  moveNode,
  activeSheet,
} from "../model/mindmap.js";
import { writeXMind } from "../xmind/writer.js";
import { mapFilePath } from "../storage.js";
import { getOpenDoc, getAllOpenDocs, OpenDocEntry } from "./map-lifecycle.js";
import { gitCommitAndPush } from "../web/git-ops.js";

function findActiveProject(): { name: string; entry: OpenDocEntry } | undefined {
  for (const [name, e] of getAllOpenDocs()) {
    if (e.sessionNodeId) return { name, entry: e };
  }
  for (const [name, e] of getAllOpenDocs()) {
    if (name !== "global") return { name, entry: e };
  }
  return undefined;
}

function findOrCreateChild(
  entry: OpenDocEntry,
  parentId: string,
  title: string,
  markers?: string[],
  labels?: string[]
): MindMapNode {
  const existing = findChildByTitle(entry.doc, parentId, title);
  if (existing) return existing;
  const node = addNode(entry.doc, parentId, title);
  if (markers) editNode(entry.doc, node.id, { markers });
  if (labels) editNode(entry.doc, node.id, { labels });
  return node;
}

function setLabels(entry: OpenDocEntry, nodeId: string, prefix: string, value: string): void {
  const node = entry.doc.nodeIndex.get(nodeId);
  if (!node) return;
  const labels = (node.labels || []).filter((l) => !l.startsWith(prefix));
  labels.push(prefix + value);
  editNode(entry.doc, nodeId, { labels });
}

function removeLabel(entry: OpenDocEntry, nodeId: string, prefix: string): void {
  const node = entry.doc.nodeIndex.get(nodeId);
  if (!node) return;
  const labels = (node.labels || []).filter((l) => !l.startsWith(prefix));
  editNode(entry.doc, nodeId, { labels });
}

function detectPhase(featureDir: string): string {
  if (existsSync(join(featureDir, "tasks.md"))) return "tasks";
  if (existsSync(join(featureDir, "plan.md"))) return "plan";
  if (existsSync(join(featureDir, "spec.md"))) return "specify";
  return "specify";
}

interface ParsedTask {
  id: string;
  description: string;
  done: boolean;
  parallel: boolean;
  story?: string;
}

function parseTasks(content: string): ParsedTask[] {
  const tasks: ParsedTask[] = [];
  const lines = content.split("\n");
  for (const line of lines) {
    // Match: - [ ] T001 or - [X] T001 or - [x] T001
    const m = line.match(/^- \[([ Xx])\] (T\d+)\s*(.*)/);
    if (!m) continue;
    const done = m[1].toLowerCase() === "x";
    const id = m[2];
    let rest = m[3];

    let parallel = false;
    let story: string | undefined;

    // Extract [P] marker
    if (rest.includes("[P]")) {
      parallel = true;
      rest = rest.replace("[P]", "").trim();
    }

    // Extract [US*] marker
    const storyMatch = rest.match(/\[(US\d+)\]/);
    if (storyMatch) {
      story = storyMatch[1];
      rest = rest.replace(storyMatch[0], "").trim();
    }

    tasks.push({ id, description: rest, done, parallel, story });
  }
  return tasks;
}

function readFileSafe(path: string): string | undefined {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return undefined;
  }
}

function truncateNotes(content: string, maxLen = 4000): string {
  if (content.length <= maxLen) return content;
  return content.slice(0, maxLen) + "\n\n[... truncated]";
}

export function registerSpeckitTools(server: McpServer): void {
  server.tool(
    "sync_speckit",
    "Sync spec-kit feature data into the mindmap's Speckit branch — reads specs/ directory and creates/updates feature nodes with tasks",
    {
      project_path: z.string().describe("Absolute path to the project directory containing specs/"),
      map: z.string().optional().describe("Map name (defaults to active project map)"),
    },
    async ({ project_path, map }) => {
      let projectName = map;
      let entry: OpenDocEntry | undefined;

      if (projectName) {
        entry = getOpenDoc(projectName);
      } else {
        const active = findActiveProject();
        if (active) { projectName = active.name; entry = active.entry; }
      }

      if (!projectName || !entry) {
        return { content: [{ type: "text" as const, text: "No project map is open." }], isError: true };
      }

      const rootId = activeSheet(entry.doc).rootTopic.id;
      const speckitBranch = findOrCreateChild(entry, rootId, "Speckit");
      const completedBranch = findOrCreateChild(entry, speckitBranch.id, "Completed");

      // Sync constitution
      const constitutionPath = join(project_path, ".specify", "memory", "constitution.md");
      const constitutionContent = readFileSafe(constitutionPath);
      if (constitutionContent) {
        const constNode = findOrCreateChild(entry, speckitBranch.id, "Constitution");
        editNode(entry.doc, constNode.id, { notes: truncateNotes(constitutionContent) });
      }

      // Find specs directory
      const specsDir = join(project_path, "specs");
      if (!existsSync(specsDir)) {
        // Save what we have (constitution, branch structure)
        const path = mapFilePath(projectName);
        writeXMind(entry.doc, path, entry.idMapper);
        try { await gitCommitAndPush(path, projectName, "Sync speckit: initialize branches"); } catch { /* non-fatal */ }
        return { content: [{ type: "text" as const, text: "Speckit branch created. No specs/ directory found yet." }] };
      }

      // Process each feature directory
      const featureDirs = readdirSync(specsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);

      const results: string[] = [];

      for (const dirName of featureDirs) {
        const featureDir = join(specsDir, dirName);
        const featureTitle = `Feature: ${dirName}`;
        const phase = detectPhase(featureDir);

        // Check if feature is in Completed branch (skip if done)
        const inCompleted = findChildByTitle(entry.doc, completedBranch.id, featureTitle);
        if (inCompleted) {
          results.push(`${dirName}: already completed, skipping`);
          continue;
        }

        // Find or create feature node under Speckit
        const featureNode = findOrCreateChild(entry, speckitBranch.id, featureTitle, ["node-type:spec-feature"]);

        // Set phase label
        setLabels(entry, featureNode.id, "phase:", phase);

        // Sync spec.md
        const specContent = readFileSafe(join(featureDir, "spec.md"));
        if (specContent) {
          const specNode = findOrCreateChild(entry, featureNode.id, "Spec");
          editNode(entry.doc, specNode.id, { notes: truncateNotes(specContent) });
        }

        // Sync plan.md
        const planContent = readFileSafe(join(featureDir, "plan.md"));
        if (planContent) {
          const planNode = findOrCreateChild(entry, featureNode.id, "Plan");
          editNode(entry.doc, planNode.id, { notes: truncateNotes(planContent) });
        }

        // Sync tasks
        const tasksContent = readFileSafe(join(featureDir, "tasks.md"));
        if (tasksContent) {
          const tasksContainer = findOrCreateChild(entry, featureNode.id, "Tasks");
          const parsed = parseTasks(tasksContent);

          for (const task of parsed) {
            const taskTitle = buildTaskTitle(task);
            // Find existing task by task-id label
            let taskNode = findTaskByLabel(entry, tasksContainer.id, `task-id:${task.id}`);
            if (!taskNode) {
              taskNode = addNode(entry.doc, tasksContainer.id, taskTitle);
              editNode(entry.doc, taskNode.id, { markers: ["node-type:spec-task"] });
            } else {
              editNode(entry.doc, taskNode.id, { title: taskTitle });
            }

            // Set labels
            const labels: string[] = [`task-id:${task.id}`];
            if (task.parallel) labels.push("parallel:true");
            if (task.story) labels.push(`story:${task.story}`);
            if (task.done) labels.push("done");
            editNode(entry.doc, taskNode.id, { labels });
          }

          // Check if all tasks are done
          if (parsed.length > 0 && parsed.every((t) => t.done)) {
            setLabels(entry, featureNode.id, "phase:", "done");
            moveNode(entry.doc, featureNode.id, completedBranch.id);
            results.push(`${dirName}: all ${parsed.length} tasks done → moved to Completed`);
          } else {
            const doneCount = parsed.filter((t) => t.done).length;
            results.push(`${dirName}: ${doneCount}/${parsed.length} tasks done (phase: ${phase})`);
          }
        } else {
          results.push(`${dirName}: synced (phase: ${phase})`);
        }
      }

      // Save and commit
      const path = mapFilePath(projectName);
      writeXMind(entry.doc, path, entry.idMapper);
      try { await gitCommitAndPush(path, projectName, "Sync speckit features"); } catch { /* non-fatal */ }

      return {
        content: [{ type: "text" as const, text: `Synced ${featureDirs.length} feature(s):\n${results.join("\n")}` }],
      };
    }
  );

  server.tool(
    "update_speckit_task",
    "Update a spec-kit task status in the mindmap — sets in-progress or done, auto-completes feature when all tasks finish",
    {
      task_id: z.string().describe("Task ID (e.g. 'T001')"),
      status: z.enum(["in-progress", "done"]).describe("New status for the task"),
      map: z.string().optional().describe("Map name (defaults to active project map)"),
    },
    async ({ task_id, status, map }) => {
      let projectName = map;
      let entry: OpenDocEntry | undefined;

      if (projectName) {
        entry = getOpenDoc(projectName);
      } else {
        const active = findActiveProject();
        if (active) { projectName = active.name; entry = active.entry; }
      }

      if (!projectName || !entry) {
        return { content: [{ type: "text" as const, text: "No project map is open." }], isError: true };
      }

      const rootId = activeSheet(entry.doc).rootTopic.id;
      const speckitBranch = findChildByTitle(entry.doc, rootId, "Speckit");
      if (!speckitBranch) {
        return { content: [{ type: "text" as const, text: "Speckit branch not found. Run sync_speckit first." }], isError: true };
      }

      // Search for task node with matching task-id label
      const targetLabel = `task-id:${task_id}`;
      let taskNode: MindMapNode | undefined;

      for (const [, node] of entry.doc.nodeIndex) {
        if (node.labels?.includes(targetLabel)) {
          taskNode = node;
          break;
        }
      }

      if (!taskNode) {
        return { content: [{ type: "text" as const, text: `Task ${task_id} not found in Speckit branch.` }], isError: true };
      }

      // Update status
      const labels = (taskNode.labels || []).filter(
        (l) => !l.startsWith("status:") && l !== "done"
      );
      if (status === "in-progress") {
        labels.push("status:in-progress");
      } else if (status === "done") {
        labels.push("done");
      }
      editNode(entry.doc, taskNode.id, { labels });

      let featureCompleted = false;

      // If done, check if all sibling tasks are also done
      if (status === "done") {
        const tasksContainerId = entry.doc.parentIndex.get(taskNode.id);
        if (tasksContainerId) {
          const tasksContainer = entry.doc.nodeIndex.get(tasksContainerId);
          if (tasksContainer) {
            const allDone = tasksContainer.children.every(
              (child) => child.labels?.includes("done")
            );
            if (allDone) {
              // Find the feature node (parent of Tasks container)
              const featureId = entry.doc.parentIndex.get(tasksContainerId);
              if (featureId) {
                setLabels(entry, featureId, "phase:", "done");

                // Move to Completed branch
                const completedBranch = findChildByTitle(entry.doc, speckitBranch.id, "Completed");
                if (completedBranch) {
                  moveNode(entry.doc, featureId, completedBranch.id);
                }
                featureCompleted = true;
              }
            }
          }
        }
      }

      // Save (no git commit — will be committed with code changes)
      const path = mapFilePath(projectName);
      writeXMind(entry.doc, path, entry.idMapper);

      const msg = featureCompleted
        ? `Task ${task_id} → done. All tasks complete — feature moved to Completed.`
        : `Task ${task_id} → ${status}.`;

      return { content: [{ type: "text" as const, text: msg }] };
    }
  );
}

function buildTaskTitle(task: ParsedTask): string {
  const parts: string[] = [task.id];
  if (task.parallel) parts.push("[P]");
  if (task.story) parts.push(`[${task.story}]`);
  parts.push(task.description);
  return parts.join(" ");
}

function findTaskByLabel(
  entry: OpenDocEntry,
  containerId: string,
  label: string
): MindMapNode | undefined {
  const container = entry.doc.nodeIndex.get(containerId);
  if (!container) return undefined;
  return container.children.find((c) => c.labels?.includes(label));
}
