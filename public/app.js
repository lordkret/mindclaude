/* global jsMind */

const API = "/api";
let jm = null;
let currentMap = null;
let zoomScale = 1;
const undoStack = [];
const MAX_UNDO = 50;
let clipboard = null; // { node, children[] } for copy/cut

const selector = document.getElementById("map-selector");
const btnSave = document.getElementById("btn-save");
const btnNew = document.getElementById("btn-new");
const btnDelete = document.getElementById("btn-delete");
const btnSidebar = document.getElementById("btn-sidebar");
const btnCloseSidebar = document.getElementById("btn-close-sidebar");
const sidebar = document.getElementById("sidebar");
const status = document.getElementById("status");
const relList = document.getElementById("rel-list");
const btnAddRel = document.getElementById("btn-add-rel");
const btnZoomIn = document.getElementById("btn-zoom-in");
const btnZoomOut = document.getElementById("btn-zoom-out");
const btnZoomFit = document.getElementById("btn-zoom-fit");
const zoomLevel = document.getElementById("zoom-level");
const btnCollapseAll = document.getElementById("btn-collapse-all");
const btnExpandAll = document.getElementById("btn-expand-all");
const btnCollapseSel = document.getElementById("btn-collapse-sel");
const btnExpandSel = document.getElementById("btn-expand-sel");
const btnUndo = document.getElementById("btn-undo");
const btnReload = document.getElementById("btn-reload");
const btnAddNode = document.getElementById("btn-add-node");
const btnDelNode = document.getElementById("btn-del-node");
const btnCopy = document.getElementById("btn-copy");
const btnCut = document.getElementById("btn-cut");
const btnPaste = document.getElementById("btn-paste");

function setStatus(msg, isError) {
  status.textContent = msg;
  status.style.color = isError ? "#e94560" : "#53c587";
  if (!isError) setTimeout(() => { status.textContent = ""; }, 4000);
}

// --- Zoom ---

let zoomOffsetX = 0;
let zoomOffsetY = 0;

function applyZoom(scale, ox, oy) {
  zoomScale = Math.max(0.2, Math.min(3, scale));
  if (ox !== undefined) zoomOffsetX = ox;
  if (oy !== undefined) zoomOffsetY = oy;
  const ctr = document.getElementById("jsmind-container");
  const inner = ctr.querySelector("jmnodes");
  const canvas = ctr.querySelector("canvas");
  const tf = `translate(${zoomOffsetX}px, ${zoomOffsetY}px) scale(${zoomScale})`;
  const origin = "center center";
  if (inner) { inner.style.transform = tf; inner.style.transformOrigin = origin; }
  if (canvas) { canvas.style.transform = tf; canvas.style.transformOrigin = origin; }
  zoomLevel.textContent = Math.round(zoomScale * 100) + "%";
}

function zoomIn() { applyZoom(zoomScale + 0.15); }
function zoomOut() { applyZoom(zoomScale - 0.15); }

function zoomFit() {
  const ctr = document.getElementById("jsmind-container");
  const inner = ctr.querySelector("jmnodes");
  if (!inner) { applyZoom(1, 0, 0); return; }
  // Reset transform to measure true layout
  inner.style.transform = "none";
  const canvas = ctr.querySelector("canvas");
  if (canvas) canvas.style.transform = "none";

  // Force reflow so measurements are accurate
  void inner.offsetHeight;

  const nodes = inner.querySelectorAll("jmnode");
  if (nodes.length === 0) { applyZoom(1, 0, 0); return; }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const ctrRect = ctr.getBoundingClientRect();
  for (const n of nodes) {
    if (n.offsetParent === null) continue;
    const r = n.getBoundingClientRect();
    minX = Math.min(minX, r.left - ctrRect.left);
    minY = Math.min(minY, r.top - ctrRect.top);
    maxX = Math.max(maxX, r.right - ctrRect.left);
    maxY = Math.max(maxY, r.bottom - ctrRect.top);
  }
  const contentW = maxX - minX;
  const contentH = maxY - minY;
  if (contentW <= 0 || contentH <= 0) { applyZoom(1, 0, 0); return; }

  const pad = 30;
  const scaleX = (ctrRect.width - pad * 2) / contentW;
  const scaleY = (ctrRect.height - pad * 2) / contentH;
  const fitScale = Math.min(scaleX, scaleY, 1.5);
  const scale = Math.max(0.2, fitScale);

  // Content center in unscaled coords (relative to container center)
  const contentCenterX = (minX + maxX) / 2;
  const contentCenterY = (minY + maxY) / 2;
  const viewCenterX = ctrRect.width / 2;
  const viewCenterY = ctrRect.height / 2;

  // Offset to move content center to viewport center
  const ox = (viewCenterX - contentCenterX);
  const oy = (viewCenterY - contentCenterY);

  applyZoom(scale, ox, oy);
}

