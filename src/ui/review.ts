// Review session (approved mockups: Review, Role-play). Supports normal, weak, note and free sessions.

import { explainRequest, parseExplain, parseSentence, sentenceRequest } from "../ai/features";
import { runAi } from "../ai/client";
import { addExtraUsage, fsrsSettingsFrom, recordReview, snapshot, undoReview, type Snapshot } from "../app/service";
import { splitItemId, type Card, type Rating, type ReviewLogEntry } from "../model/types";
import { findCloze } from "../parser/text";
import { intervalLabel, makeCanonical, previewDue } from "../schedule/scheduler";
import { db, type SessionState } from "../store/db";
import { aiButton, aiError } from "./ai";
import type { Go, Screen } from "./app";
import { add, button, fa, h, icon, set, spinnerLine, toast } from "./dom";
import { renderRoleplay, speakBtn } from "./roleplay";

export const reviewScreen: Screen = async (root, go) => {
  const d = await db();
  const session = await d.get("session", "current");
  if (!session || session.pos >= session.itemIds.length) {
    add(root,
      h("div", { attrs: { style: "flex:1" } }),
      h("section", { class: "glass", attrs: { style: "text-align:center" } },
        h("h1", { class: "large-title", text: "Session done" }),
        h("p", { class: "muted", text: session?.kind === "free" ? "Free practice: your schedule did not change." : "Nice work. Nothing left in this session." }),
        button("Back to Today", () => go("today"), "btn primary big")),
      h("div", { attrs: { style: "flex:1" } }));
    if (session) await d.delete("session", "current");
    return;
  }
  const snap = await snapshot();
  await renderItem(root, go, session, snap, makeCanonical(snap.aliases));
};

async function saveSession(s: SessionState) {
  s.updatedAt = new Date().toISOString();
  await (await db()).put("session", s);
}

const MODE_LABEL: Record<string, string> = { cloze: "Fill the gap", produce: "Meaning → Term", recognise: "Term → Meaning", roleplay: "Role-play" };

async function renderItem(root: HTMLElement, go: Go, session: SessionState, snap: Snapshot, canonical: (id: string) => string) {
  const itemId = session.itemIds[session.pos]!;
  const { cardId, mode } = splitItemId(itemId);
  const card = snap.cardById.get(canonical(cardId));
  const s = snap.settings;
  const free = session.kind === "free";
  const started = performance.now();

  if (!card || card.archived) {
    session.pos++;
    await saveSession(session);
    go("review");
    return;
  }

  const undo = async () => {
    const entry = (await (await db()).get("logs", session.lastEntry!.entryId)) as ReviewLogEntry | undefined;
    if (entry) await undoReview(entry);
    session.pos = Math.max(0, session.pos - 1);
    session.lastEntry = null;
    await saveSession(session);
    go("review");
  };

  const pct = Math.round((session.pos / session.itemIds.length) * 100);
  add(root, h("div", { class: "review-top" },
    h("a", { class: "btn round", attrs: { href: "#/today", "aria-label": "Close session" } }, icon("close", 16)),
    h("div", { class: "progress", attrs: { role: "progressbar", "aria-valuenow": String(pct), "aria-valuemin": "0", "aria-valuemax": "100" } }, h("div", { attrs: { style: `width:${pct}%` } })),
    h("span", { class: "muted small", text: `${session.pos + 1} / ${session.itemIds.length}` }),
    session.lastEntry && !free ? button("Undo", () => void undo(), "btn small") : null,
  ));

  const label = `${card.deck === "bim" ? "BIM" : "General"} · ${MODE_LABEL[mode] ?? mode}${free ? " · Free" : session.title ? ` · ${session.title}` : ""}`;
  const body = h("section", { class: "glass" });
  const extras = h("div", { class: "row-btns" });
  const aiBox = h("div");
  const actions = h("div", { class: "actions" });
  add(root, h("span", { class: "pill", text: label }), body, extras, aiBox, actions);

  const rate = async (r: Rating) => {
    if (!free) {
      const entry = await recordReview(itemId, r, performance.now() - started);
      session.lastEntry = { entryId: entry.entryId, itemId };
    }
    session.pos++;
    await saveSession(session);
    go("review");
  };

  const showRating = () => {
    const due = previewDue(snap.states.get(itemId)?.fsrs ?? null, new Date(), fsrsSettingsFrom(s));
    const now = new Date();
    const b = (r: Rating, name: string, cls: string) =>
      h("button", { class: `btn ${cls}`, attrs: { type: "button" }, on: { click: () => void rate(r) } }, name, free ? null : h("small", { text: intervalLabel(now, due[r]) }));
    set(actions, h("div", { class: "rate" },
      b(1, "Again", "again"),
      s["rating.buttons"] === 4 ? b(2, "Hard", "") : null,
      b(3, "Good", "primary"),
      s["rating.buttons"] === 4 ? b(4, "Easy", "") : null,
    ));
  };

  if (mode === "roleplay") {
    renderRoleplay(body, { context: card.context ?? "", turns: card.turns ?? [], card, voiceURI: s["speech.voiceURI"], onFinish: showRating, actions });
    if (card.origin === "ai-draft") add(body, h("span", { class: "badge", text: "AI scenario" }));
    return;
  }

  const term = card.term ?? "";
  const sentence = pickSentence(card, snap.states.get(itemId)?.fsrs.reps ?? 0);
  const prompt = h("div", { attrs: { style: "display:flex;flex-direction:column;gap:14px" } });
  if (mode === "cloze") {
    const m = findCloze(term, sentence);
    add(prompt, h("p", { class: "prompt", text: m ? `${sentence.slice(0, m.start)}_____${sentence.slice(m.end)}` : sentence }), fa(card.meaning ?? "", "muted"));
  } else if (mode === "produce") {
    add(prompt, fa(card.meaning ?? "", "prompt"), h("p", { class: "muted small", text: "Say the English term aloud." }));
  } else {
    add(prompt, h("div", { class: "kv", attrs: { style: "align-items:center" } }, h("span", { class: "term", text: term }), speakBtn(term, s["speech.voiceURI"])));
  }
  add(body, prompt);

  const reveal = () => {
    set(body,
      h("div", { class: "kv", attrs: { style: "align-items:center" } }, h("span", { class: "term", text: term }), speakBtn(term, s["speech.voiceURI"])),
      highlighted(sentence, term),
      h("div", { class: "divider" }),
      fa(card.meaning ?? ""),
      card.origin === "ai-draft" ? h("span", { class: "badge", text: "AI draft — confirm in Cards" }) : null,
    );
    const successes = (snap.states.get(itemId)?.reviews ?? []).filter((r) => (r.rating ?? 0) >= 3).length;
    set(extras,
      aiButton("Explain", "explain", () => explain(card, aiBox, s["ai.maxOutputTokens.explain"])),
      successes >= 3 || free ? aiButton("New sentence", "sentence", () => newSentence(card, aiBox, s["ai.maxOutputTokens.sentence"])) : null,
    );
    showRating();
  };
  set(actions, button("Show answer", reveal, "btn primary big"));
}

