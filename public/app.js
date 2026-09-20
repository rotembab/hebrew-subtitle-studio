import {
  parseSubtitles,
  serializeSubtitles,
  qualityWarnings,
} from "/subtitles.mjs";
const $ = (id) => document.getElementById(id);
let source = "",
  filename = "",
  documentData = null,
  translations = new Map(),
  running = false,
  controller = null,
  onlyReview = false,
  page = 0,
  dirty = false,
  modelReady = false;
const PAGE_SIZE = 40;
function message(text) {
  $("status").textContent = text;
}
function error(text = "") {
  $("error").textContent = text;
  $("error").hidden = !text;
}
function rows() {
  return [...translations.values()].sort((a, b) => a.id - b.id);
}
function updateControls() {
  const total = documentData?.cues.length || 0,
    completed = [...translations.values()].filter((r) => r.text.trim()).length;
  $("translate").disabled =
    running || !total || !modelReady || completed === total;
  $("translate").textContent =
    completed && completed < total
      ? "Continue translation"
      : completed === total && total
        ? "Translation complete"
        : "Translate to Hebrew";
  $("stop").hidden = !running;
  $("download").disabled = running || !total || completed !== total;
  $("save").disabled = !total;
  for (const id of [
    "file",
    "sample",
    "restore",
    "model",
    "context",
    "review",
    "refresh",
  ])
    $(id).disabled = running;
  $("total-count").textContent = total;
  $("review-count").textContent = rows().filter((r) => r.needsReview).length;
  $("progress-count").textContent = total
    ? `${completed} / ${total} translated`
    : "";
  $("progress").value = total ? (completed / total) * 100 : 0;
}
async function refreshModels() {
  try {
    const result = await fetch("/api/status").then((r) => r.json());
    const previous = $("model").value;
    $("model").replaceChildren();
    for (const model of result.models) {
      const option = new Option(model.name, model.name);
      $("model").add(option);
    }
    modelReady = result.connected && result.models.length > 0;
    if (modelReady) {
      const preferred = result.models.some((m) => m.name === previous)
        ? previous
        : result.models.some((m) => m.name === result.defaultModel)
          ? result.defaultModel
          : result.models[0].name;
      $("model").value = preferred;
      $("connection").textContent =
        "Connected to Ollama · Runs on this computer";
    } else {
      $("model").add(new Option("No local model available", ""));
      $("connection").textContent = result.connected
        ? "Ollama is running. Install a model to start."
        : "Open Ollama to connect.";
    }
    $("setup-help").hidden = modelReady;
  } catch {
    modelReady = false;
    $("connection").textContent =
      "Cannot reach the app. Restart it and refresh this page.";
  }
  updateControls();
}
function confirmReplace() {
  return (
    !dirty ||
    window.confirm(
      "Replace this project? Save your project first if you want to keep your translations.",
    )
  );
}
function loadSource(text, name) {
  const parsed = parseSubtitles(text);
  source = text;
  filename = name;
  documentData = parsed;
  translations = new Map();
  onlyReview = false;
  page = 0;
  dirty = false;
  $("search").value = "";
  $("filename").textContent = name;
  $("fileinfo").textContent =
    `${parsed.cues.length} cues · ${parsed.format.toUpperCase()} · English → Hebrew`;
  error();
  message("Ready to translate. Add character details if you know them.");
  render();
}
async function openSubtitle(file) {
  if (!file || running) return;
  try {
    if (!/\.(srt|vtt)$/i.test(file.name))
      throw new Error("Choose an SRT or VTT subtitle file.");
    if (file.size > 3 * 1024 * 1024)
      throw new Error("Choose a subtitle file smaller than 3 MB.");
    const text = await file.text();
    parseSubtitles(text);
    if (confirmReplace()) loadSource(text, file.name);
  } catch (e) {
    error(e.message);
  }
  $("file").value = "";
}
function create(tag, className, content) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content != null) element.textContent = content;
  return element;
}
function render() {
  updateControls();
  $("all").classList.toggle("active", !onlyReview);
  $("all").setAttribute("aria-pressed", String(!onlyReview));
  $("flagged").classList.toggle("active", onlyReview);
  $("flagged").setAttribute("aria-pressed", String(onlyReview));
  $("empty").hidden = !!documentData;
  $("cues").replaceChildren();
  if (!documentData) return;
  const query = $("search").value.toLocaleLowerCase().trim();
  const filtered = documentData.cues.filter((cue) => {
    const row = translations.get(cue.id);
    return (
      (!onlyReview || row?.needsReview) &&
      (!query ||
        `${cue.text} ${row?.text || ""}`.toLocaleLowerCase().includes(query))
    );
  });
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  page = Math.min(page, pages - 1);
  for (const cue of filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)) {
    const row = translations.get(cue.id),
      article = create("article", "cue-row");
    const time = create("div", "cue-time");
    time.append(
      create("b", "", String(cue.id).padStart(3, "0")),
      create("span", "", cue.timing.split(/\s+-->/)[0]),
      create("span", "", `  ${(cue.end - cue.start).toFixed(1)}s`),
    );
    const original = create("p", "cue-source", cue.text);
    original.lang = "en";
    const translated = create("div", "cue-translation");
    const editor = create("textarea");
    editor.value = row?.text || "";
    editor.dir = "rtl";
    editor.lang = "he";
    editor.rows = 2;
    editor.maxLength = 4000;
    editor.disabled = running;
    editor.setAttribute("aria-label", `Hebrew translation for cue ${cue.id}`);
    editor.placeholder = "התרגום יופיע כאן";
    const notes = create("div");
    const showNotes = () => {
      notes.replaceChildren();
      const current = translations.get(cue.id);
      if (current?.note) notes.append(create("p", "cue-note", current.note));
      if (current?.needsReview) {
        const warnings = current.warnings || [];
        notes.append(
          create(
            "p",
            "cue-note cue-warning",
            warnings.length
              ? warnings.join(" ")
              : "Check the translation against the dialogue context.",
          ),
        );
        const reviewed = create(
          "button",
          "text-button review-button",
          "Mark as reviewed",
        );
        reviewed.disabled = running;
        reviewed.addEventListener("click", () => {
          current.needsReview = false;
          dirty = true;
          render();
        });
        notes.append(reviewed);
      }
    };
    editor.addEventListener("input", () => {
      const previous = translations.get(cue.id);
      if (editor.value.trim()) {
        const warnings = qualityWarnings(cue, editor.value);
        translations.set(cue.id, {
          id: cue.id,
          text: editor.value,
          note: previous?.note || "",
          needsReview: warnings.length > 0 || (previous?.needsReview ?? false),
          warnings,
        });
      } else translations.delete(cue.id);
      dirty = true;
      updateControls();
      showNotes();
    });
    translated.append(editor, notes);
    showNotes();
    article.append(time, original, translated);
    $("cues").append(article);
  }
  if (!filtered.length) {
    const none = create(
      "p",
      "empty",
      onlyReview ? "No cues need review." : "No matching subtitles.",
    );
    $("cues").append(none);
  }
  $("pagination").hidden = pages <= 1;
  $("page-info").textContent = `Page ${page + 1} of ${pages}`;
  $("prev").disabled = page === 0;
  $("next").disabled = page === pages - 1;
}
function handleEvent(event) {
  if (event.type === "progress")
    message(
      `${{ translating: "Translating", reviewing: "Reviewing meaning and phrasing for", retrying: "Retrying" }[event.phase]} cues ${event.from}–${event.to}…`,
    );
  if (event.type === "batch") {
    event.rows.forEach((row) => translations.set(row.id, row));
    dirty = true;
    render();
  }
  if (event.type === "error") throw new Error(event.message);
  if (event.type === "done") {
    const count = rows().filter((r) => r.needsReview).length;
    message(
      `Translation complete.${count ? ` ${count} cues need a look before export.` : " You can edit any line before exporting."}`,
    );
  }
}
async function translate() {
  if (!documentData || running) return;
  running = true;
  controller = new AbortController();
  error();
  render();
  message("Loading the local model. The first run can take a little longer…");
  let finished = false;
  try {
    const response = await fetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        source,
        options: {
          model: $("model").value,
          context: $("context").value,
          review: $("review").checked,
          completed: rows(),
        },
      }),
    });
    if (!response.ok)
      throw new Error(
        (await response.json()).error || "Translation could not start.",
      );
    const reader = response.body.getReader(),
      decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line.trim()) {
          const event = JSON.parse(line);
          if (event.type === "done") finished = true;
          handleEvent(event);
        }
      }
      if (done) break;
    }
    if (!finished)
      throw new Error(
        "The connection ended before translation finished. Your completed cues are kept; continue to resume.",
      );
  } catch (e) {
    if (e.name === "AbortError")
      message(
        "Stopped. Completed cues are kept. Continue whenever you are ready.",
      );
    else {
      error(e.message);
      message("Translation paused. Completed cues are kept.");
    }
  } finally {
    running = false;
    controller = null;
    render();
  }
}
function download(content, name, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = create("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$("file").addEventListener("change", (e) => openSubtitle(e.target.files[0]));
$("dropzone").addEventListener("dragover", (e) => {
  e.preventDefault();
  if (!running) $("dropzone").classList.add("dragging");
});
$("dropzone").addEventListener("dragleave", () =>
  $("dropzone").classList.remove("dragging"),
);
$("dropzone").addEventListener("drop", (e) => {
  e.preventDefault();
  $("dropzone").classList.remove("dragging");
  openSubtitle(e.dataTransfer.files[0]);
});
$("sample").addEventListener("click", async () => {
  if (!confirmReplace()) return;
  try {
    loadSource(
      await fetch("/example.srt").then((r) => r.text()),
      "idioms-example.srt",
    );
    $("context").value =
      "Daniel (male) and Maya (female) are talking. Maya has an audition tonight. Daniel encourages her. The tone is casual.";
  } catch (e) {
    error(e.message);
  }
});
$("refresh").addEventListener("click", refreshModels);
$("translate").addEventListener("click", translate);
$("stop").addEventListener("click", () => controller?.abort());
$("all").addEventListener("click", () => {
  onlyReview = false;
  page = 0;
  render();
});
$("flagged").addEventListener("click", () => {
  onlyReview = true;
  page = 0;
  render();
});
$("search").addEventListener("input", () => {
  page = 0;
  render();
});
$("prev").addEventListener("click", () => {
  page--;
  render();
});
$("next").addEventListener("click", () => {
  page++;
  render();
});
$("download").addEventListener("click", () => {
  try {
    download(
      serializeSubtitles(documentData, rows()),
      filename.replace(/\.(srt|vtt)$/i, "") + ".he." + documentData.format,
      "text/plain;charset=utf-8",
    );
    message("Hebrew subtitle file exported.");
  } catch (e) {
    error(e.message);
  }
});
$("save").addEventListener("click", () => {
  download(
    JSON.stringify(
      {
        version: 1,
        filename,
        source,
        translations: rows(),
        context: $("context").value,
        review: $("review").checked,
        model: $("model").value,
      },
      null,
      2,
    ),
    filename.replace(/\.(srt|vtt)$/i, "") + ".hebrew-project.json",
    "application/json",
  );
  dirty = false;
  message("Project saved. Open it later to continue translating or editing.");
});
$("restore").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    if (file.size > 8 * 1024 * 1024) throw new Error("Project is too large.");
    const project = JSON.parse(await file.text());
    if (
      project.version !== 1 ||
      typeof project.filename !== "string" ||
      !Array.isArray(project.translations)
    )
      throw new Error("This is not a supported project file.");
    const parsed = parseSubtitles(project.source),
      ids = new Set(parsed.cues.map((c) => c.id)),
      seen = new Set();
    for (const row of project.translations) {
      if (
        !ids.has(row.id) ||
        seen.has(row.id) ||
        typeof row.text !== "string" ||
        row.text.length > 4000 ||
        typeof row.note !== "string" ||
        typeof row.needsReview !== "boolean" ||
        !Array.isArray(row.warnings) ||
        row.warnings.some((w) => typeof w !== "string")
      )
        throw new Error("The saved project contains invalid translations.");
      seen.add(row.id);
    }
    if (!confirmReplace()) return;
    loadSource(project.source, project.filename);
    translations = new Map(project.translations.map((row) => [row.id, row]));
    $("context").value =
      typeof project.context === "string" ? project.context.slice(0, 5000) : "";
    $("review").checked = project.review !== false;
    if ([...$("model").options].some((o) => o.value === project.model))
      $("model").value = project.model;
    render();
    message("Project restored. Your translations and edits are ready.");
  } catch (e) {
    error(e.message);
  } finally {
    $("restore").value = "";
  }
});
$("context").addEventListener("input", () => {
  if (documentData) dirty = true;
});
window.addEventListener("beforeunload", (event) => {
  if (dirty || running) {
    event.preventDefault();
    event.returnValue = "";
  }
});
refreshModels();