// --- Collapse / Expand ---

function forEachNode(node, depth, fn) {
  fn(node, depth);
  if (node.children) {
    for (const child of node.children) {
      forEachNode(child, depth + 1, fn);
    }
  }
}

function collapseAll() {
  if (!jm || !jm.mind || !jm.mind.root) return;
  // Collapse all nodes at depth >= 1 (keep root + first level visible)
  forEachNode(jm.mind.root, 0, (node, depth) => {
    if (depth >= 1 && node.children && node.children.length > 0) {
      jm.collapse_node(node);
    }
  });
}

function expandAll() {
  if (!jm || !jm.mind || !jm.mind.root) return;
  forEachNode(jm.mind.root, 0, (node) => {
    if (node.children && node.children.length > 0) {
      jm.expand_node(node);
    }
  });
}

function collapseSel() {
  if (!jm) return;
  const selected = jm.get_selected_node();
  if (!selected) { setStatus("Select a node first", true); return; }
  // Collapse selected and all its descendants
  forEachNode(selected, 0, (node) => {
    if (node.children && node.children.length > 0) {
      jm.collapse_node(node);
    }
  });
}

function expandSel() {
  if (!jm) return;
  const selected = jm.get_selected_node();
  if (!selected) { setStatus("Select a node first", true); return; }
  forEachNode(selected, 0, (node) => {
    if (node.children && node.children.length > 0) {
      jm.expand_node(node);
    }
  });
}

// --- Undo ---

function pushUndo() {
  if (!jm || !currentMap) return;
  try {
    const snapshot = jm.get_data("node_array");
    undoStack.push(JSON.stringify(snapshot));
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    btnUndo.disabled = false;
  } catch { /* ignore */ }
}

function undo() {
  if (!jm || !currentMap || undoStack.length === 0) return;
  const snapshot = JSON.parse(undoStack.pop());
  jm.show(snapshot);
  btnUndo.disabled = undoStack.length === 0;
  setStatus("Undone");
}

// Auto-capture snapshots on edits
function startUndoCapture() {
  if (!jm) return;
  // Capture before node changes via jsMind events
  jm.add_event_listener((type) => {
    // type 1=show, 2=resize, 3=edit, 4=select
    if (type === 3) pushUndo();
  });
  // Also capture periodically for drag operations (jsMind doesn't fire edit on drag-drop)
  let lastData = "";
  setInterval(() => {
    if (!jm || !currentMap) return;
    try {
      const cur = JSON.stringify(jm.get_data("node_array"));
      if (cur !== lastData && lastData !== "") {
        undoStack.push(lastData);
        if (undoStack.length > MAX_UNDO) undoStack.shift();
        btnUndo.disabled = false;
      }
      lastData = cur;
    } catch { /* ignore */ }
  }, 2000);
}

// --- Reload ---

async function reloadMap() {
  if (!currentMap) return;
  pushUndo(); // save current state before reload so user can undo
  await loadMap(currentMap);
  setStatus(`Reloaded "${currentMap}"`);
}

// --- Add / Delete node ---

