// Inbox tab (revision 5): write a word, pick its category, save. The waiting list has its own screen.

import { addInbox, blockedIn } from "../app/service";
import { db } from "../store/db";
import { loadSettings } from "../store/settings";
import type { Screen } from "./app";
import { add, button, field, group, h, largeHeader, row, toast } from "./dom";

export function categorySelect(categories: readonly string[], value: string, label = "Category"): HTMLSelectElement {
  const sel = h("select", { attrs: { "aria-label": label } });
  add(sel, ...categories.map((c) => h("option", { text: c, attrs: { value: c } })));
  sel.value = categories.includes(value) ? value : categories[0] ?? "";
  return sel;
}

export const inboxScreen: Screen = async (root, go) => {
  const s = await loadSettings();
  const waiting = (await (await db()).getAll("inbox")).filter((e) => e.status === "waiting");

  const word = h("input", { attrs: { type: "text", placeholder: "Word or phrase", autocapitalize: "none", enterkeyhint: "done", "aria-label": "Word or phrase" } });
  const seen = h("input", { attrs: { type: "text", placeholder: "Where you saw it (optional sentence)", "aria-label": "Seen in" } });
  const cat = categorySelect(s["categories"], s["categories.default"]);
  const save = async () => {
    const blocked = blockedIn(`${word.value} ${seen.value}`, s);
    if (blocked.length && !confirm(`Contains a blocked word (${blocked.join(", ")}). Save anyway?`)) return;
    const r = await addInbox(word.value, seen.value, cat.value);
    if (!r.ok) { toast(r.message); return; }
    toast(`Added to the waiting list · ${cat.value}`);
    word.value = ""; seen.value = "";
    go("inbox");
  };
  word.addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Enter") void save(); });

  add(root,
    largeHeader("Inbox", "New words"),
    h("section", { class: "glass" }, word, field("Category", cat), seen, button("Add to waiting list", () => void save(), "btn primary big")),
    group(
      row({ icon: "inbox", color: "orange", title: "Waiting list", subtitle: waiting.length ? "Make cards with Gemini or another AI" : "Empty", value: String(waiting.length), href: "#/waiting" }),
      row({ icon: "import", color: "blue", title: "Import cards made elsewhere", subtitle: "From Qwen or any chat: paste or a .txt file", href: "#/waiting?import=1" }),
    ),
  );
  word.focus();
};
