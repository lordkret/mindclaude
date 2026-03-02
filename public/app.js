/* global jsMind */

const API = "/api";
let jm = null;
let currentMap = null;
let zoomScale = 1;
const undoStack = [];
const MAX_UNDO = 50;
let clipboard = null; // { node, children[] } for copy/cut
let multiSelect = []; // up to 2 Ctrl+clicked nodes for link creation

const selector = document.getElementById("map-selector");
const btnSave = document.getElementById("btn-save");
const btnVersions = document.getElementById("btn-versions");
const btnNew = document.getElementById("btn-new");
const btnDelete = document.getElementById("btn-delete");
const status = document.getElementById("status");
const btnZoomIn = document.getElementById("btn-zoom-in");
const btnZoomOut = document.getElementById("btn-zoom-out");
const btnZoomFit = document.getElementById("btn-zoom-fit");
const zoomLevel = document.getElementById("zoom-level");
const btnCollapseAll = document.getElementById("btn-collapse-all");
const btnExpandAll = document.getElementById("btn-expand-all");
const btnCollapseSel = document.getElementById("btn-collapse-sel");
const btnExpandSel = document.getElementById("btn-expand-sel");
const btnLink = document.getElementById("btn-link");
const btnUndo = document.getElementById("btn-undo");
const btnReload = document.getElementById("btn-reload");
const btnAddNode = document.getElementById("btn-add-node");
const btnAddSibling = document.getElementById("btn-add-sibling");
const btnDelNode = document.getElementById("btn-del-node");
const btnFind = document.getElementById("btn-find");
const btnTheme = document.getElementById("btn-theme");
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
  applyDescIndicators();
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

// --- Node description helpers ---

// Build display topic: title + dot indicator if node has description
function buildDisplayTopic(title, hasDesc) {
  const escaped = escapeHtmlInline(title);
  if (hasDesc) {
    return escaped + '<span class="node-desc-indicator"></span>';
  }
  return escaped;
}