function addNode() {
  if (!jm) return;
  const selected = jm.get_selected_node();
  if (!selected) { setStatus("Select a node first", true); return; }
  const topic = prompt("Node text:");
  if (!topic) return;
  pushUndo();
  const id = crypto.randomUUID().slice(0, 8);
  jm.add_node(selected, id, topic);
}

function delNode() {
  if (!jm) return;
  const selected = jm.get_selected_node();
  if (!selected) { setStatus("Select a node first", true); return; }
  if (selected.isroot) { setStatus("Cannot delete root node", true); return; }
  pushUndo();
  jm.remove_node(selected);
}

// --- Copy / Cut / Paste ---

function copySubtree(node) {
  const item = { id: node.id, topic: node.topic, children: [] };
  if (node.children) {
    for (const child of node.children) {
      item.children.push(copySubtree(child));
    }
  }
  return item;
}

function copyNode() {
  if (!jm) return;
  const selected = jm.get_selected_node();
  if (!selected) { setStatus("Select a node first", true); return; }
  clipboard = copySubtree(selected);
  btnPaste.disabled = !jm.get_selected_node();
  setStatus("Copied");
}

function cutNode() {
  if (!jm) return;
  const selected = jm.get_selected_node();
  if (!selected) { setStatus("Select a node first", true); return; }
  if (selected.isroot) { setStatus("Cannot cut root node", true); return; }
  clipboard = copySubtree(selected);
  pushUndo();
  jm.remove_node(selected);
  btnPaste.disabled = false;
  setStatus("Cut");
}

function pasteSubtree(parent, item) {
  const newId = crypto.randomUUID().slice(0, 8);
  const node = jm.add_node(parent, newId, item.topic);
  for (const child of item.children) {
    pasteSubtree(node, child);
  }
}

function pasteNode() {
  if (!jm || !clipboard) { setStatus("Nothing to paste", true); return; }
  const selected = jm.get_selected_node();
  if (!selected) { setStatus("Select a target node first", true); return; }
  pushUndo();
  pasteSubtree(selected, clipboard);
  setStatus("Pasted");
}

// --- Double-click to toggle collapse/expand ---

function setupDblClickToggle() {
  const ctr = document.getElementById("jsmind-container");
  ctr.addEventListener("dblclick", (e) => {
    if (!jm) return;
    const selected = jm.get_selected_node();
    if (!selected || !selected.children || selected.children.length === 0) return;
    jm.toggle_node(selected);
  });
}

// --- Selection tracking ---

function setupSelectionTracking() {
  if (!jm) return;
  jm.add_event_listener((type) => {
    // type 4 = select
    if (type === 4) {
      const sel = jm.get_selected_node();
      const hasSelection = !!sel;
      btnAddNode.disabled = !hasSelection;
      btnDelNode.disabled = !hasSelection || (sel && sel.isroot);
      btnCopy.disabled = !hasSelection;
      btnCut.disabled = !hasSelection || (sel && sel.isroot);
      btnPaste.disabled = !hasSelection || !clipboard;
    }
  });
}

// --- Map list ---

async function loadMapList() {
  const res = await fetch(`${API}/maps`);
  const maps = await res.json();
  const current = selector.value;
  selector.innerHTML = '<option value="">— Select a map —</option>';
  maps.sort((a, b) => a.name.localeCompare(b.name));
  for (const m of maps) {
    const opt = document.createElement("option");
    opt.value = m.name;
    opt.textContent = m.name;
    selector.appendChild(opt);
  }
  if (current) selector.value = current;
}

// --- jsMind init ---

function initJsMind() {
  const options = {
    container: "jsmind-container",
    editable: true,
    theme: "primary",
    support_html: false,
    view: {
      engine: "canvas",
      hmargin: 100,
      vmargin: 50,
    },
    layout: {
      hspace: 50,
      vspace: 16,
    },
  };
  jm = new jsMind(options);
}

// --- Load map ---

