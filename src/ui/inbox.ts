// Inbox tab: capture General English words, draft cards with Gemini or by copy-paste, preview (§7).

import { runAi } from "../ai/client";
import { DRAFT_INSTRUCTIONS } from "../ai/features";
import { acceptGeneral, addInbox, blockedIn } from "../app/service";
import { buildPrompt, MAX_BATCH, previewReply } from "../general/prompt";
import type { InboxEntry } from "../model/types";
import type { ParsedTerm } from "../parser/types";
import { copyText } from "../platform/platform";
import { db } from "../store/db";
import { loadSettings } from "../store/settings";
import { aiButton, aiError } from "./ai";
import type { Go, Screen } from "./app";
import { add, button, field, group, h, icon, largeHeader, sectionLabel, set, spinnerLine, toast } from "./dom";

export const inboxScreen: Screen = async (root, go) => {
  const s = await loadSettings();
  const d = await db();
  const all = (await d.getAll("inbox")).sort((a, b) => a.addedAt.localeCompare(b.addedAt));
  const waiting = all.filter((e) => e.status === "waiting");
  const batch = waiting.slice(0, MAX_BATCH);
  const prompt = buildPrompt(s["general.promptTemplate"], batch);

  const word = h("input", { attrs: { type: "text", placeholder: "New word or phrase", autocapitalize: "none", enterkeyhint: "done", "aria-label": "New word or phrase" } });
  const seen = h("input", { attrs: { type: "text", placeholder: "Seen in (optional sentence)", "aria-label": "Seen in" } });
  const save = async () => {
    const blocked = blockedIn(`${word.value} ${seen.value}`, s);
    if (blocked.length && !confirm(`Contains a blocked word (${blocked.join(", ")}). Save anyway?`)) return;
    const r = await addInbox(word.value, seen.value);
    if (!r.ok) { toast(r.message); return; }
    toast("Saved to Inbox.");
    go("inbox");
  };
  word.addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Enter") void save(); });

  const preview = h("div", { attrs: { style: "display:flex;flex-direction:column;gap:12px" } });
  const promptArea = h("textarea", { attrs: { rows: "6", readonly: "", hidden: "", "aria-label": "Prompt text" } });
  promptArea.value = prompt;
  const reply = h("textarea", { attrs: { rows: "5", placeholder: "Paste the AI reply here", "aria-label": "AI reply" } });

  add(root,
    largeHeader("Inbox", "General English"),
    h("section", { class: "glass" }, word, seen, button("Save word", () => void save(), "btn primary big")),
    sectionLabel(`Waiting · ${waiting.length}`),
    all.length ? group(...all.map((e) => inboxRow(e, () => go("inbox")))) : h("p", { class: "muted", text: "No words yet. Add one above when you meet it." }),
    batch.length
      ? h("div", { class: "row-btns" },
          aiButton(`Draft ${batch.length} with Gemini`, "draft", async () => {
            const blocked = blockedIn(prompt, s);
            if (blocked.length) { toast(`Not sent: blocked word (${blocked.join(", ")}).`); return; }
            set(preview, spinnerLine("Asking Gemini…"));
            const r = await runAi({ feature: "draft", instructions: DRAFT_INSTRUCTIONS, input: prompt, maxOutputTokens: s["ai.maxOutputTokens.draft"] });
            if (!r.ok) { set(preview, aiError(r)); return; }
            renderPreview(preview, r.value, all, s["privacy.blockedWords"], go);
          }, "btn ai"),
          button("Copy prompt", async () => {
            const blocked = blockedIn(prompt, s);
            if (blocked.length && !confirm(`The prompt contains a blocked word (${blocked.join(", ")}). Copy anyway?`)) return;
            if (await copyText(prompt)) toast("Prompt copied. Paste it into Gemini or Claude.");
            else { promptArea.hidden = false; promptArea.select(); toast("Copy failed; select the text below."); }
          }, "btn"))
      : null,
    promptArea,
    waiting.length
      ? h("details", { class: "group row" },
          h("summary", {}, icon("practice", 18), h("b", { text: "Paste a reply from a chat app" })),
          reply, button("Read reply", () => renderPreview(preview, reply.value, all, s["privacy.blockedWords"], go), "btn"))
      : null,
    preview,
  );
  word.focus();
};

function inboxRow(e: InboxEntry, refresh: () => void): HTMLElement {
  return h("div", { class: "row static" },
    h("span", { class: "label" },
      h("b", { text: e.word, attrs: e.status === "rejected" ? { style: "text-decoration:line-through;opacity:.6" } : {} }),
      e.seenIn ? h("small", { text: e.seenIn, dir: "auto" }) : null),
    e.status === "rejected" ? h("span", { class: "badge bad", text: "Rejected" }) : null,
    h("button", { class: "btn small ghost", text: "Delete", attrs: { type: "button", "aria-label": `Delete ${e.word}` }, on: { click: async () => { await (await db()).delete("inbox", e.inboxId); refresh(); } } }));
}

function renderPreview(box: HTMLElement, text: string, entries: InboxEntry[], blocked: string[], go: Go) {
  const p = previewReply(text, entries.filter((e) => e.status === "waiting"), blocked);
  const editor = (t: ParsedTerm, entry?: InboxEntry) => {
    const term = h("input", { attrs: { type: "text", "aria-label": "Term" } }); term.value = t.term;
    const meaning = h("input", { attrs: { type: "text", dir: "rtl", lang: "fa", "aria-label": "Meaning" } }); meaning.value = t.meaning;
    const usage = h("textarea", { attrs: { rows: "2", "aria-label": "Usage" } }); usage.value = t.usage;
    const card = h("section", { class: "glass" });
    const edited = () => term.value !== t.term || meaning.value !== t.meaning || usage.value !== t.usage;
    add(card,
      field("Term", term), field("Meaning", meaning), field("Usage", usage),
      t.clozeOk ? null : h("p", { class: "issue", text: "The term is not in its sentence; cloze will be off." }),
      h("div", { class: "row-btns" },
        button("Accept", async () => {
          await acceptGeneral({ term: term.value.trim(), meaning: meaning.value.trim(), usage: usage.value.trim() }, edited() ? "user" : "ai-draft", entry?.inboxId);
          set(card, h("p", { class: "ok", text: `Added: ${term.value}` }));
        }, "btn primary small"),
        button("Reject", async () => {
          if (entry) await (await db()).put("inbox", { ...entry, status: "rejected" });
          set(card, h("p", { class: "muted", text: `Rejected: ${t.term}` }));
        }, "btn small")));
    return card;
  };
  set(box,
    h("h2", { class: "title", text: "Preview" }),
    ...p.matched.map((m) => editor(m.term, m.entry)),
    p.notRequested.length ? h("h3", { class: "section-label", text: "Not requested" }) : null,
    ...p.notRequested.map((t) => editor(t)),
    p.missing.length ? h("p", { class: "issue", text: `No card returned for: ${p.missing.map((e) => e.word).join(", ")}` }) : null,
    ...p.issues.filter((i) => i.severity === "error").map((i) => h("p", { class: "issue error", text: `Line ${i.line} · ${i.code}: ${i.message}` })),
    p.matched.length + p.notRequested.length === 0 ? h("p", { class: "error", text: "No card lines found in the reply." }) : null,
    button("Done", () => go("inbox"), "btn big"));
}
