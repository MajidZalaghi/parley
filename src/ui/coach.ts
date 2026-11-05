// Gemini coach screens: mock interview (AI-E), new scenario (AI-F), speak freely (AI-G).

import {
  INTERVIEW_TOPICS, interviewFeedbackRequest, interviewQuestionRequest, parseInterviewFeedback, parseQuestion,
  parseScenario, parseSpeak, scenarioRequest, speakRequest, type InterviewTopic,
} from "../ai/coach";
import { runAi } from "../ai/client";
import { addInbox, addInterviewSummary, interviewHistory, saveAiScenario, snapshot } from "../app/service";
import { itemIdOf } from "../model/types";
import { speak } from "../platform/platform";
import { loadSettings } from "../store/settings";
import { aiButton, aiError, aiStatus, setupSheet } from "./ai";
import type { Screen } from "./app";
import { add, button, chips, fa, field, group, h, icon, navBar, row, sectionLabel, set, spinnerLine, toast } from "./dom";
import { renderRoleplay, speakBtn } from "./roleplay";

const QUESTIONS_PER_SESSION = 5;
const verdictBadge = (v: "good" | "ok" | "needs-work") =>
  h("span", { class: `badge ${v === "good" ? "good" : v === "needs-work" ? "bad" : ""}`, text: v === "good" ? "Good" : v === "ok" ? "OK" : "Needs work" });

// ---------- AI-E: mock interview ----------

export const interviewScreen: Screen = async (root) => {
  const s = await loadSettings();
  let topic: InterviewTopic = "coordination";
  const asked: string[] = [];
  const verdicts: string[] = [];
  const counter = h("span", { class: "muted small", attrs: { style: "width:72px;text-align:right" } });
  const stage = h("div", { attrs: { style: "display:flex;flex-direction:column;gap:12px" } });
  const history = (await interviewHistory()).slice(0, 3);

  const finish = async () => {
    if (asked.length) await addInterviewSummary({ at: new Date().toISOString(), topic, verdicts: [...verdicts] });
    set(stage, h("section", { class: "glass" },
      h("h2", { class: "title", text: "Interview done" }),
      h("p", { class: "muted", text: `${verdicts.filter((v) => v === "good").length} of ${verdicts.length} answers rated Good.` }),
      button("Start again", () => { asked.length = 0; verdicts.length = 0; void nextQuestion(); }, "btn primary big")));
    counter.textContent = "";
  };

  const nextQuestion = async () => {
    if (asked.length >= QUESTIONS_PER_SESSION) { await finish(); return; }
    const st = await aiStatus("interview");
    if (st !== "ready") { setupSheet(st); return; }
    set(stage, spinnerLine("Gemini is preparing a question…"));
    const r = await runAi(interviewQuestionRequest(topic, asked, s["ai.maxOutputTokens.interview"]));
    if (!r.ok) { set(stage, aiError(r), button("Try again", () => void nextQuestion(), "btn")); return; }
    const q = parseQuestion(r.value);
    if (!q) { set(stage, h("p", { class: "error", text: "The question could not be read." }), button("Try again", () => void nextQuestion(), "btn")); return; }
    asked.push(q);
    counter.textContent = `${asked.length} of ${QUESTIONS_PER_SESSION}`;
    const answer = h("textarea", { attrs: { rows: "6", placeholder: "Answer aloud. Then dictate it here with the keyboard mic.", autocapitalize: "sentences", "aria-label": "Your answer" } });
    const fb = h("div");
    const actions = h("div", { class: "rate" });
    set(stage,
      h("section", { class: "glass" },
        h("span", { class: "muted small", text: "Interviewer" }),
        h("p", { class: "prompt", text: q }),
        h("div", { class: "row-btns" }, h("button", { class: "btn small", attrs: { type: "button" }, on: { click: () => speak(q, s["speech.voiceURI"]) } }, icon("speaker", 16), "Listen"))),
      field("Your answer", answer),
      fb,
      actions);
    const getFeedback = async () => {
      if (!answer.value.trim()) { toast("Say or type your answer first."); return; }
      set(fb, spinnerLine("Gemini is reading your answer…"));
      const res = await runAi(interviewFeedbackRequest({ topic, question: q, answer: answer.value.trim() }, s["ai.maxOutputTokens.interview"]));
      if (!res.ok) { set(fb, aiError(res)); return; }
      const f = parseInterviewFeedback(res.value);
      if (!f) { set(fb, h("p", { class: "error", text: "Feedback unavailable." })); return; }
      verdicts.push(f.verdict);
      set(fb, h("section", { class: "ai-card" },
        h("div", { class: "ai-head" }, h("span", { class: "row-btns" }, icon("sparkle", 16), "Gemini feedback"), verdictBadge(f.verdict)),
        fa(`محتوا: ${f.content}`),
        fa(`زبان: ${f.language}`, "warn"),
        h("p", { class: "quote", text: f.better }),
        h("div", { class: "row-btns" }, h("button", { class: "btn small", attrs: { type: "button" }, on: { click: () => speak(f.better, s["speech.voiceURI"]) } }, icon("speaker", 16), "Hear the better answer"))));
      set(actions, button("Try again", () => { answer.value = ""; set(fb); set(actions, button("Get feedback", () => void getFeedback(), "btn primary")); answer.focus(); }, "btn"), button(asked.length >= QUESTIONS_PER_SESSION ? "Finish" : "Next question", () => void nextQuestion(), "btn primary"));
    };
    set(actions, button("Skip", () => void nextQuestion(), "btn"), button("Get feedback", () => void getFeedback(), "btn primary"));
  };

  add(root,
    navBar("Practice", "#/practice", "Mock interview", counter),
    chips(INTERVIEW_TOPICS.map((t) => [t.id, t.label]) as [InterviewTopic, string][], topic, (v) => { topic = v; }),
    stage);
  set(stage,
    h("section", { class: "glass" },
      h("p", { text: "Five questions on the topic you pick. Answer aloud as in a real interview, then dictate your answer for feedback." }),
      h("p", { class: "muted small", text: "Your answers are not stored. Do not mention client or project names." }),
      aiButton("Start interview", "interview", () => nextQuestion(), "btn primary big")),
    history.length ? sectionLabel("Recent") : null,
    history.length ? group(...history.map((x) => row({ title: INTERVIEW_TOPICS.find((t) => t.id === x.topic)?.label ?? x.topic, subtitle: new Date(x.at).toLocaleDateString("en-GB"), value: `${x.verdicts.filter((v) => v === "good").length}/${x.verdicts.length} good` }))) : null);
};

