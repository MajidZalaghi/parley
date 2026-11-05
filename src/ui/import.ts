// BIM import (More → Import): Files picker and paste, report and rename suggestions (US-01 to US-04).

import { addAlias, importBim, type ImportInput } from "../app/service";
import type { ImportResult } from "../bim/importDiff";
import { splitNotes } from "../bim/split";
import type { Screen } from "./app";
import { add, button, field, group, h, navBar, row, sectionLabel, set, toast } from "./dom";

export const importScreen: Screen = (root) => {
  const out = h("div", { attrs: { style: "display:flex;flex-direction:column;gap:12px" } });

  const fileInput = h("input", { attrs: { type: "file", multiple: "", accept: ".md,text/markdown,text/plain", hidden: "" } });
  fileInput.addEventListener("change", async () => {
    const files = Array.from(fileInput.files ?? []);
    if (!files.length) return;
    // One file may hold several notes ("# Name" headings); see src/bim/split.ts.
    const inputs: ImportInput[] = (await Promise.all(files.map(async (f) => splitNotes(await f.text(), f.name.replace(/\.md$/i, ""))))).flat();
    showResult(out, await importBim(inputs, "file"));
    fileInput.value = "";
  });

  const source = h("input", { attrs: { type: "text", placeholder: "e.g. Industry Foundation Classes (IFC)" } });
  const paste = h("textarea", { attrs: { rows: "7", placeholder: "Paste the English in Action section here" } });

  add(root,
    navBar("More", "#/more", "Import"),
    h("h1", { class: "large-title", text: "Import BIM notes" }),
    group(row({ icon: "note", color: "blue", title: "Choose notes from Files", subtitle: "Only the English in Action section is read", onClick: () => fileInput.click() })),
    fileInput,
    sectionLabel("Or paste text"),
    h("section", { class: "glass" },
      field("Note name", source, "Not needed when you paste a pack whose notes start with “# Name”."),
      field("Section text", paste),
      button("Import pasted text", async () => {
        if (!paste.value.trim()) { toast("Paste the text first."); return; }
        const parts = splitNotes(paste.value, source.value.trim());
        if (parts.length === 1 && !source.value.trim()) { toast("Add the note name, or paste a pack whose notes start with “# Name”."); return; }
        showResult(out, await importBim(parts, "paste"));
        paste.value = "";
      }, "btn primary big")),
    out,
  );
};

function showResult(out: HTMLElement, r: ImportResult) {
  const errors = r.issues.filter((i) => i.severity === "error");
  const warnings = r.issues.filter((i) => i.severity === "warning");
  const n = (label: string, ids: string[]) => row({ title: label, value: String(ids.length) });
  const renames = r.renames.map((s) => {
    const box = h("section", { class: "glass" });
    add(box,
      h("p", { text: `Was “${s.fromId}” renamed to “${s.toId}”?` }),
      h("div", { class: "row-btns" },
        button("Yes, keep history", async () => { const err = await addAlias(s.fromId, s.toId); toast(err ?? "History linked."); box.remove(); }, "btn primary small"),
        button("No", () => box.remove(), "btn small")));
    return box;
  });
  const line = (i: (typeof r.issues)[number]) => h("p", { class: `issue${i.severity === "error" ? " error" : ""}`, dir: "auto", text: `${i.source ?? ""}${i.line ? ` · line ${i.line}` : ""} · ${i.code}: ${i.message}` });
  set(out,
    sectionLabel("Import report"),
    group(n("Added", r.added), n("Changed", r.changed), n("Unchanged", r.unchanged), n("Archived", r.archived), n("Restored", r.restored)),
    ...renames,
    errors.length ? sectionLabel(`Errors · ${errors.length} lines skipped`) : null,
    ...errors.map(line),
    warnings.length ? sectionLabel(`Warnings · ${warnings.length}`) : null,
    ...warnings.map(line));
}
