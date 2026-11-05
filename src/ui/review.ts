// Review session: the four modes, rating, undo, resume and AI buttons (requirements §5, §6, §8).

import { explainRequest, feedbackRequest, parseExplain, parseFeedback, parseSentence, sentenceRequest } from "../ai/features";
import { runAi } from "../ai/client";
import { errorMessage } from "../ai/provider";
import { addExtraUsage, recordReview, snapshot, undoReview, type Snapshot } from "../app/service";
import { splitItemId, type Card, type Rating, type ReviewLogEntry } from "../model/types";
import { findCloze } from "../parser/text";
import { englishVoices, speak } from "../platform/platform";
import { makeCanonical } from "../schedule/scheduler";
import { db, getApiKey, type SessionState } from "../store/db";
import type { Screen } from "./app";
import { add, set, auto, button, h, toast } from "./dom";

export const reviewScreen: Screen = async (root, go) => {
  const d = await db();
  const session = await d.get("session", "current");
  if (!session || session.pos >= session.itemIds.length) {
    add(root, h("h1", { text: "Session done" }), h("p", { text: "Nice work. Nothing left in this session." }), button("Home", () => go("home"), "btn primary big"));
    if (session) await d.delete("session", "current");
    return;
  }
  const snap = await snapshot();
  const hasKey = !!(await getApiKey()) && snap.settings["ai.paidTierConfirmed"];
  const canonical = makeCanonical(snap.aliases);
  await renderItem(root, go, session, snap, canonical, hasKey);
};

async function saveSession(s: SessionState) {
  s.updatedAt = new Date().toISOString();
  await (await db()).put("session", s);
}

async function renderItem(root: HTMLElement, go: (s: "home" | "review") => void, session: SessionState, snap: Snapshot, canonical: (id: string) => string, aiReady: boolean) {
  const itemId = session.itemIds[session.pos]!;
  const { cardId, mode } = splitItemId(itemId);
  const card = snap.cardById.get(canonical(cardId));
  const started = performance.now();
  const s = snap.settings;

  const top = h("div", { class: "review-top" },
    button("✕", () => go("home"), "btn ghost"),
    h("span", { class: "muted", text: `${session.pos + 1} / ${session.itemIds.length}` }),
    session.lastEntry ? button("Undo", () => void undo(), "btn ghost") : h("span"),
  );

  async function undo() {
    const entry = (await (await db()).get("logs", session.lastEntry!.entryId)) as ReviewLogEntry | undefined;
    if (entry) await undoReview(entry);
    session.pos = Math.max(0, session.pos - 1);
    session.lastEntry = null;
    await saveSession(session);
    go("review");
  }

  if (!card || card.archived) {
    // Card removed since the session started: skip it.
    session.pos++;
    await saveSession(session);
    go("review");
    return;
  }

  const body = h("section", { class: "card-face" });
  const answer = h("section", { class: "card-answer", attrs: { hidden: "" } });
  const actions = h("div", { class: "actions" });
  add(root, top, h("p", { class: "mode-label", text: `${card.deck === "bim" ? "BIM" : "General"} · ${labelOf(mode)}` }), body, answer, actions);

  const rate = async (r: Rating) => {
    const entry = await recordReview(itemId, r, performance.now() - started);
    session.pos++;
    session.lastEntry = { entryId: entry.entryId, itemId };
    await saveSession(session);
    go("review");
  };

  const showRating = () => {
    const four = s["rating.buttons"] === 4;
    set(actions, 
      button("Again", () => void rate(1), "btn again"),
      four ? button("Hard", () => void rate(2), "btn hard") : null,
      button("Good", () => void rate(3), "btn good"),
      four ? button("Easy", () => void rate(4), "btn easy") : null,
    );
  };

  const speakBtn = (text: string) =>
    englishVoices().length ? button("🔊", () => speak(text, s["speech.voiceURI"]), "btn ghost speak") : null;

  if (mode === "roleplay") {
    renderRoleplay(card, body, answer, actions, showRating, aiReady, speakBtn);
    return;
  }

  const sentence = pickSentence(card, snap.states.get(itemId)?.fsrs.reps ?? 0);
  const term = card.term ?? "";

  if (mode === "cloze") {
    const m = findCloze(term, sentence);
    const blanked = m ? `${sentence.slice(0, m.start)}_____${sentence.slice(m.end)}` : sentence;
    add(body, h("p", { class: "prompt en", text: blanked }), auto(card.meaning ?? "", "hint fa"));
  } else if (mode === "produce") {
    add(body, auto(card.meaning ?? "", "prompt fa"), h("p", { class: "muted", text: "Say the English term aloud." }));
  } else {
    add(body, h("p", { class: "prompt en", text: term }), speakBtn(term));
  }

  add(answer, 
    h("p", { class: "answer-term", text: term }, speakBtn(term) ?? ""),
    highlighted(sentence, term),
    auto(card.meaning ?? "", "fa"),
    card.origin === "ai-draft" ? h("p", { class: "badge", text: "AI draft — confirm or edit in Cards" }) : null,
  );
  const aiBox = h("div", { class: "ai-box" });
  if (aiReady) {
    const successes = (snap.states.get(itemId)?.reviews ?? []).filter((r) => (r.rating ?? 0) >= 3).length;
    add(aiBox, 
      s["ai.features"].includes("explain") ? button("Explain", () => void explain(card, aiBox, s["ai.maxOutputTokens.explain"]), "btn small") : null,
      s["ai.features"].includes("sentence") && successes >= 3 ? button("New sentence", () => void newSentence(card, aiBox, s["ai.maxOutputTokens.sentence"]), "btn small") : null,
    );
  }
  add(answer, aiBox);

  add(actions, button("Show answer", () => { answer.hidden = false; showRating(); }, "btn primary big"));
}