function pickSentence(card: Card, reps: number): string {
  const usage = card.usage ?? "";
  const extras = card.extraUsages.map((x) => x.text).filter((t) => findCloze(card.term ?? "", t));
  const all = [usage, ...extras];
  return all[reps % all.length] ?? usage;
}

function highlighted(sentence: string, term: string): HTMLElement {
  const m = findCloze(term, sentence);
  const p = h("p", { class: "sentence" });
  if (!m) { p.textContent = sentence; return p; }
  add(p, sentence.slice(0, m.start), h("mark", { text: sentence.slice(m.start, m.end) }), sentence.slice(m.end));
  return p;
}

async function explain(card: Card, box: HTMLElement, max: number) {
  set(box, spinnerLine("Asking Gemini…"));
  const r = await runAi(explainRequest({ term: card.term ?? "", meaning: card.meaning ?? "", usage: card.usage ?? "" }, max));
  if (!r.ok) { set(box, aiError(r)); return; }
  const t = parseExplain(r.value);
  set(box, t ? h("section", { class: "ai-card" }, h("div", { class: "ai-head" }, h("span", { class: "row-btns" }, icon("sparkle", 16), "Explain")), fa(t)) : h("p", { class: "error", text: "Explanation unavailable." }));
}

async function newSentence(card: Card, box: HTMLElement, max: number) {
  set(box, spinnerLine("Asking Gemini…"));
  const r = await runAi(sentenceRequest({ term: card.term ?? "", meaning: card.meaning ?? "", usage: card.usage ?? "" }, max));
  if (!r.ok) { set(box, aiError(r)); return; }
  const sentence = parseSentence(r.value, card.term ?? "");
  if (!sentence) { set(box, h("p", { class: "error", text: "The new sentence did not contain the term; not used." })); return; }
  set(box, h("section", { class: "ai-card" },
    h("div", { class: "ai-head" }, h("span", { class: "row-btns" }, icon("sparkle", 16), "New sentence")),
    highlighted(sentence, card.term ?? ""),
    h("div", { class: "row-btns" },
      button("Keep", async () => { await addExtraUsage(card, sentence, "ai-sentence"); toast("Added to the card."); set(box); }, "btn small primary"),
      button("Discard", () => set(box), "btn small"))));
}
