// Inbox tab: capture General English words (one by one or as a list), draft cards with Gemini
// or by copy-paste, preview and accept (requirements §7).

import { runAi } from "../ai/client";
import { DRAFT_INSTRUCTIONS } from "../ai/features";
import { acceptGeneral, addInbox, blockedIn } from "../app/service";
import { importWordList } from "../app/wordlist";
import { buildPrompt, MAX_BATCH, previewReply } from "../general/prompt";
import type { InboxEntry } from "../model/types";
import type { ParsedTerm } from "../parser/types";
import { copyText } from "../platform/platform";
import { db } from "../store/db";
import { loadSettings } from "../store/settings";
import { aiButton, aiError } from "./ai";
import type { Go, Screen } from "./app";
import { add, button, field, group, h, icon, largeHeader, row, sectionLabel, set, spinnerLine, toast } from "./dom";

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

  // ---------- word list import ----------
  const listReport = h("div", { attrs: { style: "display:flex;flex-direction:column;gap:10px" } });
  const runListImport = async (text: string) => {
    if (!text.trim()) { toast("The list is empty."); return; }
    const r = await importWordList(text);
    if (!r.skipped.length) { toast(`Added ${r.added} word${r.added === 1 ? "" : "s"} to the Inbox.`); go("inbox"); return; }
    set(listReport,
      h("h3", { class: "section-label", text: `Added ${r.added} · skipped ${r.skipped.length}` }),
      ...r.skipped.slice(0, 30).map((x) => h("p", { class: "issue", dir: "auto", text: `Line ${x.line}: “${x.text}” — ${x.reason}` })),
      button("Show Inbox", () => go("inbox"), "btn primary"));
  };
  const fileInput = h("input", { attrs: { type: "file", accept: ".txt,.md,.csv,text/plain,text/csv", hidden: "" } });
  fileInput.addEventListener("change", async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    await runListImport(await f.text());
    fileInput.value = "";
  });
  const listText = h("textarea", { attrs: { rows: "6", placeholder: "One word or phrase per line", "aria-label": "Word list" } });

  // ---------- drafting ----------
  const preview = h("div", { attrs: { style: "display:flex;flex-direction:column;gap:12px" } });
  const showPreview = (reply: string) => {
    renderPreview(preview, reply, all, s["privacy.blockedWords"], go);
    preview.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const promptArea = h("textarea", { attrs: { rows: "6", readonly: "", hidden: "", "aria-label": "Prompt text" } });
  promptArea.value = prompt;
  const reply = h("textarea", { attrs: { rows: "5", placeholder: "Paste the AI reply here", "aria-label": "AI reply" } });

  add(root,
    largeHeader("Inbox", "General English"),
    h("section", { class: "glass" }, word, seen, button("Save word", () => void save(), "btn primary big")),
    sectionLabel(`Waiting · ${waiting.length}`),
    all.length ? group(...all.map((e) => inboxRow(e, () => go("inbox")))) : h("p", { class: "muted", text: "No words yet. Add one above, or import a list below." }),
    batch.length
      ? h("div", { class: "row-btns" },
          aiButton(`Draft ${batch.length} with Gemini`, "draft", async () => {
            const blocked = blockedIn(prompt, s);
            if (blocked.length) { toast(`Not sent: blocked word (${blocked.join(", ")}).`); return; }
            set(preview, spinnerLine("Asking Gemini…"));
            preview.scrollIntoView({ behavior: "smooth", block: "start" });
            const r = await runAi({ feature: "draft", instructions: DRAFT_INSTRUCTIONS, input: prompt, maxOutputTokens: s["ai.maxOutputTokens.draft"] });
            if (!r.ok) { set(preview, aiError(r)); return; }
            showPreview(r.value);
          }, "btn ai"),
          button("Copy prompt", async () => {
            const blocked = blockedIn(prompt, s);
            if (blocked.length && !confirm(`The prompt contains a blocked word (${blocked.join(", ")}). Copy anyway?`)) return;
            if (await copyText(prompt)) toast("Prompt copied. Paste it into Gemini or Claude.");
            else { promptArea.hidden = false; promptArea.select(); toast("Copy failed; select the text below."); }
          }, "btn"))
      : null,
    batch.length && waiting.length > MAX_BATCH ? h("p", { class: "muted small", text: `Drafts are made ${MAX_BATCH} words at a time. Accept or reject these, then draft the rest.` }) : null,
    preview,
    promptArea,
    sectionLabel("Add many words"),
    group(row({ icon: "note", color: "blue", title: "Import a word list", subtitle: "A .txt, .md or .csv file, one word per line", onClick: () => fileInput.click() })),
    fileInput,
    h("details", { class: "group row" },
      h("summary", {}, icon("pen", 18), h("b", { text: "Paste a list of words" })),
      listText,
      h("p", { class: "muted small", text: "Tip: copy a column from Word or Excel and paste it here. Add “ | a sentence” after a word to keep where you saw it." }),
      button("Add to Inbox", () => void runListImport(listText.value), "btn primary")),
    listReport,
    waiting.length
      ? h("details", { class: "group row" },
          h("summary", {}, icon("practice", 18), h("b", { text: "Paste a reply from a chat app" })),
          reply, button("Read reply", () => showPreview(reply.value), "btn"))
      : null,
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

interface DraftEditor {
  el: HTMLElement;
  /** Accepts the card unless it was already accepted or rejected; returns true when a card was created. */
  accept: () => Promise<boolean>;
}

function renderPreview(box: HTMLElement, text: string, entries: InboxEntry[], blocked: string[], go: Go) {
  const p = previewReply(text, entries.filter((e) => e.status === "waiting"), blocked);
  const editor = (t: ParsedTerm, entry?: InboxEntry): DraftEditor => {
    const term = h("input", { attrs: { type: "text", "aria-label": "Term" } }); term.value = t.term;
    const meaning = h("input", { attrs: { type: "text", dir: "rtl", lang: "fa", "aria-label": "Meaning" } }); meaning.value = t.meaning;
    const usage = h("textarea", { attrs: { rows: "2", "aria-label": "Usage" } }); usage.value = t.usage;
    const card = h("section", { class: "glass" });
    let finished = false;
    const edited = () => term.value !== t.term || meaning.value !== t.meaning || usage.value !== t.usage;
    const accept = async () => {
      if (finished || !term.value.trim() || !meaning.value.trim() || !usage.value.trim()) return false;
      finished = true;
      await acceptGeneral({ term: term.value.trim(), meaning: meaning.value.trim(), usage: usage.value.trim() }, edited() ? "user" : "ai-draft", entry?.inboxId);
      set(card, h("p", { class: "ok", text: `Added: ${term.value}` }));
      return true;
    };
    add(card,
      field("Term", term), field("Meaning", meaning), field("Usage", usage),
      t.clozeOk ? null : h("p", { class: "issue", text: "The term is not in its sentence; cloze will be off." }),
      h("div", { class: "row-btns" },
        button("Accept", () => void accept(), "btn primary small"),
        button("Reject", async () => {
          if (finished) return;
          finished = true;
          if (entry) await (await db()).put("inbox", { ...entry, status: "rejected" });
          set(card, h("p", { class: "muted", text: `Rejected: ${t.term}` }));
        }, "btn small")));
    return { el: card, accept };
  };

  const matched = p.matched.map((m) => editor(m.term, m.entry));
  const extra = p.notRequested.map((t) => editor(t));
  const found = matched.length + extra.length;
  set(box,
    h("h2", { class: "title", text: found ? `Preview · ${found} card${found === 1 ? "" : "s"}` : "Preview" }),
    matched.length > 1
      ? button(`Accept all ${matched.length}`, async () => {
          let n = 0;
          for (const m of matched) if (await m.accept()) n++;
          toast(`Added ${n} card${n === 1 ? "" : "s"}. They are marked “AI draft” until you confirm them in Cards.`);
        }, "btn primary big")
      : null,
    ...matched.map((m) => m.el),
    extra.length ? h("h3", { class: "section-label", text: "Not requested" }) : null,
    ...extra.map((m) => m.el),
    p.missing.length ? h("p", { class: "issue", text: `No card returned for: ${p.missing.map((e) => e.word).join(", ")}` }) : null,
    ...p.issues.filter((i) => i.severity === "error").map((i) => h("p", { class: "issue error", text: `Line ${i.line} · ${i.code}: ${i.message}` })),
    found === 0 ? h("p", { class: "error", text: text.trim() ? "No card lines found in the reply." : "The reply was empty." }) : null,
    found < entries.filter((e) => e.status === "waiting").length || found === 0
      ? h("details", { class: "group row" },
          h("summary", {}, h("b", { text: "Show what came back" })),
          h("p", { class: "small", dir: "auto", text: text.trim().slice(0, 1500) || "(empty reply)" }))
      : null,
    button("Done", () => go("inbox"), "btn big"));
}