function escapeHtmlInline(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Get plain title from a node (strip HTML indicator)
function getPlainTitle(node) {
  if (!node || !node.topic) return "";
  return node.topic.replace(/<span class="node-desc-indicator"><\/span>/, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
}

// Get description stored in node data
function getNodeDesc(node) {
  if (!node || !node.data) return "";
  return node.data["notes"] || "";
}

// Set description on a node
function setNodeDesc(node, desc) {
  if (!node) return;
  if (!node.data) node.data = {};
  if (desc) {
    node.data["notes"] = desc;
  } else {
    delete node.data["notes"];
  }
}

// Apply description indicator dots to all nodes after load
function applyDescIndicators() {
  if (!jm || !jm.mind || !jm.mind.root) return;
  forEachNode(jm.mind.root, 0, (node) => {
    const hasDesc = !!(node.data && node.data["notes"]);
    const plain = getPlainTitle(node);
    const display = buildDisplayTopic(plain, hasDesc);
    if (node.topic !== display) {
      jm.update_node(node.id, display);
    }
  });
}

// --- Add / Delete node ---

function addNode() {
  if (!jm) return;
  const selected = jm.get_selected_node();
  if (!selected) { setStatus("Select a node first", true); return; }
  pushUndo();
  const id = crypto.randomUUID().slice(0, 8);
  const newNode = jm.add_node(selected, id, "New node");
  if (newNode) {
    jm.select_node(newNode);
    // Focus the title input in the editor
    setTimeout(() => {
      nodeTitleInput.select();
    }, 50);
  }
}

function addSibling() {
  if (!jm) return;
  const selected = jm.get_selected_node();
  if (!selected) { setStatus("Select a node first", true); return; }
  if (selected.isroot) { setStatus("Cannot add sibling to root", true); return; }
  pushUndo();
  const id = crypto.randomUUID().slice(0, 8);
  const newNode = jm.add_node(selected.parent, id, "New node");
  if (newNode) {
    jm.select_node(newNode);
    setTimeout(() => {
      nodeTitleInput.select();
    }, 50);
  }
}

function delNode() {
  if (!jm) return;
  const selected = jm.get_selected_node();
  if (!selected) { setStatus("Select a node first", true); return; }
  if (selected.isroot) { setStatus("Cannot delete root node", true); return; }
  pushUndo();
  jm.remove_node(selected);
  closeNodeEditor();
}

// --- Copy / Cut / Paste ---

function copySubtree(node) {
  const item = { id: node.id, topic: node.topic, desc: getNodeDesc(node), children: [] };
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
  const plainTitle = getPlainTitle({ topic: item.topic });
  const display = buildDisplayTopic(plainTitle, !!item.desc);
  const node = jm.add_node(parent, newId, display);
  if (node && item.desc) {
    setNodeDesc(node, item.desc);
  }
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

// --- Multi-select and node linking ---

function getJmNodeElement(nodeId) {
  return document.querySelector(`jmnode[nodeid="${nodeId}"]`);
}

function updateMultiSelectUI() {
  document.querySelectorAll("jmnode.multi-selected").forEach((el) => el.classList.remove("multi-selected"));
  for (const n of multiSelect) {
    const el = getJmNodeElement(n.id);
    if (el) el.classList.add("multi-selected");
  }
  btnLink.disabled = multiSelect.length !== 2;
}

function clearMultiSelect() {
  multiSelect = [];
  updateMultiSelectUI();
}

function setupMultiSelect() {
  const ctr = document.getElementById("jsmind-container");
  ctr.addEventListener("click", (e) => {
    if (!jm) return;
    if (!(e.ctrlKey || e.metaKey)) {
      if (multiSelect.length > 0) clearMultiSelect();
      return;
    }
    // Find the clicked jmnode element
    let el = e.target;
    while (el && el.tagName && el.tagName.toLowerCase() !== "jmnode" && el !== ctr) {
      el = el.parentElement;
    }
    if (!el || el.tagName.toLowerCase() !== "jmnode") return;
    const nodeId = el.getAttribute("nodeid");
    if (!nodeId) return;
    const node = jm.get_node(nodeId);
    if (!node) return;

    e.preventDefault();
    e.stopPropagation();

    const idx = multiSelect.findIndex((n) => n.id === nodeId);
    if (idx !== -1) {
      multiSelect.splice(idx, 1);
    } else {
      if (multiSelect.length >= 2) multiSelect.shift();
      multiSelect.push(node);
    }
    updateMultiSelectUI();
  }, true); // capture phase — fires before jsMind
}

async function createLink() {
  if (!jm || !currentMap || multiSelect.length !== 2) return;
  const [node1, node2] = multiSelect;
  try {
    const res = await fetch(`${API}/maps/${encodeURIComponent(currentMap)}/relationships`);
    const rels = await res.json();
    const newRel = { id: crypto.randomUUID().slice(0, 8), end1Id: node1.id, end2Id: node2.id };
    rels.push(newRel);
    await fetch(`${API}/maps/${encodeURIComponent(currentMap)}/relationships`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rels),
    });
    setStatus("Link created — enter label");
    showLinkLabelEditor(node2.id, newRel.id);
    clearMultiSelect();
  } catch (e) {
    setStatus(`Error: ${e.message}`, true);
  }
}

function showLinkLabelEditor(nodeId, relId) {
  const existing = document.getElementById("link-label-editor");
  if (existing) existing.remove();

  const input = document.createElement("input");
  input.id = "link-label-editor";
  input.type = "text";
  input.placeholder = "Label (Enter to save, Esc to skip)";

  // Position below the target node
  const nodeEl = getJmNodeElement(nodeId);
  if (nodeEl) {
    const rect = nodeEl.getBoundingClientRect();
    input.style.top = (rect.bottom + 8) + "px";
    input.style.left = rect.left + "px";
  } else {
    input.style.top = "50%";
    input.style.left = "50%";
    input.style.transform = "translate(-50%, -50%)";
  }

  document.body.appendChild(input);
  input.focus();

  let committed = false;

  async function saveLabel() {
    if (committed) return;
    committed = true;
    input.remove();
    const label = input.value.trim();
    if (!label) return;
    try {
      const res = await fetch(`${API}/maps/${encodeURIComponent(currentMap)}/relationships`);
      const rels = await res.json();
      const rel = rels.find((r) => r.id === relId);
      if (rel) {
        rel.title = label;
        await fetch(`${API}/maps/${encodeURIComponent(currentMap)}/relationships`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(rels),
        });
        setStatus("Link label saved");
      }
    } catch (err) {
      setStatus(`Error saving label: ${err.message}`, true);
    }
  }

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); saveLabel(); }
    if (e.key === "Escape") { committed = true; input.remove(); setStatus("Link created (no label)"); }
    e.stopPropagation();
  });
  input.addEventListener("blur", () => setTimeout(saveLabel, 120));
}

// --- Double-click to edit node ---