// ---------- AI-F: new meeting scenario ----------

export const scenarioScreen: Screen = async (root) => {
  const snap = await snapshot();
  const s = snap.settings;
  const terms = snap.cards.filter((c) => !c.archived && c.kind === "term" && c.term);
  const known = terms.filter((c) => ["cloze", "produce", "recognise"].some((m) => snap.states.has(itemIdOf(c.id, m as "cloze"))));
  const pool = known.length >= 3 ? known : terms;
  const stage = h("div", { attrs: { style: "display:flex;flex-direction:column;gap:12px" } });
  const actions = h("div", { class: "actions" });

  const pick = () => pool.map((c) => ({ t: c.term!, r: Math.random() })).sort((a, b) => a.r - b.r).slice(0, 4).map((x) => x.t);

  const generate = async () => {
    const chosen = pick();
    if (chosen.length < 2) { toast("You need at least two term cards first."); return; }
    set(actions);
    set(stage, spinnerLine(`Writing a meeting with: ${chosen.join(", ")}…`));
    const r = await runAi(scenarioRequest(chosen, s["ai.maxOutputTokens.scenario"]));
    if (!r.ok) { set(stage, aiError(r)); set(actions, aiButton("Try again", "scenario", () => generate(), "btn primary big")); return; }
    const sc = parseScenario(r.value, chosen);
    if (!sc) { set(stage, h("p", { class: "error", text: "The scenario could not be read. Try again." })); set(actions, aiButton("Try again", "scenario", () => generate(), "btn primary big")); return; }
    const body = h("section", { class: "glass" });
    set(stage, h("div", { class: "row-btns" }, ...sc.usedTerms.map((t) => h("span", { class: "badge", text: t }))), body);
    renderRoleplay(body, {
      context: sc.context, turns: sc.turns, voiceURI: s["speech.voiceURI"], actions,
      onFinish: () => set(actions, h("div", { class: "rate" },
        button("Save as card", async () => { await saveAiScenario(sc); toast("Saved. It will come back in your reviews."); }, "btn"),
        aiButton("New scenario", "scenario", () => generate(), "btn primary"))),
    });
  };

  add(root,
    navBar("Practice", "#/practice", "New scenario"),
    stage,
    actions);
  set(stage, h("section", { class: "glass" },
    h("p", { text: "Gemini writes a short coordination meeting using four of your terms. You answer as the Senior BIM Coordinator, turn by turn." }),
    h("p", { class: "muted small", text: `${pool.length} terms available.` })));
  set(actions, aiButton("Generate scenario", "scenario", () => generate(), "btn primary big"));
};

// ---------- AI-G: speak freely ----------

export const speakScreen: Screen = async (root) => {
  const s = await loadSettings();
  const input = h("textarea", { attrs: { rows: "4", placeholder: "Tap the keyboard mic and say one or two sentences about your work today.", autocapitalize: "sentences", "aria-label": "What you said" } });
  const out = h("div", { attrs: { style: "display:flex;flex-direction:column;gap:12px" } });

  const correct = async () => {
    if (!input.value.trim()) { toast("Say or type something first."); return; }
    set(out, spinnerLine("Gemini is correcting…"));
    const r = await runAi(speakRequest(input.value.trim(), s["ai.maxOutputTokens.speak"]));
    if (!r.ok) { set(out, aiError(r)); return; }
    const c = parseSpeak(r.value);
    if (!c) { set(out, h("p", { class: "error", text: "The correction could not be read." })); return; }
    const phrase = h("input", { attrs: { type: "text", placeholder: "A phrase from it to learn", "aria-label": "Phrase to add" } });
    set(out,
      h("section", { class: "ai-card" },
        h("div", { class: "ai-head" }, h("span", { class: "row-btns" }, icon("sparkle", 16), "Natural version"), speakBtn(c.corrected, s["speech.voiceURI"])),
        h("p", { class: "quote", text: c.corrected }),
        fa(c.note)),
      sectionLabel("Learn a phrase from it"),
      h("section", { class: "glass" }, phrase,
        button("Add to Inbox", async () => {
          const res = await addInbox(phrase.value, c.corrected);
          toast(res.ok ? "Added to Inbox." : res.message);
          if (res.ok) phrase.value = "";
        }, "btn")));
  };

  add(root,
    navBar("Practice", "#/practice", "Speak freely"),
    h("section", { class: "glass" }, input, aiButton("Correct it", "speak", () => correct(), "btn primary big"),
      h("p", { class: "muted small", text: "Nothing you say here is stored. Avoid client and project names." })),
    out);
};
