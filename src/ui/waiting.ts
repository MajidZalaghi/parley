// Waiting list (revision 5): words waiting for cards. Gemini makes cards directly; the same prompt can be
// copied into a local model (for example Qwen) or any chat, and their reply is pasted or imported here.

import { runAi } from "../ai/client";
import { DRAFT_INSTRUCTIONS } from "../ai/features";
import { acceptGeneral, blockedIn } from "../app/service";
import { importWordList } from "../app/wordlist";
import { buildPrompt, MAX_BATCH, previewReply } from "../general/prompt";
import type { InboxEntry } from "../model/types";
import type { ParsedTerm } from "../parser/types";
import { copyText } from "../platform/platform";
import { db } from "../store/db";
import { loadSettings, type Settings } from "../store/settings";
import { aiButton, aiError } from "./ai";
import type { Go, Screen } from "./app";
import { add, button, field, group, h, icon, navBar, row, sectionLabel, set, spinnerLine, toast } from "./dom";
import { categorySelect } from "./inbox";

export const waitingScreen: Screen = async (root, go, query) => {
  const s = await loadSettings();
  const d = await db();
  const all = (await d.getAll("inbox")).sort((a, b) => a.addedAt.localeCompare(b.addedAt));
  const waiting = all.filter((e) => e.status === "waiting");
  const batch = waiting.slice(0, MAX_BATCH);
  const prompt = buildPrompt(s["cards.promptTemplate"], batch, s["categories.default"]);

  const preview = h("div", { attrs: { style: "display:flex;flex-direction:column;gap:12px" } });
  const show = (reply: string) => { renderPreview(preview, reply, all, s, go); preview.scrollIntoView({ behavior: "smooth", block: "start" }); };

  // ---------- external cards (Qwen, any chat) ----------
  const reply = h("textarea", { attrs: { rows: "6", placeholder: "Paste the reply with the card lines", "aria-label": "Card lines" } });
  const cardFile = h("input", { attrs: { type: "file", accept: ".txt,.md,text/plain", hidden: "" } });
  cardFile.addEventListener("change", async () => { const f = cardFile.files?.[0]; if (f) show(await f.text()); cardFile.value = ""; });
  const promptArea = h("textarea", { attrs: { rows: "8", readonly: "", hidden: "", "aria-label": "Prompt" } });
  promptArea.value = prompt;
  const copyPrompt = async () => {
    const blocked = blockedIn(prompt, s);
    if (blocked.length && !confirm(`The prompt contains a blocked word (${blocked.join(", ")}). Copy anyway?`)) return;
    if (await copyText(prompt)) toast("Prompt copied. Paste it into Qwen, Gemini or any chat.");
    else { promptArea.hidden = false; promptArea.select(); toast("Copy failed; select the text below."); }
  };

  // ---------- many words at once ----------
  const listText = h("textarea", { attrs: { rows: "6", placeholder: "One word or phrase per line", "aria-label": "Word list" } });
  const listCat = categorySelect(s["categories"], s["categories.default"], "Category for this list");
  const listReport = h("div", { attrs: { style: "display:flex;flex-direction:column;gap:10px" } });
  const runList = async (text: string) => {
    if (!text.trim()) { toast("The list is empty."); return; }
    const r = await importWordList(text, listCat.value);
    if (!r.skipped.length) { toast(`Added ${r.added} to the waiting list.`); go("waiting"); return; }
    set(listReport,
      h("h3", { class: "section-label", text: `Added ${r.added} · skipped ${r.skipped.length}` }),
      ...r.skipped.slice(0, 30).map((x) => h("p", { class: "issue", dir: "auto", text: `Line ${x.line}: “${x.text}” — ${x.reason}` })),
      button("Show the list", () => go("waiting"), "btn primary"));
  };
  const listFile = h("input", { attrs: { type: "file", accept: ".txt,.md,.csv,text/plain,text/csv", hidden: "" } });
  listFile.addEventListener("change", async () => { const f = listFile.files?.[0]; if (f) await runList(await f.text()); listFile.value = ""; });

  const byCat = new Map<string, InboxEntry[]>();
  for (const e of all) {
    const c = e.category ?? s["categories.default"];
    byCat.set(c, [...(byCat.get(c) ?? []), e]);
  }

  add(root,
    navBar("Inbox", "#/inbox", "Waiting list"),
    waiting.length
      ? h("section", { class: "glass" },
          h("p", { class: "muted", text: `${waiting.length} word${waiting.length === 1 ? "" : "s"} waiting.${waiting.length > MAX_BATCH ? ` Cards are made ${MAX_BATCH} at a time.` : ""}` }),
          aiButton(`Make ${batch.length} card${batch.length === 1 ? "" : "s"} with Gemini`, "draft", async () => {
            const blocked = blockedIn(prompt, s);
            if (blocked.length) { toast(`Not sent: blocked word (${blocked.join(", ")}).`); return; }
            set(preview, spinnerLine("Gemini is making the cards…"));
            preview.scrollIntoView({ behavior: "smooth", block: "start" });
            const r = await runAi({ feature: "draft", instructions: DRAFT_INSTRUCTIONS, input: prompt, maxOutputTokens: s["ai.maxOutputTokens.draft"] });
            if (!r.ok) { set(preview, aiError(r)); return; }
            show(r.value);
          }, "btn ai big"))
      : h("p", { class: "muted", text: "No words waiting. Add words in the Inbox." }),
    preview,
    ...[...byCat.entries()].map(([c, list]) => h("div", { attrs: { style: "display:flex;flex-direction:column;gap:6px" } }, sectionLabel(`${c} · ${list.length}`), group(...list.map((e) => entryRow(e, () => go("waiting")))))),
    sectionLabel("Without Gemini (offline, Qwen, any chat)"),
    group(
      waiting.length ? row({ icon: "practice", color: "violet", title: "Copy the card prompt", subtitle: "Same prompt for every AI", onClick: () => void copyPrompt() }) : null,
      row({ icon: "note", color: "blue", title: "Import a cards file", subtitle: "A .txt or .md file with the card lines", onClick: () => cardFile.click() }),
    ),
    promptArea, cardFile,
    h("details", { class: "group row", ...(query.get("import") ? { attrs: { open: "" } } : {}) },
      h("summary", {}, icon("pen", 18), h("b", { text: "Paste card lines" })),
      reply, button("Read cards", () => show(reply.value), "btn primary")),
    sectionLabel("Add many words"),
    h("details", { class: "group row" },
      h("summary", {}, icon("plus", 18), h("b", { text: "Paste or import a word list" })),
      field("Category for this list", listCat),
      listText,
      h("p", { class: "muted small", text: "One word per line. Add “ | a sentence” to keep where you saw it. Copy a column from Word or Excel and paste it here." }),
      h("div", { class: "row-btns" }, button("Add to waiting list", () => void runList(listText.value), "btn primary"), button("Choose a file", () => listFile.click(), "btn"))),
    listFile, listReport,
  );
};

