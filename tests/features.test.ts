import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  interviewFeedbackRequest, interviewQuestionRequest, parseInterviewFeedback, parseJsonExact, parseQuestion,
  parseScenario, parseSpeak, parseWeakSentences, scenarioRequest, YOU_SPEAKER,
} from "../src/ai/coach";
import { guard } from "../src/ai/provider";
import { diffImport } from "../src/bim/importDiff";
import type { Card, ReviewLogEntry } from "../src/model/types";
import { parseNote } from "../src/parser/parse";
import { buildQueue } from "../src/review/queue";
import { computeStats, weakItemIds } from "../src/review/stats";
import { DEFAULT_FSRS, intervalLabel, liveReviews, previewDue, replay } from "../src/schedule/scheduler";

const ifc = readFileSync(new URL("./fixtures/ifc-note.md", import.meta.url), "utf8");
const cardsP = diffImport([parseNote(ifc, { source: "IFC", mode: "file", today: "2026-11-05" })], [], "file", "2026-11-05T10:00:00.000Z").then((r) => r.upserts);
let seq = 0;
const log = (itemId: string, rating: 1 | 3, at: string): ReviewLogEntry => ({ entryId: `i:${++seq}`, installId: "i", itemId, type: "review", rating, reviewedAt: at, appVersion: "t", fsrsParamsId: "p" });

describe("interval preview", () => {
  it("Again is sooner than Good, and labels read naturally", () => {
    const now = new Date("2026-11-05T12:00:00Z");
    const d = previewDue(null, now, DEFAULT_FSRS);
    expect(d[1].getTime()).toBeLessThan(d[3].getTime());
    expect(intervalLabel(now, new Date(now.getTime() + 10 * 60_000))).toBe("10 min");
    expect(intervalLabel(now, new Date(now.getTime() + 3 * 86_400_000))).toBe("3 d");
  });
});

describe("progress stats (F-1, F-2)", () => {
  it("counts daily reviews, streak, weak cards and days left", async () => {
    const cards = await cardsP;
    const now = new Date("2026-11-05T12:00:00");
    const logs = [
      log("model-drop::cloze", 1, new Date("2026-11-04T12:00:00").toISOString()),
      log("model-drop::cloze", 3, new Date("2026-11-05T09:00:00").toISOString()),
      log("schema-version::cloze", 3, new Date("2026-11-05T09:05:00").toISOString()),
    ];
    const states = replay(logs, [], DEFAULT_FSRS);
    const st = computeStats(cards, states, liveReviews(logs), now, 4);
    expect(st.today).toBe(2);
    expect(st.daily.at(-2)).toBe(1);
    expect(st.streak).toBe(2);
    expect(st.retention).toBeCloseTo(2 / 3);
    expect(st.weak.map((w) => w.card.id)).toEqual(["model-drop"]);
    expect(weakItemIds(st.weak, states)).toEqual(["model-drop::cloze"]);
    expect(st.counts.fresh).toBe(4); // 6 cards, 2 reviewed
    expect(st.daysLeft).toBe(272);
  });
});

describe("study by note and AI scenarios in the queue", () => {
  const settings = { modes: ["flashcard", "reverse", "roleplay"] as ("flashcard" | "reverse" | "roleplay")[], newPerDay: 8, reviewsPerDay: 80, rolloverHour: 4 };
  it("filters by source note", async () => {
    const cards = await cardsP;
    const other: Card = { ...cards[0]!, id: "other-term", source: "Other note" };
    const q = buildQueue([...cards, other], new Map(), settings, { source: "Other note" }, new Date("2026-11-05T12:00:00"));
    expect(q.items.map((i) => i.cardId)).toEqual(["other-term"]);
  });
  it("a saved AI scenario in General is reviewable right away", async () => {
    const sc: Card = { id: "gen:scenario:abc", deck: "general", kind: "scenario", origin: "ai-draft", context: "c", turns: [], source: "AI scenario", otherSources: [], createdDate: "2026-11-05", contentHash: "h", updatedAt: "", baseHash: null, archived: false, extraUsages: [] };
    const q = buildQueue([sc], new Map(), settings, {}, new Date("2026-11-05T12:00:00"));
    expect(q.items.map((i) => i.itemId)).toEqual(["gen:scenario:abc::roleplay"]);
  });
});

describe("coach reply validators (AI-E to AI-H)", () => {
  it("strict JSON keys", () => {
    expect(parseJsonExact('{"a":1}', ["a"])).toEqual({ a: 1 });
    expect(parseJsonExact('{"a":1,"b":2}', ["a"])).toBeNull();
    expect(parseJsonExact("[1]", ["a"])).toBeNull();
  });
  it("interview question and feedback", () => {
    expect(parseQuestion('{"question":"How do you run a clash meeting?"}')).toBe("How do you run a clash meeting?");
    expect(parseQuestion('{"question":""}')).toBeNull();
    const ok = '{"verdict":"ok","content":"ساختار خوب","language":"زمان فعل","better":"I agreed an export mapping table with the MEP lead."}';
    expect(parseInterviewFeedback(ok)?.verdict).toBe("ok");
    expect(parseInterviewFeedback(ok.replace('"ok"', '"great"'))).toBeNull();
    expect(interviewQuestionRequest("iso19650", ["Q1"], 600).input).toContain("Q1");
    expect(interviewFeedbackRequest({ topic: "bep", question: "q", answer: "a" }, 600).schema).toBeTruthy();
  });
  it("scenario: needs two You turns and the terms", () => {
    const terms = ["export mapping", "model drop"];
    const good = JSON.stringify({ context: "جلسه", turns: [
      { speaker: "MEP Engineer", text: "The model drop is late." },
      { speaker: "You", text: "Please share the export mapping first." },
      { speaker: "MEP Engineer", text: "Fine." },
      { speaker: "You (Senior BIM Coordinator)", text: "Then we review it at the next model drop." },
    ] });
    const sc = parseScenario(good, terms)!;
    expect(sc.turns.filter((t) => t.isYou).every((t) => t.speaker === YOU_SPEAKER)).toBe(true);
    expect(sc.usedTerms).toEqual(terms);
    const oneYou = JSON.stringify({ context: "c", turns: [{ speaker: "A", text: "model drop" }, { speaker: "You", text: "export mapping" }, { speaker: "A", text: "ok" }] });
    expect(parseScenario(oneYou, terms)).toBeNull();
    expect(scenarioRequest(terms, 900).input).toContain("export mapping");
  });
  it("speak and weak sentences", () => {
    expect(parseSpeak('{"corrected":"I reviewed the model today.","note":"زمان گذشته"}')?.corrected).toBe("I reviewed the model today.");
    const items = parseWeakSentences(JSON.stringify({ items: [
      { term: "Schema Version", sentence: "Please confirm the schema version before the delivery." },
      { term: "model drop", sentence: "This sentence misses it." },
      { term: "unknown", sentence: "unknown appears here" },
    ] }), ["schema version", "model drop"]);
    expect(items).toEqual([{ term: "schema version", sentence: "Please confirm the schema version before the delivery." }]);
  });
  it("coach requests are guarded by blocked words like every AI call", () => {
    const req = interviewFeedbackRequest({ topic: "you", question: "q", answer: "At AcmeCorp I led coordination" }, 600);
    const res = guard(req, { key: "k", online: true, paidTierConfirmed: true, blockedWords: ["AcmeCorp"], requestsThisMonth: 0, monthlyCap: 500, enabledFeatures: ["interview"] });
    expect(res?.error).toBe("blocked-word");
  });
});