function renderRoleplay(
  card: Card, body: HTMLElement, answer: HTMLElement, actions: HTMLElement, showRating: () => void, aiReady: boolean,
  speakBtn: (t: string) => HTMLElement | null,
) {
  const turns = card.turns ?? [];
  add(body, auto(card.context ?? "", "context fa"));
  const dialogue = h("div", { class: "dialogue" });
  add(body, dialogue);
  answer.hidden = false;
  let i = 0;

  const line = (speaker: string, text: string, you: boolean) =>
    h("div", { class: you ? "turn you" : "turn" }, h("strong", { text: `${speaker}: ` }), h("span", { text }), speakBtn(text) ?? "");

  const step = () => {
    while (i < turns.length && !turns[i]!.isYou) {
      add(dialogue, line(turns[i]!.speaker, turns[i]!.text, false));
      i++;
    }
    if (i >= turns.length) {
      set(actions, );
      showRating();
      return;
    }
    const you = turns[i]!;
    const prevOther = [...turns.slice(0, i)].reverse().find((t) => !t.isYou)?.text ?? "";
    const input = h("textarea", { class: "answer-input", attrs: { rows: "3", placeholder: "Say it aloud. Optional: dictate or type it here.", autocapitalize: "sentences" } });
    const slot = h("div", { class: "you-slot" }, h("p", { class: "muted", text: "Your turn (answer aloud first)" }), input);
    add(dialogue, slot);
    set(actions, 
      button("Reveal", () => {
        const given = input.value.trim();
        set(slot, 
          given ? h("div", { class: "turn mine" }, h("strong", { text: "You said: " }), h("span", { text: given })) : "",
          line("Model", you.text, true),
        );
        const fbBox = h("div", { class: "ai-box" });
        add(slot, fbBox);
        if (aiReady && given) {
          add(fbBox, button("Feedback", () => void feedback(card, fbBox, { context: card.context ?? "", otherLine: prevOther, model: you.text, answer: given }), "btn small"));
        }
        i++;
        set(actions, button(i >= turns.length || turns.slice(i).every((t) => !t.isYou) ? "Finish" : "Next", () => step(), "btn primary big"));
      }, "btn primary big"),
    );
    input.focus();
  };
  step();
}

function pickSentence(card: Card, reps: number): string {
  const usage = card.usage ?? "";
  const extras = card.extraUsages.map((x) => x.text).filter((t) => findCloze(card.term ?? "", t));
  const all = [usage, ...extras];
  return all[reps % all.length] ?? usage;
}

function highlighted(sentence: string, term: string): HTMLElement {
  const m = findCloze(term, sentence);
  const p = h("p", { class: "sentence en" });
  if (!m) { p.textContent = sentence; return p; }
  add(p, sentence.slice(0, m.start), h("mark", { text: sentence.slice(m.start, m.end) }), sentence.slice(m.end));
  return p;
}

function labelOf(mode: string): string {
  return ({ cloze: "Fill the gap", produce: "Meaning → Term", recognise: "Term → Meaning", roleplay: "Role-play" } as Record<string, string>)[mode] ?? mode;
}

// ---------- AI ----------

async function feedback(card: Card, box: HTMLElement, p: { context: string; otherLine: string; model: string; answer: string }) {
  const s = (await snapshot()).settings;
  set(box, h("p", { class: "muted", text: "Asking Gemini…" }));
  const r = await runAi(feedbackRequest(p, s["ai.maxOutputTokens.feedback"]));
  if (!r.ok) { set(box, h("p", { class: "error", text: errorMessage(r.error, r.detail) })); return; }
  const f = parseFeedback(r.value);
  if (!f) { set(box, h("p", { class: "error", text: "Feedback unavailable." })); return; }
  const verdict = { good: "Good", ok: "OK", "needs-work": "Needs work" }[f.verdict];
  set(box, 
    h("p", { class: `verdict ${f.verdict}`, text: verdict }),
    auto(`✓ ${f.worked}`, "fa"),
    auto(`→ ${f.fix}`, "fa"),
    h("p", { class: "sentence en", text: f.better }),
    h("p", { class: "muted small", text: "Advice only: choose your own rating." }),
    button("Save tip to card", async () => { await addExtraUsage(card, f.better, "ai-tip"); toast("Saved."); }, "btn small"),
  );
}

async function explain(card: Card, box: HTMLElement, max: number) {
  set(box, h("p", { class: "muted", text: "Asking Gemini…" }));
  const r = await runAi(explainRequest({ term: card.term ?? "", meaning: card.meaning ?? "", usage: card.usage ?? "" }, max));
  if (!r.ok) { set(box, h("p", { class: "error", text: errorMessage(r.error, r.detail) })); return; }
  const t = parseExplain(r.value);
  set(box, t ? auto(t, "explain fa") : h("p", { class: "error", text: "Explanation unavailable." }));
}

async function newSentence(card: Card, box: HTMLElement, max: number) {
  set(box, h("p", { class: "muted", text: "Asking Gemini…" }));
  const r = await runAi(sentenceRequest({ term: card.term ?? "", meaning: card.meaning ?? "", usage: card.usage ?? "" }, max));
  if (!r.ok) { set(box, h("p", { class: "error", text: errorMessage(r.error, r.detail) })); return; }
  const sentence = parseSentence(r.value, card.term ?? "");
  if (!sentence) { set(box, h("p", { class: "error", text: "The new sentence did not contain the term; not used." })); return; }
  set(box, 
    highlighted(sentence, card.term ?? ""),
    button("Keep this sentence", async () => { await addExtraUsage(card, sentence, "ai-sentence"); toast("Added to the card."); set(box, ); }, "btn small"),
    button("Discard", () => set(box, ), "btn small ghost"),
  );
}