function entryRow(e: InboxEntry, refresh: () => void): HTMLElement {
  return h("div", { class: "row static" },
    h("span", { class: "label" },
      h("b", { text: e.word, attrs: e.status === "rejected" ? { style: "text-decoration:line-through;opacity:.6" } : {} }),
      e.seenIn ? h("small", { text: e.seenIn, dir: "auto" }) : null),
    e.status === "rejected" ? h("span", { class: "badge bad", text: "Rejected" }) : null,
    h("button", { class: "btn small ghost", text: "Delete", attrs: { type: "button", "aria-label": `Delete ${e.word}` }, on: { click: async () => { await (await db()).delete("inbox", e.inboxId); refresh(); } } }));
}

interface Editor { el: HTMLElement; accept: () => Promise<boolean> }

function renderPreview(box: HTMLElement, text: string, entries: InboxEntry[], s: Settings, go: Go) {
  const waiting = entries.filter((e) => e.status === "waiting");
  const p = previewReply(text, waiting, s["privacy.blockedWords"]);
  const editor = (t: ParsedTerm, entry?: InboxEntry): Editor => {
    const input = (v: string, label: string, attrs: Record<string, string> = {}) => { const i = h("input", { attrs: { type: "text", "aria-label": label, ...attrs } }); i.value = v; return i; };
    const term = input(t.term, "Term");
    const definition = input(t.definition ?? "", "Definition");
    const ipa = input(t.ipa ?? "", "IPA");
    const example = h("textarea", { attrs: { rows: "2", "aria-label": "Example" } }); example.value = t.usage;
    const meaning = input(t.meaning, "Persian meaning", { dir: "rtl", lang: "fa" });
    const cat = categorySelect(s["categories"], entry?.category ?? s["categories.default"]);
    const card = h("section", { class: "glass rise" });
    let finished = false;
    const edited = () => term.value !== t.term || definition.value !== (t.definition ?? "") || example.value !== t.usage || meaning.value !== t.meaning || ipa.value !== (t.ipa ?? "");
    const accept = async () => {
      if (finished || !term.value.trim() || !example.value.trim() || (!definition.value.trim() && !meaning.value.trim())) return false;
      finished = true;
      await acceptGeneral({
        term: term.value.trim(), usage: example.value.trim(), meaning: meaning.value.trim(),
        definition: definition.value.trim(), ipa: ipa.value.trim(), category: cat.value,
      }, edited() ? "user" : "ai-draft", entry?.inboxId);
      set(card, h("p", { class: "ok", text: `Added: ${term.value} · ${cat.value}` }));
      return true;
    };
    add(card,
      field("Word or phrase", term), field("Definition", definition), field("IPA", ipa), field("Example", example), field("Persian", meaning), field("Category", cat),
      t.clozeOk ? null : h("p", { class: "issue", text: "The word is not in its example sentence." }),
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
    found > 1
      ? button(`Accept all ${found}`, async () => {
          let n = 0;
          for (const m of [...matched, ...extra]) if (await m.accept()) n++;
          toast(`Added ${n} card${n === 1 ? "" : "s"}. They show “AI draft” until you confirm them in Cards.`);
        }, "btn primary big")
      : null,
    ...matched.map((m) => m.el),
    extra.length ? h("h3", { class: "section-label", text: "Not in the waiting list" }) : null,
    ...extra.map((m) => m.el),
    p.missing.length ? h("p", { class: "issue", text: `No card returned for: ${p.missing.map((e) => e.word).join(", ")}` }) : null,
    ...p.issues.filter((i) => i.severity === "error").map((i) => h("p", { class: "issue error", text: `Line ${i.line} · ${i.code}: ${i.message}` })),
    found === 0 ? h("p", { class: "error", text: text.trim() ? "No card lines found in the reply." : "The reply was empty." }) : null,
    p.missing.length || found === 0
      ? h("details", { class: "group row" }, h("summary", {}, h("b", { text: "Show what came back" })), h("p", { class: "small", dir: "auto", text: text.trim().slice(0, 1500) || "(empty reply)" }))
      : null,
    button("Done", () => go("waiting"), "btn big"));
}
