/* global jsMind */

const API = "/api";
let jm = null;
let currentMap = null;

const selector = document.getElementById("map-selector");
const btnSave = document.getElementById("btn-save");
const btnNew = document.getElementById("btn-new");
const btnDelete = document.getElementById("btn-delete");
const status = document.getElementById("status");
const relList = document.getElementById("rel-list");
const btnAddRel = document.getElementById("btn-add-rel");

function setStatus(msg, isError) {
  status.textContent = msg;
  status.style.color = isError ? "#e94560" : "#53c587";
  if (!isError) setTimeout(() => { status.textContent = ""; }, 4000);
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
      hmargin: 120,
      vmargin: 60,
    },
    layout: {
      hspace: 60,
      vspace: 20,
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

// --- Events ---

selector.addEventListener("change", () => loadMap(selector.value));
btnSave.addEventListener("click", saveMap);
btnNew.addEventListener("click", createMap);
btnDelete.addEventListener("click", deleteMap);
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