function setupDblClickEdit() {
  const ctr = document.getElementById("jsmind-container");
  ctr.addEventListener("dblclick", (e) => {
    if (!jm) return;
    // Find the clicked jmnode element
    let el = e.target;
    while (el && el.tagName && el.tagName.toLowerCase() !== "jmnode" && el !== ctr) {
      el = el.parentElement;
    }
    if (!el || el.tagName.toLowerCase() !== "jmnode") return;
    const selected = jm.get_selected_node();
    if (!selected) return;
    // Focus title input for editing
    if (nodeEditor.style.display !== "none") {
      nodeTitleInput.focus();
      nodeTitleInput.select();
    }
  });
}

// --- Node Editor Panel ---

const nodeEditor = document.getElementById("node-editor");
const nodeTitleInput = document.getElementById("node-title-input");
const nodeDescInput = document.getElementById("node-desc-input");
const nodeEditorClose = document.getElementById("node-editor-close");
const nodeEditorExpand = document.getElementById("node-editor-expand");
let editingNodeId = null;

function openNodeEditor(node) {
  if (!node) return;
  editingNodeId = node.id;
  nodeTitleInput.value = getPlainTitle(node);
  nodeDescInput.value = getNodeDesc(node);
  nodeEditor.style.display = "flex";
  nodeEditor.classList.remove("expanded");
  nodeEditorExpand.innerHTML = "&#x2922;"; // expand icon
}

function closeNodeEditor() {
  nodeEditor.style.display = "none";
  nodeEditor.classList.remove("expanded");
  editingNodeId = null;
}

function toggleEditorExpand() {
  nodeEditor.classList.toggle("expanded");
  if (nodeEditor.classList.contains("expanded")) {
    nodeEditorExpand.innerHTML = "&#x2923;"; // collapse icon
  } else {
    nodeEditorExpand.innerHTML = "&#x2922;"; // expand icon
  }
}

function applyNodeEditorChanges() {
  if (!jm || !editingNodeId) return;
  const node = jm.get_node(editingNodeId);
  if (!node) return;

  const newTitle = nodeTitleInput.value.trim() || "Untitled";
  const newDesc = nodeDescInput.value.trim();
  const oldTitle = getPlainTitle(node);
  const oldDesc = getNodeDesc(node);

  if (newTitle !== oldTitle || newDesc !== oldDesc) {
    pushUndo();
    setNodeDesc(node, newDesc);
    const display = buildDisplayTopic(newTitle, !!newDesc);
    jm.update_node(node.id, display);
  }
}

nodeTitleInput.addEventListener("input", applyNodeEditorChanges);
nodeDescInput.addEventListener("input", applyNodeEditorChanges);
nodeEditorClose.addEventListener("click", () => {
  closeNodeEditor();
  if (jm) jm.select_clear();
});
nodeEditorExpand.addEventListener("click", toggleEditorExpand);

// Prevent keyboard shortcuts while editing in the panel
nodeTitleInput.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { nodeTitleInput.blur(); return; }
  if (e.key === "Tab") { e.preventDefault(); nodeDescInput.focus(); return; }
  e.stopPropagation();
});
nodeDescInput.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { nodeDescInput.blur(); return; }
  e.stopPropagation();
});

// --- Selection tracking ---

