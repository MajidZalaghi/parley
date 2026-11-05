// BIM import: Files picker and paste, with report and rename suggestions (US-01 to US-04).

import { addAlias, importBim, type ImportInput } from "../app/service";
import type { ImportResult } from "../bim/importDiff";
import type { Screen } from "./app";
import { add, set, button, field, h, toast } from "./dom";

export const importScreen: Screen = (root) => {
  const out = h("div", { class: "report" });

  const fileInput = h("input", { attrs: { type: "file", multiple: "", accept: ".md,text/markdown,text/plain" } });
  fileInput.addEventListener("change", async () => {
    const files = Array.from(fileInput.files ?? []);
    if (!files.length) return;
    const inputs: ImportInput[] = await Promise.all(files.map(async (f) => ({ source: f.name.replace(/\.md$/i, ""), text: await f.text() })));
    showResult(out, await importBim(inputs, "file"));
    fileInput.value = "";
  });

  const source = h("input", { attrs: { type: "text", placeholder: "Note name, e.g. Industry Foundation Classes (IFC)" } });
  const paste = h("textarea", { attrs: { rows: "8", placeholder: "Paste the English in Action section here" } });
  const pasteBtn = button("Import pasted text", async () => {
    if (!source.value.trim() || !paste.value.trim()) { toast("Add the note name and the pasted text."); return; }
    showResult(out, await importBim([{ source: source.value.trim(), text: paste.value }], "paste"));
    paste.value = "";
  }, "btn primary");

  add(root, 
    h("h1", { text: "Import BIM notes" }),
    h("section", { class: "panel" },
      h("h2", { text: "From Files" }),
      h("p", { class: "muted", text: "Pick one or more .md notes. Only the English in Action section is read." }),
      fileInput,
    ),
    h("section", { class: "panel" },
      h("h2", { text: "Paste" }),
      field("Note name", source),
      field("Section text", paste),
      pasteBtn,
    ),
    out,
  );
};

function showResult(out: HTMLElement, r: ImportResult) {
  const line = (label: string, ids: string[]) => (ids.length ? h("p", { text: `${label}: ${ids.length}` }) : null);
  const errors = r.issues.filter((i) => i.severity === "error");
  const warnings = r.issues.filter((i) => i.severity === "warning");
  const renameBox = h("div");
  for (const s of r.renames) {
    const row = h("div", { class: "rename" },
      h("span", { text: `Was "${s.fromId}" renamed to "${s.toId}"?` }),
      button("Yes, keep history", async () => {
        const err = await addAlias(s.fromId, s.toId);
        toast(err ?? "History linked.");
        row.remove();
      }, "btn small primary"),
      button("No", () => row.remove(), "btn small ghost"),
    );
    add(renameBox, row);
  }
  set(out, 
    h("h2", { text: "Import report" }),
    line("Added", r.added), line("Changed", r.changed), line("Unchanged", r.unchanged),
    line("Archived", r.archived), line("Restored", r.restored),
    renameBox,
    errors.length ? h("h3", { text: `Errors (${errors.length}) — lines skipped` }) : null,
    ...errors.map((i) => h("p", { class: "issue error", text: `${i.source ?? ""}${i.line ? ` line ${i.line}` : ""} · ${i.code}: ${i.message}`, dir: "auto" })),
    warnings.length ? h("h3", { text: `Warnings (${warnings.length})` }) : null,
    ...warnings.map((i) => h("p", { class: "issue warn", text: `${i.source ?? ""}${i.line ? ` line ${i.line}` : ""} · ${i.code}: ${i.message}`, dir: "auto" })),
  );
}
