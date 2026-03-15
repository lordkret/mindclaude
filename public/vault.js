// Vault Notes UI — vanilla JS
(function () {
  "use strict";

  const API = "/api/vault";

  // --- DOM refs ---
  const projectSelector = document.getElementById("project-selector");
  const btnSync = document.getElementById("btn-sync");
  const btnTheme = document.getElementById("btn-theme");
  const btnSearchToggle = document.getElementById("btn-search-toggle");
  const searchBar = document.getElementById("search-bar");
  const searchInput = document.getElementById("search-input");
  const noteListInner = document.getElementById("note-list-inner");
  const noteList = document.getElementById("note-list");
  const emptyState = document.getElementById("empty-state");
  const noteDetail = document.getElementById("note-detail");
  const btnBack = document.getElementById("btn-back");
  const detailTitle = document.getElementById("detail-title");
  const renderedContent = document.getElementById("rendered-content");
  const detailBody = document.getElementById("detail-body");
  const editArea = document.getElementById("edit-area");
  const editTextarea = document.getElementById("edit-textarea");
  const btnEdit = document.getElementById("btn-edit");
  const btnSave = document.getElementById("btn-save");
  const btnCancel = document.getElementById("btn-cancel");
  const toastContainer = document.getElementById("toast-container");

  // --- State ---
  let notes = [];
  let currentNote = null; // { id, title, filename, synced_at }
  let currentRaw = ""; // full raw markdown including frontmatter
  let editing = false;

  // --- Theme ---
  let lightTheme = localStorage.getItem("mindclaude-theme") === "light";
  function applyTheme() {
    document.body.classList.toggle("light", lightTheme);
    btnTheme.textContent = lightTheme ? "Dark" : "Light";
    localStorage.setItem("mindclaude-theme", lightTheme ? "light" : "dark");
  }
  btnTheme.addEventListener("click", () => { lightTheme = !lightTheme; applyTheme(); });
  applyTheme();

  // --- Toast ---
  function toast(msg, type) {
    const el = document.createElement("div");
    el.className = "toast" + (type ? " " + type : "");
    el.textContent = msg;
    toastContainer.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  // --- API helpers ---
  async function fetchJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
  }

  async function fetchText(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.text();
  }

  async function putJSON(url, body) {
    const res = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
  }

  async function postJSON(url) {
    const res = await fetch(url, { method: "POST" });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
  }

  // --- Frontmatter helpers ---
  function splitFrontmatter(raw) {
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!match) return { frontmatter: "", body: raw };
    return { frontmatter: match[1], body: match[2] };
  }

  function reconstructContent(frontmatter, body) {
    if (!frontmatter) return body;
    return `---\n${frontmatter}\n---\n${body}`;
  }

  // --- Projects ---
  async function loadProjects() {
    try {
      const projects = await fetchJSON(API + "/");
      projectSelector.innerHTML = "";
      if (projects.length === 0) {
        projectSelector.innerHTML = '<option value="">No projects</option>';
        return;
      }
      projects.forEach(p => {
        const opt = document.createElement("option");
        opt.value = p.name;
        opt.textContent = p.name;
        projectSelector.appendChild(opt);
      });
      // Auto-select if only one, or restore last selection
      const last = localStorage.getItem("vault-project");
      if (last && projects.some(p => p.name === last)) {
        projectSelector.value = last;
      }
      await loadNotes();
    } catch (e) {
      toast("Failed to load projects: " + e.message, "error");
    }
  }

  projectSelector.addEventListener("change", () => {
    localStorage.setItem("vault-project", projectSelector.value);
    loadNotes();
    hideDetail();
  });

  // --- Notes list ---
  async function loadNotes() {
    const project = projectSelector.value;
    if (!project) { notes = []; renderList(); return; }
    try {
      notes = await fetchJSON(`${API}/${encodeURIComponent(project)}`);
      notes.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
      renderList();
    } catch (e) {
      toast("Failed to load notes: " + e.message, "error");
    }
  }

  function renderList() {
    const query = (searchInput.value || "").toLowerCase();
    const filtered = query
      ? notes.filter(n => (n.title || "").toLowerCase().includes(query))
      : notes;

    noteListInner.innerHTML = "";
    emptyState.classList.toggle("hidden", filtered.length > 0);

    filtered.forEach(n => {
      const card = document.createElement("div");
      card.className = "note-card" + (currentNote && currentNote.id === n.id ? " active" : "");
      card.innerHTML = `
        <div class="note-card-title">${esc(n.title || n.filename)}</div>
        <div class="note-card-meta">${n.synced_at ? formatDate(n.synced_at) : "never synced"}</div>
      `;
      card.addEventListener("click", () => openNote(n));
      noteListInner.appendChild(card);
    });
  }

  searchInput.addEventListener("input", renderList);
  btnSearchToggle.addEventListener("click", () => {
    searchBar.classList.toggle("hidden");
    if (!searchBar.classList.contains("hidden")) {
      searchInput.focus();
    } else {
      searchInput.value = "";
      renderList();
    }
  });

  // --- Note detail ---
  async function openNote(note) {
    const project = projectSelector.value;
    try {
      currentRaw = await fetchText(`${API}/${encodeURIComponent(project)}/${encodeURIComponent(note.id)}`);
      currentNote = note;
      showDetail();
      renderNote();
      renderList(); // update active state
    } catch (e) {
      toast("Failed to load note: " + e.message, "error");
    }
  }

  function renderNote() {
    const { body } = splitFrontmatter(currentRaw);
    detailTitle.textContent = currentNote.title || currentNote.filename;
    renderedContent.innerHTML = marked.parse(body);
    exitEdit();
  }

  function showDetail() {
    noteDetail.classList.remove("hidden");
    noteDetail.classList.add("detail-visible");
    noteList.classList.add("list-hidden");
  }

  function hideDetail() {
    noteDetail.classList.add("hidden");
    noteDetail.classList.remove("detail-visible");
    noteList.classList.remove("list-hidden");
    currentNote = null;
    currentRaw = "";
    renderList();
  }

  btnBack.addEventListener("click", hideDetail);

  // --- Edit mode ---
  btnEdit.addEventListener("click", () => {
    if (editing) return;
    editing = true;
    const { body } = splitFrontmatter(currentRaw);
    editTextarea.value = body;
    detailBody.classList.add("hidden");
    editArea.classList.remove("hidden");
    editTextarea.focus();
    btnEdit.style.display = "none";
  });

  btnCancel.addEventListener("click", exitEdit);

  function exitEdit() {
    editing = false;
    detailBody.classList.remove("hidden");
    editArea.classList.add("hidden");
    btnEdit.style.display = "";
  }

  btnSave.addEventListener("click", async () => {
    if (!currentNote) return;
    const project = projectSelector.value;
    const { frontmatter } = splitFrontmatter(currentRaw);
    const newBody = editTextarea.value;
    const content = reconstructContent(frontmatter, newBody);

    btnSave.disabled = true;
    btnSave.textContent = "Saving…";
    try {
      await putJSON(
        `${API}/${encodeURIComponent(project)}/${encodeURIComponent(currentNote.id)}`,
        { content }
      );
      currentRaw = content;
      renderNote();
      toast("Saved", "success");
    } catch (e) {
      toast("Save failed: " + e.message, "error");
    } finally {
      btnSave.disabled = false;
      btnSave.textContent = "Save";
    }
  });

  // --- Sync ---
  btnSync.addEventListener("click", async () => {
    const project = projectSelector.value;
    if (!project) return;
    btnSync.disabled = true;
    btnSync.textContent = "Syncing…";
    try {
      const result = await postJSON(`${API}/${encodeURIComponent(project)}/sync`);
      toast(`Synced: ${result.vault_to_map.updated} from vault, ${result.map_to_vault.written} to vault`, "success");
      await loadNotes();
      if (currentNote) {
        const stillExists = notes.find(n => n.id === currentNote.id);
        if (stillExists) await openNote(stillExists);
        else hideDetail();
      }
    } catch (e) {
      toast("Sync failed: " + e.message, "error");
    } finally {
      btnSync.disabled = false;
      btnSync.textContent = "Sync";
    }
  });

  // --- Helpers ---
  function esc(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  function formatDate(iso) {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
        " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    } catch { return iso; }
  }

  // --- Init ---
  loadProjects();
})();
