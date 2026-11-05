// Review session. Flashcard (front: term + category; back: definition, IPA, example, Persian on demand)
// and Reverse are the default modes (revision 5); cloze, produce, recognise and role-play remain available.

import { explainRequest, parseExplain, parseSentence, sentenceRequest } from "../ai/features";
import { runAi } from "../ai/client";
import { addExtraUsage, fsrsSettingsFrom, isLeech, recordReview, snapshot, undoReview, type Snapshot } from "../app/service";
import { categoryOf, splitItemId, type Card, type Rating, type ReviewLogEntry } from "../model/types";
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
      h("section", { class: "glass pop", attrs: { style: "text-align:center" } },
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

const MODE_LABEL: Record<string, string> = {
  flashcard: "Flashcard", reverse: "Reverse", cloze: "Fill the gap", produce: "Meaning → Term", recognise: "Term → Meaning", roleplay: "Role-play",
};

/** "فارسی" button that reveals the Persian meaning with a soft animation. */
export function persianToggle(meaning: string): HTMLElement | null {
  if (!meaning) return null;
  const inner = h("div", {}, fa(meaning, "fa-meaning"));
  const box = h("div", { class: "reveal", attrs: { "aria-hidden": "true" } }, inner);
  const btn = h("button", { class: "btn small fa-btn", attrs: { type: "button", "aria-expanded": "false", lang: "fa" }, text: "فارسی" });
  btn.addEventListener("click", () => {
    const open = box.classList.toggle("open");
    btn.setAttribute("aria-expanded", String(open));
    box.setAttribute("aria-hidden", String(!open));
  });
  return h("div", { class: "fa-wrap" }, btn, box);
}

/** Flip animation: rotate out, swap content, rotate in. Instant when Reduce Motion is on. */
function flip(card: HTMLElement, renderBack: () => void): void {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) { renderBack(); return; }
  card.classList.add("flip-out");
  setTimeout(() => { renderBack(); card.classList.remove("flip-out"); card.classList.add("flip-in"); setTimeout(() => card.classList.remove("flip-in"), 260); }, 170);
}

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
  const bar = h("div", { attrs: { style: `width:${Math.max(0, pct - 8)}%` } });
  add(root, h("div", { class: "review-top" },
    h("a", { class: "btn round", attrs: { href: "#/today", "aria-label": "Close session" } }, icon("close", 16)),
    h("div", { class: "progress", attrs: { role: "progressbar", "aria-valuenow": String(pct), "aria-valuemin": "0", "aria-valuemax": "100" } }, bar),
    h("span", { class: "muted small", text: `${session.pos + 1} / ${session.itemIds.length}` }),
    session.lastEntry && !free ? button("Undo", () => void undo(), "btn small") : null,
  ));
  requestAnimationFrame(() => { bar.style.width = `${pct}%`; });

  const label = `${MODE_LABEL[mode] ?? mode}${free ? " · Free" : session.title ? ` · ${session.title}` : ""}`;
  const face = h("section", { class: "glass flashcard" });
  const extras = h("div", { class: "row-btns" });
  const aiBox = h("div");
  const actions = h("div", { class: "actions" });
  add(root, h("div", { class: "kv" }, h("span", { class: "pill", text: label }), h("span", { class: "badge cat", text: categoryOf(card) })), face, extras, aiBox, actions);

  const rate = async (r: Rating) => {
    face.classList.add(r === 1 ? "exit-left" : "exit-right");
    if (!free) {
      const entry = await recordReview(itemId, r, performance.now() - started);
      session.lastEntry = { entryId: entry.entryId, itemId };
    }
    session.pos++;
    await saveSession(session);
    setTimeout(() => go("review"), matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 180);
  };

  const showRating = () => {
    const due = previewDue(snap.states.get(itemId)?.fsrs ?? null, new Date(), fsrsSettingsFrom(s));
    const now = new Date();
    const b = (r: Rating, name: string, cls: string) =>
      h("button", { class: `btn ${cls}`, attrs: { type: "button" }, on: { click: () => void rate(r) } }, name, free ? null : h("small", { text: intervalLabel(now, due[r]) }));
    set(actions, h("div", { class: "rate rise" },
      b(1, "Again", "again"),
      s["rating.buttons"] === 4 ? b(2, "Hard", "hard") : null,
      b(3, "Good", "primary"),
      s["rating.buttons"] === 4 ? b(4, "Easy", "easy") : null,
    ));
  };

  if (mode === "roleplay") {
    renderRoleplay(face, { context: card.context ?? "", turns: card.turns ?? [], card, voiceURI: s["speech.voiceURI"], onFinish: showRating, actions });
    if (card.origin === "ai-draft") add(face, h("span", { class: "badge", text: "AI scenario" }));
    return;
  }

  const term = card.term ?? "";
  const sentence = pickSentence(card, snap.states.get(itemId)?.fsrs.reps ?? 0);
  const voice = s["speech.voiceURI"];
  const leech = isLeech(card, snap.states);

  // ---------- front ----------
  if (mode === "flashcard" || mode === "recognise") {
    add(face, h("div", { class: "front-center" }, h("span", { class: "term big", text: term }), h("span", { class: "muted small", text: "Tap to show the answer" })));
  } else if (mode === "reverse") {
    add(face, h("div", { class: "front-center" },
      card.definition ? h("p", { class: "prompt", text: card.definition }) : fa(card.meaning ?? "", "prompt"),
      h("span", { class: "muted small", text: "Say the English word or phrase aloud." })));
  } else if (mode === "cloze") {
    const m = findCloze(term, sentence);
    add(face, h("p", { class: "prompt", text: m ? `${sentence.slice(0, m.start)}_____${sentence.slice(m.end)}` : sentence }),
      card.definition ? h("p", { class: "muted", text: card.definition }) : persianToggle(card.meaning ?? ""));
  } else {
    add(face, fa(card.meaning ?? "", "prompt"), h("p", { class: "muted small", text: "Say the English term aloud." }));
  }

  // ---------- back ----------
  const renderBack = () => {
    set(face,
      h("div", { class: "kv", attrs: { style: "align-items:center" } },
        h("div", { attrs: { style: "display:flex;flex-direction:column;gap:2px" } },
          h("span", { class: "term", text: term }),
          card.ipa ? h("span", { class: "ipa", text: card.ipa }) : null),
        speakBtn(term, voice)),
      card.definition ? h("p", { class: "definition", text: card.definition }) : null,
      sentence ? h("div", { class: "example" }, highlighted(sentence, term), speakBtn(sentence, voice)) : null,
      persianToggle(card.meaning ?? ""),
      leech ? h("p", { class: "issue", text: "Leech: forgotten many times. Consider editing this card in Cards (new example or definition)." }) : null,
      card.origin === "ai-draft" ? h("span", { class: "badge", text: "AI draft — confirm in Cards" }) : null,
    );
    const successes = (snap.states.get(itemId)?.reviews ?? []).filter((r) => (r.rating ?? 0) >= 3).length;
    set(extras,
      aiButton("Explain", "explain", () => explain(card, aiBox, s["ai.maxOutputTokens.explain"])),
      successes >= 3 || free ? aiButton("New sentence", "sentence", () => newSentence(card, aiBox, s["ai.maxOutputTokens.sentence"])) : null,
    );
    showRating();
  };
  let revealed = false;
  const reveal = () => { if (revealed) return; revealed = true; flip(face, renderBack); };
  face.addEventListener("click", (e) => { if (!(e.target as HTMLElement).closest("button")) reveal(); });
  set(actions, button("Show answer", reveal, "btn primary big"));
}

