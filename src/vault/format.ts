import { MindMapNode, MindMapDocument } from "../model/types.js";

export interface VaultNoteData {
  id: string;
  title: string;
  parent?: string;
  project: string;
  labels: string[];
  markers: string[];
  children: string[];
  synced_at: string;
  body: string;
}

function escapeYamlString(s: string): string {
  if (/[:\n"#\[\]{},|>&*!?%@`]/.test(s) || s.trim() !== s) {
    return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
  }
  return '"' + s + '"';
}

function formatYamlArray(items: string[]): string {
  if (items.length === 0) return "[]";
  return "[" + items.map(i => escapeYamlString(i)).join(", ") + "]";
}

export function nodeToMarkdown(
  node: MindMapNode,
  project: string,
  parentId: string | undefined,
  doc: MindMapDocument,
): string {
  const childLinks = node.children.map(c => {
    const slug = c.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
    const shortId = c.id.slice(0, 8);
    return `[[${slug}--${shortId}]]`;
  });

  const lines = [
    "---",
    `id: ${escapeYamlString(node.id)}`,
    `title: ${escapeYamlString(node.title)}`,
  ];

  if (parentId) {
    lines.push(`parent: ${escapeYamlString(parentId)}`);
  }

  lines.push(
    `project: ${escapeYamlString(project)}`,
    `labels: ${formatYamlArray(node.labels || [])}`,
    `markers: ${formatYamlArray(node.markers || [])}`,
    `children: ${formatYamlArray(childLinks)}`,
    `synced_at: ${escapeYamlString(new Date().toISOString())}`,
    "---",
    "",
  );

  if (node.notes) {
    lines.push(node.notes);
    lines.push("");
  }

  return lines.join("\n");
}

export function markdownToNodeData(content: string): VaultNoteData | null {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!fmMatch) return null;

  const frontmatter = fmMatch[1];
  const body = fmMatch[2].trim();

  function extractField(name: string): string {
    const re = new RegExp(`^${name}:\\s*(.+)$`, "m");
    const m = frontmatter.match(re);
    if (!m) return "";
    let val = m[1].trim();
    // Strip surrounding quotes
    if (val.startsWith('"') && val.endsWith('"')) {
      val = val.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
    return val;
  }

  function extractArray(name: string): string[] {
    const re = new RegExp(`^${name}:\\s*\\[(.*)\\]$`, "m");
    const m = frontmatter.match(re);
    if (!m) return [];
    const inner = m[1].trim();
    if (!inner) return [];
    // Parse comma-separated quoted strings
    const items: string[] = [];
    const itemRe = /"((?:[^"\\]|\\.)*)"/g;
    let im;
    while ((im = itemRe.exec(inner)) !== null) {
      items.push(im[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\"));
    }
    return items;
  }

  const id = extractField("id");
  if (!id) return null;

  return {
    id,
    title: extractField("title"),
    parent: extractField("parent") || undefined,
    project: extractField("project"),
    labels: extractArray("labels"),
    markers: extractArray("markers"),
    children: extractArray("children"),
    synced_at: extractField("synced_at"),
    body,
  };
}
