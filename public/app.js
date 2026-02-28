/* global jsMind */

const API = "/api";
let jm = null;
let currentMap = null;
let zoomScale = 1;

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

function setStatus(msg, isError) {
  status.textContent = msg;
  status.style.color = isError ? "#e94560" : "#53c587";
  if (!isError) setTimeout(() => { status.textContent = ""; }, 4000);
}

// --- Zoom ---

function applyZoom(scale) {
  zoomScale = Math.max(0.3, Math.min(3, scale));
  const container = document.getElementById("jsmind-container");
  const inner = container.querySelector("jmnodes");
  const canvas = container.querySelector("canvas");
  if (inner) inner.style.transform = `scale(${zoomScale})`;
  if (inner) inner.style.transformOrigin = "center center";
  if (canvas) {
    canvas.style.transform = `scale(${zoomScale})`;
    canvas.style.transformOrigin = "center center";
  }
  zoomLevel.textContent = Math.round(zoomScale * 100) + "%";
}

function zoomIn() { applyZoom(zoomScale + 0.15); }
function zoomOut() { applyZoom(zoomScale - 0.15); }
function zoomFit() { applyZoom(1); }

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
    applyZoom(1);
    jm.show(data);
    btnSave.disabled = false;
    btnDelete.disabled = false;
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
btnAddRel.addEventListener("click", addRelationship);

// Ctrl+S to save
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "s") {
    e.preventDefault();
    saveMap();
  }
});

// --- Init ---

initJsMind();
loadMapList();