function pickSentence(card: Card, reps: number): string {
  const usage = card.usage ?? "";
  const extras = card.extraUsages.map((x) => x.text).filter((t) => findCloze(card.term ?? "", t));
  const all = [usage, ...extras].filter(Boolean);
  return all[reps % Math.max(1, all.length)] ?? usage;
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
  const r = await runAi(explainRequest({ term: card.term ?? "", meaning: card.meaning || card.definition || "", usage: card.usage ?? "" }, max));
  if (!r.ok) { set(box, aiError(r)); return; }
  const t = parseExplain(r.value);
  set(box, t ? h("section", { class: "ai-card rise" }, h("div", { class: "ai-head" }, h("span", { class: "row-btns" }, icon("sparkle", 16), "Explain")), fa(t)) : h("p", { class: "error", text: "Explanation unavailable." }));
}

async function newSentence(card: Card, box: HTMLElement, max: number) {
  set(box, spinnerLine("Asking Gemini…"));
  const r = await runAi(sentenceRequest({ term: card.term ?? "", meaning: card.meaning || card.definition || "", usage: card.usage ?? "" }, max));
  if (!r.ok) { set(box, aiError(r)); return; }
  const sentence = parseSentence(r.value, card.term ?? "");
  if (!sentence) { set(box, h("p", { class: "error", text: "The new sentence did not contain the term; not used." })); return; }
  set(box, h("section", { class: "ai-card rise" },
    h("div", { class: "ai-head" }, h("span", { class: "row-btns" }, icon("sparkle", 16), "New sentence")),
    highlighted(sentence, card.term ?? ""),
    h("div", { class: "row-btns" },
      button("Keep", async () => { await addExtraUsage(card, sentence, "ai-sentence"); toast("Added to the card."); set(box); }, "btn small primary"),
      button("Discard", () => set(box), "btn small"))));
}
