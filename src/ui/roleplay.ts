// Turn-by-turn role-play, shared by review (BIM and saved AI scenarios) and the AI scenario screen.

import { feedbackRequest, parseFeedback } from "../ai/features";
import { runAi } from "../ai/client";
import { addExtraUsage } from "../app/service";
import type { Card } from "../model/types";
import type { ScenarioTurn } from "../parser/types";
import { englishVoices, speak } from "../platform/platform";
import { loadSettings } from "../store/settings";
import { aiButton, aiError } from "./ai";
import { add, button, fa, h, icon, set, spinnerLine, toast } from "./dom";

export interface RoleplayOpts {
  context: string;
  turns: ScenarioTurn[];
  card?: Card;              // set when the scenario is a stored card (tips can be saved)
  voiceURI: string | null;
  onFinish: () => void;     // called after the last turn, e.g. to show rating buttons
  actions: HTMLElement;     // sticky action area of the screen
}

export function speakBtn(text: string, voiceURI: string | null): HTMLElement | null {
  return englishVoices().length
    ? h("button", { class: "btn round", attrs: { type: "button", "aria-label": "Play pronunciation", style: "width:32px;min-height:32px;background:transparent;border:0;color:var(--accent-text)" }, on: { click: () => speak(text, voiceURI) } }, icon("speaker", 18))
    : null;
}

export function renderRoleplay(container: HTMLElement, o: RoleplayOpts): void {
  const dialogue = h("div", { class: "dialogue" });
  add(container, fa(o.context, "muted small"), dialogue);
  let i = 0;

  const bubble = (cls: string, who: string, text: string) =>
    h("div", { class: `bubble ${cls}` }, h("b", { text: who }), h("span", { text }), speakBtn(text, o.voiceURI));

  const step = () => {
    while (i < o.turns.length && !o.turns[i]!.isYou) {
      dialogue.append(bubble("", o.turns[i]!.speaker, o.turns[i]!.text));
      i++;
    }
    if (i >= o.turns.length) { set(o.actions); o.onFinish(); return; }
    const you = o.turns[i]!;
    const prevOther = [...o.turns.slice(0, i)].reverse().find((t) => !t.isYou)?.text ?? "";
    const input = h("textarea", { attrs: { rows: "3", placeholder: "Answer aloud first. Optional: dictate it here with the keyboard mic.", autocapitalize: "sentences" } });
    const slot = h("div", { class: "dialogue" }, input);
    dialogue.append(slot);
    set(o.actions, button("Reveal", () => {
      const given = input.value.trim();
      const fb = h("div");
      set(slot,
        given ? bubble("me", "You said", given) : null,
        bubble("model", "Model answer", you.text),
        fb,
        given ? h("div", { class: "row-btns", attrs: { style: "justify-content:flex-end" } },
          aiButton("Feedback", "feedback", () => feedback(fb, { context: o.context, otherLine: prevOther, model: you.text, answer: given }, o.card))) : null,
      );
      i++;
      const last = o.turns.slice(i).every((t) => !t.isYou);
      set(o.actions, button(last ? "Finish" : "Next", () => step(), "btn primary big"));
    }, "btn primary big"));
  };
  step();
}

async function feedback(box: HTMLElement, p: { context: string; otherLine: string; model: string; answer: string }, card?: Card) {
  const s = await loadSettings();
  set(box, spinnerLine("Asking Gemini…"));
  const r = await runAi(feedbackRequest(p, s["ai.maxOutputTokens.feedback"]));
  if (!r.ok) { set(box, aiError(r)); return; }
  const f = parseFeedback(r.value);
  if (!f) { set(box, h("p", { class: "error", text: "Feedback unavailable." })); return; }
  const verdict = { good: ["Good", "good"], ok: ["OK", ""], "needs-work": ["Needs work", "bad"] }[f.verdict];
  set(box, h("section", { class: "ai-card", attrs: { "aria-label": "Gemini feedback" } },
    h("div", { class: "ai-head" }, h("span", { class: "row-btns" }, icon("sparkle", 16), "Gemini feedback"), h("span", { class: `badge ${verdict[1]}`, text: verdict[0] })),
    fa(f.worked),
    fa(f.fix, "warn"),
    h("p", { class: "quote", text: f.better }),
    h("div", { class: "kv" },
      h("span", { class: "muted small", text: "Advice only. You choose the rating." }),
      card ? button("Save tip", async () => { await addExtraUsage(card, f.better, "ai-tip"); toast("Saved to the card."); }, "btn small") : null),
  ));
}
