// Practice tab (approved mockup: Practice): Gemini coach and focus sessions (F-2, F-3, F-5).

import { liveReviews } from "../schedule/scheduler";
import { queueFor, snapshot, startSession, type Snapshot } from "../app/service";
import { categoryOf, itemIdOf } from "../model/types";
import { modesFor } from "../review/queue";
import { computeStats, weakItemIds } from "../review/stats";
import type { Go, Screen } from "./app";
import { add, button, group, h, largeHeader, navBar, row, sectionLabel, sheet, toast } from "./dom";

export const practiceScreen: Screen = async (root, go) => {
  const snap = await snapshot();
  const stats = computeStats(snap.cards, snap.states, liveReviews(snap.logs), new Date(), snap.settings["day.rolloverHour"]);
  add(root,
    largeHeader("Practice"),
    sectionLabel("Gemini coach"),
    group(
      row({ icon: "mic", color: "violet", title: "Mock interview", subtitle: "Senior BIM Coordinator questions", href: "#/interview" }),
      row({ icon: "chat", color: "orange", title: "New meeting scenario", subtitle: "Built from terms you know", href: "#/scenario" }),
      row({ icon: "pen", color: "teal", title: "Speak freely", subtitle: "Say two sentences, get them corrected", href: "#/speak" }),
    ),
    sectionLabel("Focus"),
    group(
      row({ icon: "warn", color: "red", title: "Weak cards", value: String(stats.weak.length), onClick: () => void startWeak(snap, stats, go) }),
      row({ icon: "cards", color: "green", title: "Study a category", subtitle: "Due and new cards of one category", onClick: () => pickCategory(snap, go) }),
      row({ icon: "note", color: "blue", title: "Study by note", subtitle: "Only the cards of one note", href: "#/notes" }),
      row({ icon: "loop", color: "grey", title: "Free practice", subtitle: "Does not change your schedule", onClick: () => void startFree(snap, go) }),
    ),
  );
};

async function startWeak(snap: Snapshot, stats: ReturnType<typeof computeStats>, go: Go) {
  const ids = weakItemIds(stats.weak, snap.states, 10);
  if (!ids.length) { toast("No weak cards yet. Cards appear here after an Again rating."); return; }
  await startSession(ids, "weak", "Weak cards");
  go("review");
}

/** Free practice: up to 10 items with history (or any items when there is none), shuffled; nothing is logged. */
async function startFree(snap: Snapshot, go: Go) {
  const s = snap.settings;
  const all: string[] = [];
  for (const c of snap.cards) {
    if (c.archived) continue;
    for (const m of modesFor(c, s["review.modes"])) all.push(itemIdOf(c.id, m));
  }
  const seen = all.filter((id) => snap.states.has(id));
  const pool = seen.length >= 5 ? seen : all;
  if (!pool.length) { toast("No cards yet."); return; }
  const ids = pool.map((id) => ({ id, r: Math.random() })).sort((a, b) => a.r - b.r).slice(0, 10).map((x) => x.id);
  await startSession(ids, "free", "Free");
  go("review");
}

// ---------- Study by note (F-3) ----------

export const notesScreen: Screen = async (root, go) => {
  const snap = await snapshot();
  const sources = new Map<string, number>();
  for (const c of snap.cards) if (!c.archived && c.deck === "bim") sources.set(c.source, (sources.get(c.source) ?? 0) + 1);
  const rows = [...sources.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([src, n]) => {
    const { items } = queueFor(snap, { source: src });
    return row({
      icon: "note", color: "blue", title: src, subtitle: `${n} cards · ${items.length} to study now`,
      onClick: async () => {
        if (!items.length) { toast("Nothing due or new in this note right now. Try Free practice."); return; }
        await startSession(items.map((i) => i.itemId), "note", src);
        go("review");
      },
    });
  });
  add(root, navBar("Practice", "#/practice", "By note"), rows.length ? group(...rows) : h("p", { class: "muted", text: "No BIM notes imported yet." }));
};

// ---------- Study a category ----------

function pickCategory(snap: Snapshot, go: Go) {
  const cats = snap.settings["categories"];
  const close = sheet(
    h("h2", { class: "title", text: "Study a category" }),
    group(...cats.map((c) => {
      const { items } = queueFor(snap, { category: c });
      const total = snap.cards.filter((x) => !x.archived && categoryOf(x) === c).length;
      return row({
        title: c, subtitle: `${total} cards`, value: items.length ? `${items.length} now` : "–",
        onClick: async () => {
          if (!items.length) { toast(`Nothing due or new in ${c} right now.`); return; }
          close();
          await startSession(items.map((i) => i.itemId), "normal", c);
          go("review");
        },
      });
    })),
    button("Close", () => close(), "btn big"));
}
