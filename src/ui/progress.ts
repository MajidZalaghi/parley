// Progress tab (approved mockup: Progress): F-1, weak cards list (F-2) and AI-H.

import { parseWeakSentences, weakSentencesRequest } from "../ai/coach";
import { runAi } from "../ai/client";
import { addExtraUsage, snapshot, startSession } from "../app/service";
import { computeStats, weakItemIds } from "../review/stats";
import { liveReviews } from "../schedule/scheduler";
import { aiButton, aiError } from "./ai";
import type { Screen } from "./app";
import { add, button, group, h, largeHeader, row, sectionLabel, set, spinnerLine, toast } from "./dom";

export const progressScreen: Screen = async (root, go) => {
  const snap = await snapshot();
  const st = computeStats(snap.cards, snap.states, liveReviews(snap.logs), new Date(), snap.settings["day.rolloverHour"]);
  const max = Math.max(1, ...st.daily);
  const pct = st.retention === null ? null : Math.round(st.retention * 100);
  const circ = 2 * Math.PI * 40;

  const ring = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  ring.setAttribute("width", "96"); ring.setAttribute("height", "96"); ring.setAttribute("viewBox", "0 0 100 100");
  ring.setAttribute("role", "img"); ring.setAttribute("aria-label", pct === null ? "No retention data yet" : `Retention ${pct} percent`);
  const mk = (tag: string, attrs: Record<string, string>, text?: string) => {
    const e = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (text) e.textContent = text;
    ring.append(e);
  };
  mk("circle", { cx: "50", cy: "50", r: "40", fill: "none", stroke: "var(--fill-2)", "stroke-width": "10" });
  if (pct !== null) mk("circle", { cx: "50", cy: "50", r: "40", fill: "none", stroke: "var(--accent)", "stroke-width": "10", "stroke-linecap": "round", "stroke-dasharray": String(circ), "stroke-dashoffset": String(circ * (1 - pct / 100)), transform: "rotate(-90 50 50)" });
  mk("text", { x: "50", y: "50", "text-anchor": "middle", "font-size": "20", "font-weight": "700", fill: "currentColor" }, pct === null ? "–" : `${pct}%`);
  mk("text", { x: "50", y: "66", "text-anchor": "middle", "font-size": "10", fill: "currentColor", opacity: "0.7" }, "retention");

  const firstLabel = st.dailyStart.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const weakBox = h("div", { attrs: { style: "display:flex;flex-direction:column;gap:10px" } });
  const weakTerms = st.weak.filter((w) => w.card.kind === "term" && w.card.term).map((w) => w.card);

  add(root,
    largeHeader("Progress"),
    h("section", { class: "glass" },
      h("div", { class: "ring" },
        h("div", { attrs: { style: "display:flex;flex-direction:column;gap:4px" } },
          h("span", { class: "muted", text: "Days to 4 August 2027" }),
          h("span", { attrs: { style: "font-size:34px;font-weight:700;letter-spacing:-0.02em" }, text: String(st.daysLeft) }),
          h("span", { class: "small", attrs: { style: "color:var(--accent-text)" }, text: st.streak ? `Streak ${st.streak} day${st.streak === 1 ? "" : "s"}` : "Start a streak today" })),
        ring)),
    h("section", { class: "group", attrs: { style: "padding:16px;display:flex;flex-direction:column;gap:10px" } },
      h("div", { class: "kv" }, h("b", { text: "Reviews per day" }), h("span", { class: "muted small", text: "Last 14 days" })),
      h("div", { class: "bars", attrs: { role: "img", "aria-label": `Reviews per day, last 14 days: ${st.daily.join(", ")}` } },
        ...st.daily.map((n, i) => h("div", { class: i === st.daily.length - 1 ? "today" : "", attrs: { style: `height:${Math.round((n / max) * 100)}%` } }))),
      h("div", { class: "bar-axis" }, h("span", { text: firstLabel }), h("span", { text: `Today · ${st.today}` }))),
    h("div", { class: "tiles" },
      tile(st.counts.known, "Known"), tile(st.counts.learning, "Learning"), tile(st.counts.fresh, "New")),
    sectionLabel("Weak cards"),
    st.weak.length
      ? group(
          ...st.weak.slice(0, 5).map((w) => row({ title: w.card.term ?? `Scenario · ${w.card.source}`, value: `${w.again} × Again` })),
          h("div", { class: "row static", attrs: { style: "display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px" } },
            button("Review 10", async () => { await startSession(weakItemIds(st.weak, snap.states), "weak", "Weak cards"); go("review"); }, "btn primary"),
            aiButton("New sentences", "weak", async () => {
              if (!weakTerms.length) { toast("No weak term cards."); return; }
              set(weakBox, spinnerLine("Asking Gemini…"));
              const r = await runAi(weakSentencesRequest(weakTerms.map((c) => c.term!), snap.settings["ai.maxOutputTokens.weak"]));
              if (!r.ok) { set(weakBox, aiError(r)); return; }
              const items = parseWeakSentences(r.value, weakTerms.map((c) => c.term!));
              if (!items.length) { set(weakBox, h("p", { class: "error", text: "No usable sentences came back." })); return; }
              set(weakBox, ...items.map((it) => {
                const card = weakTerms.find((c) => c.term === it.term)!;
                const box = h("section", { class: "ai-card" }, h("b", { text: it.term }), h("p", { text: it.sentence }));
                add(box, h("div", { class: "row-btns" },
                  button("Keep", async () => { await addExtraUsage(card, it.sentence, "ai-sentence"); set(box, h("p", { class: "ok", text: `Added to “${it.term}”.` })); }, "btn small primary"),
                  button("Skip", () => box.remove(), "btn small")));
                return box;
              }));
            }, "btn ai")))
      : group(row({ title: "No weak cards", subtitle: "Cards rated Again show up here" })),
    weakBox,
  );
};

function tile(n: number, label: string) {
  return h("div", { class: "tile" }, h("strong", { text: String(n) }), h("span", { text: label }));
}
