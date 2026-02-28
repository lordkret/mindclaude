import { MindMapDocument, MindMapNode, Relationship } from "../model/types.js";
import { countDescendants, activeSheet } from "../model/mindmap.js";

interface RenderContext {
  crossLinkMap: Map<string, number[]>;
  crossLinks: { num: number; rel: Relationship; node1: MindMapNode; node2: MindMapNode }[];
}

export function renderMap(doc: MindMapDocument): string {
  const sheet = activeSheet(doc);
  const ctx = buildCrossLinkContext(doc, sheet.relationships);

  const root = doc.focusNodeId ? doc.nodeIndex.get(doc.focusNodeId) : sheet.rootTopic;
  if (!root) return "(empty map)";

  const lines: string[] = [];

  if (doc.focusNodeId) {
    lines.push(`[focused on ${root.id}]`);
    lines.push("");
  }

  if (doc.sheets.length > 1) {
    lines.push(`Sheet: ${sheet.title} (${doc.activeSheetIndex + 1}/${doc.sheets.length})`);
    lines.push("");
  }

  // Render root
  lines.push(`[${root.id}] ${root.title}${nodeSuffix(root, ctx)}`);

  if (!root.folded) {
    renderChildren(root.children, "  ", lines, ctx);
  }

  if (ctx.crossLinks.length > 0) {
    lines.push("");
    lines.push("--- Cross-links ---");
    for (const cl of ctx.crossLinks) {
      const titlePart = cl.rel.title ? `"${cl.rel.title}"` : "";
      const arrow = titlePart ? `<--${titlePart}-->` : "<-->";
      lines.push(
        `  ~${cl.num}  [${cl.node1.id}] ${cl.node1.title} ${arrow} [${cl.node2.id}] ${cl.node2.title}`
      );
    }
  }

  return lines.join("\n");
}

function buildCrossLinkContext(
  doc: MindMapDocument,
  relationships: Relationship[]
): RenderContext {
  const crossLinkMap = new Map<string, number[]>();
  const crossLinks: RenderContext["crossLinks"] = [];

  relationships.forEach((rel, idx) => {
    const num = idx + 1;
    const node1 = doc.nodeIndex.get(rel.end1Id);
    const node2 = doc.nodeIndex.get(rel.end2Id);
    if (!node1 || !node2) return;

    crossLinks.push({ num, rel, node1, node2 });

    if (!crossLinkMap.has(rel.end1Id)) crossLinkMap.set(rel.end1Id, []);
    crossLinkMap.get(rel.end1Id)!.push(num);

    if (!crossLinkMap.has(rel.end2Id)) crossLinkMap.set(rel.end2Id, []);
    crossLinkMap.get(rel.end2Id)!.push(num);
  });

  return { crossLinkMap, crossLinks };
}

function nodeSuffix(node: MindMapNode, ctx: RenderContext): string {
  const parts: string[] = [];
  if (node.folded && node.children.length > 0) {
    parts.push(`[+${countDescendants(node)}]`);
  }
  const linkRefs = ctx.crossLinkMap.get(node.id);
  if (linkRefs) {
    parts.push(...linkRefs.map((n) => `~${n}`));
  }
  return parts.length > 0 ? "  " + parts.join(" ") : "";
}

function renderChildren(
  children: MindMapNode[],
  indent: string,
  lines: string[],
  ctx: RenderContext
): void {
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const isLast = i === children.length - 1;
    const connector = isLast ? "`-- " : "|-- ";
    const childIndent = indent + (isLast ? "    " : "|   ");

    lines.push(`${indent}${connector}[${child.id}] ${child.title}${nodeSuffix(child, ctx)}`);

    if (!child.folded && child.children.length > 0) {
      renderChildren(child.children, childIndent, lines, ctx);
    }
  }
}