async function loadMap(name) {
  if (!name) {
    currentMap = null;
    btnSave.disabled = true;
    btnDelete.disabled = true;
    btnUndo.disabled = true;
    btnReload.disabled = true;
    undoStack.length = 0;
    if (jm) jm.show({ meta: { name: "", author: "" }, format: "node_array", data: [] });
    relList.innerHTML = "";
    return;
  }

  try {
    const res = await fetch(`${API}/maps/${encodeURIComponent(name)}`);
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    currentMap = name;
    zoomScale = 1;
    zoomOffsetX = 0;
    zoomOffsetY = 0;
    applyZoom(1, 0, 0);
    jm.show(data);
    btnSave.disabled = false;
    btnDelete.disabled = false;
    btnReload.disabled = false;
    btnUndo.disabled = undoStack.length === 0;
    setStatus(`Loaded "${name}"`);
    loadRelationships(name);
  } catch (e) {
    setStatus(`Error loading map: ${e.message}`, true);
  }
}

// --- Save map ---

async function saveMap() {
  if (!currentMap || !jm) return;
  const data = jm.get_data("node_array");
  try {
    const res = await fetch(`${API}/maps/${encodeURIComponent(currentMap)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(await res.text());
    const result = await res.json();
    const gitMsg = result.git && !result.git.includes("error") ? " + committed" : "";
    setStatus(`Saved "${currentMap}"${gitMsg}`);
  } catch (e) {
    setStatus(`Error saving: ${e.message}`, true);
  }
}

// --- New map ---

async function createMap() {
  const name = prompt("Map name:");
  if (!name) return;
  try {
    const res = await fetch(`${API}/maps`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error);
    }
    await loadMapList();
    selector.value = name;
    await loadMap(name);
    setStatus(`Created "${name}"`);
  } catch (e) {
    setStatus(`Error: ${e.message}`, true);
  }
}

// --- Delete map ---

async function deleteMap() {
  if (!currentMap) return;
  if (!confirm(`Delete "${currentMap}"?`)) return;
  try {
    const res = await fetch(`${API}/maps/${encodeURIComponent(currentMap)}`, { method: "DELETE" });
    if (!res.ok) throw new Error(await res.text());
    setStatus(`Deleted "${currentMap}"`);
    currentMap = null;
    selector.value = "";
    btnSave.disabled = true;
    btnDelete.disabled = true;
    jm.show({ meta: { name: "", author: "" }, format: "node_array", data: [] });
    relList.innerHTML = "";
    await loadMapList();
  } catch (e) {
    setStatus(`Error: ${e.message}`, true);
  }
}

// --- Sidebar toggle (mobile) ---

function toggleSidebar() {
  sidebar.classList.toggle("open");
  btnCloseSidebar.style.display = sidebar.classList.contains("open") ? "block" : "none";
}

// --- Relationships ---

async function loadRelationships(name) {
  try {
    const res = await fetch(`${API}/maps/${encodeURIComponent(name)}/relationships`);
    if (!res.ok) return;
    const rels = await res.json();
    renderRelationships(rels);
  } catch { /* ignore */ }
}

function renderRelationships(rels) {
  relList.innerHTML = "";
  for (const r of rels) {
    const li = document.createElement("li");
    const label = r.title ? `"${r.title}"` : "";
    li.innerHTML = `<span>${r.end1Id} ↔ ${r.end2Id} ${label}</span>
      <span class="rel-remove" data-id="${r.id}" title="Remove">×</span>`;
    relList.appendChild(li);
  }
  relList.querySelectorAll(".rel-remove").forEach((btn) => {
    btn.addEventListener("click", () => removeRelationship(btn.dataset.id));
  });
}

async function removeRelationship(relId) {
  if (!currentMap) return;
  try {
    const res = await fetch(`${API}/maps/${encodeURIComponent(currentMap)}/relationships`);
    const rels = await res.json();
    const updated = rels.filter((r) => r.id !== relId);
    await fetch(`${API}/maps/${encodeURIComponent(currentMap)}/relationships`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updated),
    });
    renderRelationships(updated);
  } catch (e) {
    setStatus(`Error: ${e.message}`, true);
  }
}

async function addRelationship() {
  if (!currentMap) return;
  const end1 = document.getElementById("rel-end1").value.trim();
  const end2 = document.getElementById("rel-end2").value.trim();
  const title = document.getElementById("rel-title").value.trim();
  if (!end1 || !end2) { setStatus("Both node IDs required", true); return; }
  try {
    const res = await fetch(`${API}/maps/${encodeURIComponent(currentMap)}/relationships`);
    const rels = await res.json();
    rels.push({ id: crypto.randomUUID().slice(0, 8), end1Id: end1, end2Id: end2, title: title || undefined });
    await fetch(`${API}/maps/${encodeURIComponent(currentMap)}/relationships`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rels),
    });
    renderRelationships(rels);
    document.getElementById("rel-end1").value = "";
    document.getElementById("rel-end2").value = "";
    document.getElementById("rel-title").value = "";
  } catch (e) {
    setStatus(`Error: ${e.message}`, true);
  }
}

// --- Pinch-to-zoom (touch) ---

let pinchStartDist = 0;
let pinchStartScale = 1;

function getTouchDist(e) {
  const [a, b] = [e.touches[0], e.touches[1]];
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

const container = document.getElementById("jsmind-container");

container.addEventListener("touchstart", (e) => {
  if (e.touches.length === 2) {
    e.preventDefault();
    pinchStartDist = getTouchDist(e);
    pinchStartScale = zoomScale;
  }
}, { passive: false });

container.addEventListener("touchmove", (e) => {
  if (e.touches.length === 2) {
    e.preventDefault();
    const dist = getTouchDist(e);
    const scale = pinchStartScale * (dist / pinchStartDist);
    applyZoom(scale);
  }
}, { passive: false });

// Mouse wheel zoom
container.addEventListener("wheel", (e) => {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    applyZoom(zoomScale - e.deltaY * 0.002);
  }
}, { passive: false });

// --- Events ---

selector.addEventListener("change", () => loadMap(selector.value));
btnSave.addEventListener("click", saveMap);
btnNew.addEventListener("click", createMap);
btnDelete.addEventListener("click", deleteMap);
btnSidebar.addEventListener("click", toggleSidebar);
btnCloseSidebar.addEventListener("click", toggleSidebar);
btnZoomIn.addEventListener("click", zoomIn);
btnZoomOut.addEventListener("click", zoomOut);
btnZoomFit.addEventListener("click", zoomFit);
btnCollapseAll.addEventListener("click", collapseAll);
btnExpandAll.addEventListener("click", expandAll);
btnCollapseSel.addEventListener("click", collapseSel);
btnExpandSel.addEventListener("click", expandSel);
btnUndo.addEventListener("click", undo);
btnReload.addEventListener("click", reloadMap);
btnAddNode.addEventListener("click", addNode);
btnDelNode.addEventListener("click", delNode);
btnCopy.addEventListener("click", copyNode);
btnCut.addEventListener("click", cutNode);
btnPaste.addEventListener("click", pasteNode);
btnAddRel.addEventListener("click", addRelationship);

// Keyboard shortcuts
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "s") {
    e.preventDefault();
    saveMap();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === "z") {
    e.preventDefault();
    undo();
  }
  if (e.key === "Delete" || e.key === "Backspace") {
    // Only delete if not editing a text input
    if (e.target.tagName !== "INPUT" && e.target.tagName !== "TEXTAREA" && !e.target.isContentEditable) {
      delNode();
    }
  }
  if ((e.ctrlKey || e.metaKey) && e.key === "c" && e.target.tagName !== "INPUT") {
    e.preventDefault();
    copyNode();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === "x" && e.target.tagName !== "INPUT") {
    e.preventDefault();
    cutNode();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === "v" && e.target.tagName !== "INPUT") {
    e.preventDefault();
    pasteNode();
  }
  if (e.key === "Tab" && currentMap) {
    e.preventDefault();
    addNode();
  }
});

// --- Init ---

initJsMind();
startUndoCapture();
setupDblClickToggle();
setupSelectionTracking();
loadMapList();