function setupSelectionTracking() {
  if (!jm) return;
  jm.add_event_listener((type) => {
    // type 4 = select
    if (type === 4) {
      const sel = jm.get_selected_node();
      const hasSelection = !!sel;
      btnAddNode.disabled = !hasSelection;
      btnAddSibling.disabled = !hasSelection || (sel && sel.isroot);
      btnDelNode.disabled = !hasSelection || (sel && sel.isroot);
      btnCopy.disabled = !hasSelection;
      btnCut.disabled = !hasSelection || (sel && sel.isroot);
      btnPaste.disabled = !hasSelection || !clipboard;

      if (sel) {
        openNodeEditor(sel);
      } else {
        closeNodeEditor();
      }
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
    support_html: true,
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
    btnVersions.disabled = true;
    btnFind.disabled = true;
    btnDelete.disabled = true;
    btnUndo.disabled = true;
    btnReload.disabled = true;
    undoStack.length = 0;
    closeNodeEditor();
    if (jm) jm.show({ meta: { name: "", author: "" }, format: "node_array", data: [] });
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
    closeNodeEditor();
    clearMultiSelect();
    applyDescIndicators();
    btnSave.disabled = false;
    btnVersions.disabled = false;
    btnFind.disabled = false;
    btnDelete.disabled = false;
    btnReload.disabled = false;
    btnUndo.disabled = undoStack.length === 0;
    setStatus(`Loaded "${name}"`);
  } catch (e) {
    setStatus(`Error loading map: ${e.message}`, true);
  }
}

// --- Save Modal ---

const saveModal = document.getElementById("save-modal");
const saveComment = document.getElementById("save-comment");
const saveModalConfirm = document.getElementById("save-modal-confirm");
const saveModalCancel = document.getElementById("save-modal-cancel");
const saveSpinner = document.getElementById("save-spinner");

function openSaveModal() {
  if (!currentMap || !jm) return;
  saveComment.value = "";
  saveModal.style.display = "flex";
  saveSpinner.style.display = "none";
  saveModalConfirm.disabled = false;
  saveModalCancel.disabled = false;
  saveComment.focus();
}

function closeSaveModal() {
  saveModal.style.display = "none";
}

async function doSave() {
  if (!currentMap || !jm) return;
  saveModalConfirm.disabled = true;
  saveModalCancel.disabled = true;
  saveSpinner.style.display = "block";

  const data = jm.get_data("node_array");
  const comment = saveComment.value.trim();
  const body = { ...data, comment: comment || undefined };

  try {
    const res = await fetch(`${API}/maps/${encodeURIComponent(currentMap)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await res.text());
    const result = await res.json();
    closeSaveModal();
    const git = result.git || "";
    if (git.includes("Push skipped") || git.includes("Push failed")) {
      setStatus(`Saved "${currentMap}" (committed, push skipped)`);
    } else if (git.includes("No changes")) {
      setStatus(`No changes to save`);
    } else {
      setStatus(`Saved "${currentMap}" + pushed`);
    }
  } catch (e) {
    closeSaveModal();
    setStatus(`Error saving: ${e.message}`, true);
  }
}

saveModalConfirm.addEventListener("click", doSave);
saveModalCancel.addEventListener("click", closeSaveModal);
saveComment.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); doSave(); }
  if (e.key === "Escape") { e.preventDefault(); closeSaveModal(); }
});
saveModal.addEventListener("click", (e) => {
  if (e.target === saveModal) closeSaveModal();
});

// --- Versions Modal ---

const versionsModal = document.getElementById("versions-modal");
const versionsList = document.getElementById("versions-list");
const versionsSpinner = document.getElementById("versions-spinner");
const versionsLoadMore = document.getElementById("versions-load-more");
const versionsModalClose = document.getElementById("versions-modal-close");
let versionsOffset = 0;
const VERSIONS_LIMIT = 5;

function openVersionsModal() {
  if (!currentMap) return;
  versionsModal.style.display = "flex";
  versionsList.innerHTML = "";
  versionsOffset = 0;
  versionsLoadMore.style.display = "none";
  loadVersions();
}

function closeVersionsModal() {
  versionsModal.style.display = "none";
}

async function loadVersions() {
  versionsSpinner.style.display = "block";
  versionsLoadMore.style.display = "none";
  try {
    const res = await fetch(`${API}/maps/${encodeURIComponent(currentMap)}/versions?limit=${VERSIONS_LIMIT}&offset=${versionsOffset}`);
    if (!res.ok) throw new Error(await res.text());
    const entries = await res.json();
    for (const entry of entries) {
      const div = document.createElement("div");
      div.className = "version-item";
      const shortSha = entry.sha.slice(0, 7);
      const dateStr = new Date(entry.date).toLocaleString();
      const msgText = entry.message.length > 60 ? entry.message.slice(0, 57) + "..." : entry.message;
      div.innerHTML = `
        <div class="version-info">
          <div><span class="version-sha">${shortSha}</span><span class="version-msg">${escapeHtml(msgText)}</span></div>
          <div class="version-date">${dateStr}</div>
        </div>
        <button class="version-restore" data-sha="${entry.sha}" data-msg="${escapeHtml(entry.message)}">Restore</button>
      `;
      versionsList.appendChild(div);
    }
    versionsOffset += entries.length;
    versionsLoadMore.style.display = entries.length >= VERSIONS_LIMIT ? "inline-block" : "none";
  } catch (e) {
    setStatus(`Error loading versions: ${e.message}`, true);
  } finally {
    versionsSpinner.style.display = "none";
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

async function restoreVersion(sha, msg) {
  const shortSha = sha.slice(0, 7);
  if (!confirm(`Restore to version ${shortSha}?\n\n"${msg}"\n\nThis will overwrite current state and create a new commit.`)) return;
  closeVersionsModal();
  setStatus("Restoring...");
  try {
    const res = await fetch(`${API}/maps/${encodeURIComponent(currentMap)}/versions/${sha}/restore`, { method: "POST" });
    if (!res.ok) throw new Error(await res.text());
    const result = await res.json();
    if (result.data) {
      pushUndo();
      jm.show(result.data);
      applyDescIndicators();
    }
    setStatus(`Restored to ${shortSha}`);
  } catch (e) {
    setStatus(`Restore failed: ${e.message}`, true);
  }
}

versionsList.addEventListener("click", (e) => {
  const btn = e.target.closest(".version-restore");
  if (!btn) return;
  restoreVersion(btn.dataset.sha, btn.dataset.msg);
});
versionsLoadMore.addEventListener("click", loadVersions);
versionsModalClose.addEventListener("click", closeVersionsModal);
versionsModal.addEventListener("click", (e) => {
  if (e.target === versionsModal) closeVersionsModal();
});

// --- Find Modal ---

const findModal = document.getElementById("find-modal");
const findInput = document.getElementById("find-input");
const findResults = document.getElementById("find-results");
const findModalClose = document.getElementById("find-modal-close");

function openFindModal() {
  if (!jm || !currentMap) return;
  findModal.style.display = "flex";
  findInput.value = "";
  findResults.innerHTML = "";
  findInput.focus();
}

function closeFindModal() {
  findModal.style.display = "none";
}

function doFind() {
  if (!jm || !jm.mind) return;
  const query = findInput.value.trim().toLowerCase();
  findResults.innerHTML = "";
  if (!query) return;

  const results = [];
  forEachNode(jm.mind.root, 0, (node) => {
    const title = getPlainTitle(node).toLowerCase();
    const desc = getNodeDesc(node).toLowerCase();
    if (title.includes(query) || desc.includes(query)) {
      results.push(node);
    }
  });

  if (results.length === 0) {
    findResults.innerHTML = '<div style="text-align:center;padding:16px 0;color:var(--text-muted);font-size:13px;">No matches</div>';
    return;
  }

  for (const node of results) {
    const div = document.createElement("div");
    div.className = "find-result-item";
    const title = getPlainTitle(node);
    const desc = getNodeDesc(node);
    div.textContent = title + (desc ? " — " + desc.slice(0, 40) : "");
    div.addEventListener("click", () => {
      closeFindModal();
      // Expand parents so the node is visible
      let p = node.parent;
      while (p) {
        if (p._data && p._data.layout && !p._data.layout.visible) {
          jm.expand_node(p);
        }
        p = p.parent;
      }
      jm.select_node(node);
    });
    findResults.appendChild(div);
  }
}

findInput.addEventListener("input", doFind);
findInput.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { e.preventDefault(); closeFindModal(); }
  if (e.key === "Enter") {
    e.preventDefault();
    const first = findResults.querySelector(".find-result-item");
    if (first) first.click();
  }
});
findModalClose.addEventListener("click", closeFindModal);
findModal.addEventListener("click", (e) => {
  if (e.target === findModal) closeFindModal();
});

// --- Theme Toggle ---

let lightTheme = localStorage.getItem("mindclaude-theme") === "light";

function applyTheme() {
  document.body.classList.toggle("light", lightTheme);
  btnTheme.textContent = lightTheme ? "Dark" : "Light";
  localStorage.setItem("mindclaude-theme", lightTheme ? "light" : "dark");
}

function toggleTheme() {
  lightTheme = !lightTheme;
  applyTheme();
}

applyTheme();
btnTheme.addEventListener("click", toggleTheme);

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
    btnVersions.disabled = true;
    btnFind.disabled = true;
    btnDelete.disabled = true;
    jm.show({ meta: { name: "", author: "" }, format: "node_array", data: [] });
    await loadMapList();
  } catch (e) {
    setStatus(`Error: ${e.message}`, true);
  }
}


// --- Pinch-to-zoom (touch) and long-press to expand/collapse ---

let pinchStartDist = 0;
let pinchStartScale = 1;
let longPressTimer = null;

function getTouchDist(e) {
  const [a, b] = [e.touches[0], e.touches[1]];
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

const container = document.getElementById("jsmind-container");

container.addEventListener("touchstart", (e) => {
  if (e.touches.length === 2) {
    clearTimeout(longPressTimer); longPressTimer = null;
    e.preventDefault();
    pinchStartDist = getTouchDist(e);
    pinchStartScale = zoomScale;
    return;
  }
  if (e.touches.length === 1) {
    let el = e.target;
    while (el && el.tagName && el.tagName.toLowerCase() !== "jmnode" && el !== container) {
      el = el.parentElement;
    }
    if (el && el.tagName && el.tagName.toLowerCase() === "jmnode") {
      const nodeId = el.getAttribute("nodeid");
      longPressTimer = setTimeout(() => {
        longPressTimer = null;
        if (!jm || !nodeId) return;
        const node = jm.get_node(nodeId);
        if (node && node.children && node.children.length > 0) {
          jm.toggle_node(node);
        }
      }, 600);
    }
  }
}, { passive: false });

container.addEventListener("touchend", () => { clearTimeout(longPressTimer); longPressTimer = null; });
container.addEventListener("touchcancel", () => { clearTimeout(longPressTimer); longPressTimer = null; });

container.addEventListener("touchmove", (e) => {
  if (e.touches.length === 1) { clearTimeout(longPressTimer); longPressTimer = null; }
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
btnSave.addEventListener("click", openSaveModal);
btnVersions.addEventListener("click", openVersionsModal);
btnNew.addEventListener("click", createMap);
btnDelete.addEventListener("click", deleteMap);
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
btnAddSibling.addEventListener("click", addSibling);
btnDelNode.addEventListener("click", delNode);
btnFind.addEventListener("click", openFindModal);
btnCopy.addEventListener("click", copyNode);
btnCut.addEventListener("click", cutNode);
btnPaste.addEventListener("click", pasteNode);
btnLink.addEventListener("click", createLink);

// Keyboard shortcuts
document.addEventListener("keydown", (e) => {
  // Don't handle shortcuts when a modal is open (except Escape to close)
  const modalOpen = saveModal.style.display !== "none" || versionsModal.style.display !== "none" || findModal.style.display !== "none";

  if (e.key === "Escape") {
    if (saveModal.style.display !== "none") { closeSaveModal(); e.preventDefault(); return; }
    if (versionsModal.style.display !== "none") { closeVersionsModal(); e.preventDefault(); return; }
    if (findModal.style.display !== "none") { closeFindModal(); e.preventDefault(); return; }
  }

  if (modalOpen) return;

  if ((e.ctrlKey || e.metaKey) && e.key === "s") {
    e.preventDefault();
    openSaveModal();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === "f") {
    e.preventDefault();
    openFindModal();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === "z") {
    e.preventDefault();
    undo();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === "l") {
    e.preventDefault();
    createLink();
  }
  if (e.key === "Delete" || e.key === "Backspace") {
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
  if (e.key === "Tab" && currentMap && e.target.tagName !== "INPUT") {
    e.preventDefault();
    addNode();
  }
  if (e.key === "Insert" && currentMap && e.target.tagName !== "INPUT") {
    e.preventDefault();
    addNode();
  }
  if (e.key === "Enter" && currentMap && e.target.tagName !== "INPUT" && e.target.tagName !== "TEXTAREA" && !e.target.isContentEditable) {
    e.preventDefault();
    addSibling();
  }
});

// Capture-phase handler for arrow keys — runs before jsMind's own key handler
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.shiftKey) return;
  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
  if (e.key === "ArrowRight") {
    const sel = jm && jm.get_selected_node();
    if (sel && sel.children && sel.children.length > 0) {
      e.preventDefault();
      e.stopPropagation();
      jm.expand_node(sel);
    }
  }
  if (e.key === "ArrowLeft") {
    const sel = jm && jm.get_selected_node();
    if (sel && sel.children && sel.children.length > 0) {
      e.preventDefault();
      e.stopPropagation();
      jm.collapse_node(sel);
    }
  }
}, true);

// --- Mobile keyboard handling ---
// When virtual keyboard opens, shrink the layout so the editor stays visible
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", () => {
    const vvh = window.visualViewport.height;
    document.documentElement.style.height = vvh + "px";
    // Scroll editor into view if focused
    if (document.activeElement === nodeTitleInput || document.activeElement === nodeDescInput) {
      setTimeout(() => document.activeElement.scrollIntoView({ block: "nearest" }), 50);
    }
  });
}

// --- Init ---

initJsMind();
startUndoCapture();
setupDblClickEdit();
setupMultiSelect();
setupSelectionTracking();
loadMapList();
