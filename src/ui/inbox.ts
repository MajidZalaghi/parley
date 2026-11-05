// General English Inbox: capture, draft with Gemini or copy prompt, paste reply, preview (§7).

import { runAi } from "../ai/client";
import { DRAFT_INSTRUCTIONS } from "../ai/features";
import { errorMessage } from "../ai/provider";
import { acceptGeneral, addInbox, blockedIn } from "../app/service";
import { buildPrompt, MAX_BATCH, previewReply } from "../general/prompt";
import type { InboxEntry } from "../model/types";
import type { ParsedTerm } from "../parser/types";
import { copyText } from "../platform/platform";
import { db, getApiKey } from "../store/db";
import { loadSettings } from "../store/settings";
import type { Screen } from "./app";
import { add, set, auto, button, field, h, toast } from "./dom";

export const inboxScreen: Screen = async (root, go) => {
  const s = await loadSettings();
  const d = await db();
  const waiting = (await d.getAll("inbox")).sort((a, b) => a.addedAt.localeCompare(b.addedAt));
  const aiReady = !!(await getApiKey()) && s["ai.paidTierConfirmed"] && s["ai.features"].includes("draft");

  const word = h("input", { attrs: { type: "text", placeholder: "New word or phrase", autocapitalize: "none", enterkeyhint: "done" } });
  const seen = h("input", { attrs: { type: "text", placeholder: "Seen in (optional sentence)" } });
  const save = async () => {
    const blocked = blockedIn(`${word.value} ${seen.value}`, s);
    if (blocked.length && !confirm(`Contains a blocked word (${blocked.join(", ")}). Save anyway?`)) return;
    const r = await addInbox(word.value, seen.value);
    if (!r.ok) { toast(r.message); return; }
    toast("Saved to Inbox.");
    go("inbox");
  };
  word.addEventListener("keydown", (e) => { if (e.key === "Enter") void save(); });

  const preview = h("div", { class: "preview" });
  const batch = waiting.filter((e) => e.status === "waiting").slice(0, MAX_BATCH);
  const prompt = buildPrompt(s["general.promptTemplate"], batch);

  const draftBtn = aiReady && batch.length
    ? button(`Draft ${batch.length} with Gemini`, async () => {
        const blocked = blockedIn(prompt, s);
        if (blocked.length) { toast(`Not sent: blocked word (${blocked.join(", ")}).`); return; }
        set(preview, h("p", { class: "muted", text: "Asking Gemini…" }));
        const r = await runAi({ feature: "draft", instructions: DRAFT_INSTRUCTIONS, input: prompt, maxOutputTokens: s["ai.maxOutputTokens.draft"] });
        if (!r.ok) { set(preview, h("p", { class: "error", text: errorMessage(r.error, r.detail) })); return; }
        renderPreview(preview, r.value, waiting, s["privacy.blockedWords"], go);
      }, "btn primary")
    : null;

  const copyBtn = batch.length
    ? button("Copy AI prompt", async () => {
        const blocked = blockedIn(prompt, s);
        if (blocked.length && !confirm(`The prompt contains a blocked word (${blocked.join(", ")}). Copy anyway?`)) return;
        if (await copyText(prompt)) toast("Prompt copied. Paste it into Gemini or Claude.");
        else { promptArea.hidden = false; promptArea.select(); toast("Copy failed; select the text below and copy it."); }
      }, "btn")
    : null;
  const promptArea = h("textarea", { attrs: { rows: "6", readonly: "", hidden: "" } });
  promptArea.value = prompt;

  const reply = h("textarea", { attrs: { rows: "6", placeholder: "Paste the AI reply here" } });
  const pasteBtn = button("Read pasted reply", () => renderPreview(preview, reply.value, waiting, s["privacy.blockedWords"], go), "btn");

  add(root, 
    h("h1", { text: "General English" }),
    h("section", { class: "panel" }, field("Word", word), field("Seen in", seen), button("Save", () => void save(), "btn primary")),
    h("section", { class: "panel" },
      h("h2", { text: `Waiting (${waiting.filter((e) => e.status === "waiting").length})` }),
      ...waiting.map((e) => inboxRow(e, () => go("inbox"))),
      waiting.length ? h("div", { class: "row" }, draftBtn, copyBtn) : h("p", { class: "muted", text: "No words waiting." }),
      promptArea,
      !aiReady && batch.length ? h("p", { class: "muted small", text: "Direct drafting needs a Gemini key and the paid-tier confirmation in Settings." }) : null,
    ),
    waiting.length ? h("section", { class: "panel" }, h("h2", { text: "Paste AI reply" }), reply, pasteBtn) : null,
    preview,
  );
  word.focus();
};

function inboxRow(e: InboxEntry, refresh: () => void): HTMLElement {
  return h("div", { class: `inbox-row ${e.status}` },
    h("span", { text: e.word }),
    e.seenIn ? h("small", { class: "muted", text: e.seenIn }) : null,
    e.status === "rejected" ? h("small", { class: "badge", text: "rejected" }) : null,
    button("Delete", async () => { await (await db()).delete("inbox", e.inboxId); refresh(); }, "btn small ghost"),
  );
}

function renderPreview(box: HTMLElement, text: string, waiting: InboxEntry[], blocked: string[], go: (s: "inbox") => void) {
  const p = previewReply(text, waiting.filter((e) => e.status === "waiting"), blocked);
  const cardEditor = (t: ParsedTerm, entry?: InboxEntry) => {
    const term = h("input", { attrs: { type: "text" } });
    term.value = t.term;
    const meaning = h("input", { attrs: { type: "text", dir: "auto" } });
    meaning.value = t.meaning;
    const usage = h("textarea", { attrs: { rows: "2" } });
    usage.value = t.usage;
    const wrap = h("div", { class: "draft" });
    const edited = () => term.value !== t.term || meaning.value !== t.meaning || usage.value !== t.usage;
    add(wrap, 
      field("Term", term), field("Meaning", meaning), field("Usage", usage),
      t.clozeOk ? null : auto("The term is not in its sentence; cloze will be off.", "issue warn"),
      h("div", { class: "row" },
        button("Accept", async () => {
          await acceptGeneral({ term: term.value.trim(), meaning: meaning.value.trim(), usage: usage.value.trim() }, edited() ? "user" : "ai-draft", entry?.inboxId);
          set(wrap, h("p", { class: "ok", text: `Added: ${term.value}` }));
        }, "btn primary small"),
        button("Reject", async () => {
          if (entry) await (await db()).put("inbox", { ...entry, status: "rejected" });
          set(wrap, h("p", { class: "muted", text: `Rejected: ${t.term}` }));
        }, "btn small ghost"),
      ),
    );
    return wrap;
  };
  set(box, 
    h("h2", { text: "Preview" }),
    ...p.matched.map((m) => cardEditor(m.term, m.entry)),
    p.notRequested.length ? h("h3", { text: "Not requested" }) : null,
    ...p.notRequested.map((t) => cardEditor(t)),
    p.missing.length ? h("p", { class: "issue warn", text: `No card returned for: ${p.missing.map((e) => e.word).join(", ")}` }) : null,
    ...p.issues.filter((i) => i.severity === "error").map((i) => h("p", { class: "issue error", text: `line ${i.line} · ${i.code}: ${i.message}` })),
    p.matched.length + p.notRequested.length === 0 ? h("p", { class: "error", text: "No card lines found in the reply." }) : null,
    button("Done", () => go("inbox"), "btn"),
  );
}
