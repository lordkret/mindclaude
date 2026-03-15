import { MindMapNode, MindMapDocument } from "../model/types.js";
import { slugify } from "./storage.js";

export interface VaultNoteData {
  id: string;
  title: string;
  body: string;
}

function findNodeById(doc: MindMapDocument, id: string): MindMapNode | null {
  function search(node: MindMapNode): MindMapNode | null {
    if (node.id === id) return node;
    for (const child of node.children) {
      const found = search(child);
      if (found) return found;
    }
    return null;
  }
  for (const sheet of doc.sheets) {
    const found = search(sheet.rootTopic);
    if (found) return found;
  }
  return null;
}

export function stripHtml(text: string): string {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function wikilink(node: MindMapNode): string {
  const cleanTitle = stripHtml(node.title);
  const slug = slugify(cleanTitle);
  const shortId = node.id.slice(0, 8);
  const target = slug ? `${slug}--${shortId}` : shortId;
  return `[[${target}|${cleanTitle}]]`;
}

/** Depth of a node within the tree (0 = root) */
function nodeDepth(doc: MindMapDocument, nodeId: string): number {
  let depth = 0;
  let currentId: string | undefined = nodeId;
  while (currentId) {
    const parentId = doc.parentIndex.get(currentId);
    if (!parentId) break;
    depth++;
    currentId = parentId;
  }
  return depth;
}

/** Whether a node qualifies for its own vault file */
export function isDocumentNode(node: MindMapNode, depth: number): boolean {
  if (node.children.length === 0) return false;
  const hasGrandchildren = node.children.some(c => c.children.length > 0);
  return (hasGrandchildren && node.children.length >= 3) || (depth <= 1);
}

/** Render an inlined subtree as markdown lines */
function renderInlined(node: MindMapNode, headingLevel: number, docNodeDepth: number, doc: MindMapDocument, lines: string[]): void {
  const title = stripHtml(node.title);

  if (node.children.length === 0) {
    // Leaf node — bullet with optional notes
    if (node.notes) {
      const firstLine = node.notes.split("\n")[0];
      const hasMultiline = node.notes.includes("\n");
      lines.push(`- **${title}** — ${firstLine}`);
      if (hasMultiline) {
        // Indent continuation lines under the bullet
        for (const line of node.notes.split("\n").slice(1)) {
          lines.push(`  ${line}`);
        }
      }
    } else {
      lines.push(`- ${title}`);
    }
    return;
  }

  // Branch node being inlined — use heading (cap at h4)
  const hLevel = Math.min(headingLevel, 4);
  const prefix = "#".repeat(hLevel);
  lines.push(`${prefix} ${title}`);
  if (node.notes) {
    lines.push("");
    lines.push(node.notes);
  }
  lines.push("");

  for (const child of node.children) {
    const childDepth = nodeDepth(doc, child.id);
    if (isDocumentNode(child, childDepth)) {
      // This child gets its own file — link to it
      lines.push(`- ${wikilink(child)}`);
    } else {
      renderInlined(child, headingLevel + 1, docNodeDepth, doc, lines);
    }
  }
  lines.push("");
}

export function nodeToMarkdown(
  node: MindMapNode,
  _project: string,
  parentId: string | undefined,
  doc: MindMapDocument,
): string {
  const cleanTitle = stripHtml(node.title);
  const depth = nodeDepth(doc, node.id);
  const lines: string[] = [
    "---",
    `id: ${node.id}`,
    "---",
    `# ${cleanTitle}`,
    "",
  ];

  // Node notes as body prose
  if (node.notes) {
    lines.push(node.notes);
    lines.push("");
  }

  // Parent as "Up:" link
  if (parentId) {
    const parentNode = findNodeById(doc, parentId);
    if (parentNode) {
      lines.push(`**Up:** ${wikilink(parentNode)}`);
      lines.push("");
    }
  }

  // Render children — inline or link based on document-node status
  for (const child of node.children) {
    const childDepth = depth + 1;
    if (isDocumentNode(child, childDepth)) {
      // Child gets its own file — render as wikilink with brief description
      if (child.notes) {
        const firstLine = child.notes.split("\n")[0];
        lines.push(`- ${wikilink(child)} — ${firstLine}`);
      } else {
        lines.push(`- ${wikilink(child)}`);
      }
    } else {
      renderInlined(child, 2, depth, doc, lines);
    }
  }
  lines.push("");

  return lines.join("\n");
}

export function markdownToNodeData(content: string): VaultNoteData | null {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!fmMatch) return null;

  const frontmatter = fmMatch[1];
  const body = fmMatch[2];

  // Extract id from frontmatter
  const idMatch = frontmatter.match(/^id:\s*(.+)$/m);
  if (!idMatch) return null;
  const id = idMatch[1].trim().replace(/^["']|["']$/g, "");

  // Parse H1 as title
  const h1Match = body.match(/^#\s+(.+)$/m);
  const title = h1Match ? h1Match[1].trim() : "";

  // Parse body prose: everything between H1 and the structured content section
  // Structured content starts with **Up:**, "- [[", "- **", "## ", or bare "- "
  const bodyLines = body.split("\n");
  const h1Index = bodyLines.findIndex(l => /^#\s+/.test(l));
  if (h1Index === -1) return { id, title, body: "" };

  const proseLines: string[] = [];
  for (let i = h1Index + 1; i < bodyLines.length; i++) {
    const line = bodyLines[i];
    if (/^\*\*Up:\*\*/.test(line) || /^## /.test(line) || /^- /.test(line)) break;
    proseLines.push(line);
  }

  const prose = proseLines.join("\n").trim();
  return { id, title, body: prose };
}
