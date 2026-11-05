import { readFileSync } from "node:fs";
import { createEmptyCard, fsrs, generatorParameters, type Grade } from "ts-fsrs";
import { describe, expect, it } from "vitest";
import { buildBackup, planRestore, verifyBackup, type BackupData } from "../src/backup/merge";
import { diffImport } from "../src/bim/importDiff";
import type { AliasEntry, Card, ReviewLogEntry } from "../src/model/types";
import { parseNote } from "../src/parser/parse";
import { buildQueue } from "../src/review/queue";
import { DEFAULT_FSRS, liveReviews, replay, wouldCycle } from "../src/schedule/scheduler";

const ifc = readFileSync(new URL("./fixtures/ifc-note.md", import.meta.url), "utf8");
const SOURCE = "Industry Foundation Classes (IFC)";
const parsed = (text = ifc) => parseNote(text, { source: SOURCE, mode: "file", today: "2026-11-05" });

let seq = 0;
function log(itemId: string, rating: 1 | 2 | 3 | 4, at: string, install = "inst-a"): ReviewLogEntry {
  return { entryId: `${install}:${++seq}`, installId: install, itemId, type: "review", rating, reviewedAt: at, appVersion: "t", fsrsParamsId: "p" };
}

describe("replay equals ts-fsrs directly (AC-16)", () => {
  it("gives the same due dates for a fixed sequence", () => {
    const times = ["2026-11-01T08:00:00.000Z", "2026-11-01T08:10:00.000Z", "2026-11-02T09:00:00.000Z", "2026-11-06T09:00:00.000Z"];
    const ratings: Grade[] = [3, 3, 1, 3];
    const logs = times.map((t, i) => log("model-drop::cloze", ratings[i] as 1 | 3, t));
    const got = replay(logs, [], DEFAULT_FSRS).get("model-drop::cloze")!;

    const f = fsrs(generatorParameters({ request_retention: 0.9, maximum_interval: 180, enable_fuzz: false, enable_short_term: true }));
    let c = createEmptyCard(new Date(times[0]!));
    times.forEach((t, i) => { c = f.next(c, new Date(t), ratings[i]!).card; });
    expect(got.fsrs.due.toISOString()).toBe(c.due.toISOString());
    expect(got.fsrs.reps).toBe(4);
  });

  it("is independent of log order (deterministic)", () => {
    const a = log("x::cloze", 3, "2026-11-01T08:00:00.000Z");
    const b = log("x::cloze", 1, "2026-11-03T08:00:00.000Z", "inst-b");
    const r1 = replay([a, b], [], DEFAULT_FSRS).get("x::cloze")!;
    const r2 = replay([b, a], [], DEFAULT_FSRS).get("x::cloze")!;
    expect(r1.fsrs.due.toISOString()).toBe(r2.fsrs.due.toISOString());
  });

  it("undo cancels a review but keeps both entries (AC-15)", () => {
    const r = log("x::cloze", 1, "2026-11-01T08:00:00.000Z");
    const u: ReviewLogEntry = { ...r, entryId: "inst-a:999", type: "undo", rating: undefined, undoes: r.entryId };
    expect(liveReviews([r, u])).toHaveLength(0);
    expect(replay([r, u], [], DEFAULT_FSRS).size).toBe(0);
  });

  it("history follows a rename through aliases (AC-05)", () => {
    const logs = [log("model-drop::cloze", 3, "2026-11-01T08:00:00.000Z")];
    const alias: AliasEntry = { fromId: "model-drop", toId: "model-delivery", createdAt: "2026-11-02T00:00:00.000Z", retracted: false };
    const st = replay(logs, [alias], DEFAULT_FSRS);
    expect(st.has("model-delivery::cloze")).toBe(true);
    expect(st.has("model-drop::cloze")).toBe(false);
    expect(wouldCycle([alias], "model-delivery", "model-drop")).toBe(true);
  });
});

describe("BIM import diff", () => {
  it("adds, then reports unchanged on a second import (AC-03)", async () => {
    const first = await diffImport([parsed()], [], "file", "2026-11-05T10:00:00.000Z");
    expect(first.added).toHaveLength(6);
    const second = await diffImport([parsed()], first.upserts, "file", "2026-11-05T11:00:00.000Z");
    expect(second.added).toHaveLength(0);
    expect(second.changed).toHaveLength(0);
    expect(second.upserts).toHaveLength(0);
  });

  it("archives a removed term and suggests a rename", async () => {
    const first = await diffImport([parsed()], [], "file", "2026-11-05T10:00:00.000Z");
    const renamed = ifc.replace("- `model drop` | Meaning: تحویل دوره‌ای مدل در CDE | Usage: \"We will review the structural model at the next model drop on Friday.\"",
      "- `model delivery` | Meaning: تحویل دوره‌ای مدل در CDE | Usage: \"We will review the structural model at the next model delivery on Friday.\"");
    const second = await diffImport([parsed(renamed)], first.upserts, "file", "2026-11-06T10:00:00.000Z");
    expect(second.archived).toEqual(["model-drop"]);
    expect(second.added).toEqual(["model-delivery"]);
    expect(second.renames).toEqual([{ fromId: "model-drop", toId: "model-delivery", source: SOURCE }]);
  });

  it("paste never archives", async () => {
    const first = await diffImport([parsed()], [], "file", "2026-11-05T10:00:00.000Z");
    const one = parseNote('- `model drop` | Meaning: x | Usage: "next model drop"', { source: SOURCE, mode: "paste", today: "2026-11-05" });
    const r = await diffImport([one], first.upserts, "paste", "2026-11-06T10:00:00.000Z");
    expect(r.archived).toHaveLength(0);
    expect(r.changed).toEqual(["model-drop"]);
  });
});

describe("daily queue", () => {
  it("introduces cloze first, limits new cards, and unlocks produce the next day", async () => {
    const { upserts: cards } = await diffImport([parsed()], [], "file", "2026-11-05T10:00:00.000Z");
    const settings = { modes: { bim: ["cloze", "produce", "roleplay"] as const, general: ["cloze", "produce"] as const }, newPerDay: { bim: 5, general: 3 }, reviewsPerDay: 80, rolloverHour: 4 };
    const s = { ...settings, modes: { bim: [...settings.modes.bim], general: [...settings.modes.general] } };
    const day1 = buildQueue(cards, new Map(), s, "bim", new Date("2026-11-05T12:00:00"));
    expect(day1.items.map((i) => i.mode)).toEqual(["cloze", "cloze", "cloze", "cloze", "cloze"]);

    const logs = day1.items.map((i) => log(i.itemId, 3, new Date("2026-11-05T12:00:00").toISOString()));
    const st = replay(logs, [], DEFAULT_FSRS);
    const later = buildQueue(cards, st, s, "bim", new Date("2026-11-05T13:00:00"));
    expect(later.items.filter((i) => i.isNew)).toHaveLength(0); // daily new limit reached
    const day2 = buildQueue(cards, st, s, "bim", new Date("2026-11-06T12:00:00"));
    expect(day2.items.some((i) => i.mode === "produce")).toBe(true);
    expect(day2.items.some((i) => i.mode === "roleplay")).toBe(true);
  });
});

describe("backup and restore (AC-18, AC-19)", () => {
  const meta = { appVersion: "0.1.0", exportedAt: "2026-11-05T20:00:00.000Z", installId: "inst-a", seqHigh: 3 };

  it("round-trips and detects tampering", async () => {
    const { upserts: cards } = await diffImport([parsed()], [], "file", "2026-11-05T10:00:00.000Z");
    const data: BackupData = { cards, logs: [log("model-drop::cloze", 3, "2026-11-05T12:00:00.000Z")], aliases: [], inbox: [], settings: [] };
    const file = await buildBackup(data, meta);
    const ok = await verifyBackup(JSON.parse(JSON.stringify(file)));
    expect(ok.cards).toHaveLength(6);
    const bad = { ...file, cards: file.cards.slice(1) };
    await expect(verifyBackup(bad)).rejects.toThrow(/hash/);
  });

  it("restoring into an empty app adds everything; an old backup changes nothing", async () => {
    const { upserts: cards } = await diffImport([parsed()], [], "file", "2026-11-05T10:00:00.000Z");
    const logs = [log("model-drop::cloze", 3, "2026-11-05T12:00:00.000Z")];
    const file = await buildBackup({ cards, logs, aliases: [], inbox: [], settings: [] }, meta);
    const empty = planRestore({ cards: [], logs: [], aliases: [], inbox: [], settings: [] }, file);
    expect(empty.report.cardsAdded).toBe(6);
    expect(empty.report.logsAdded).toBe(1);
    expect(empty.conflicts).toHaveLength(0);

    const newer = await diffImport([parsed(ifc.replace("مناسب برای کاربرد توافق‌شده", "مناسب برای کاربرد"))], cards, "file", "2026-11-07T10:00:00.000Z");
    const localCards: Card[] = cards.map((c) => newer.upserts.find((u) => u.id === c.id) ?? c);
    const plan = planRestore({ cards: localCards, logs: [...logs, log("x::cloze", 3, "2026-11-07T12:00:00.000Z")], aliases: [], inbox: [], settings: [] }, file);
    expect(plan.cards).toHaveLength(0);
    expect(plan.logs).toHaveLength(0);
    expect(plan.conflicts).toHaveLength(0);
  });

  it("reports a content conflict when both sides changed from the same base", async () => {
    const base = (await diffImport([parsed()], [], "file", "2026-11-05T10:00:00.000Z")).upserts;
    const a = (await diffImport([parsed(ifc.replace("مناسب برای کاربرد توافق‌شده", "نسخه الف"))], base, "file", "2026-11-06T10:00:00.000Z")).upserts;
    const b = (await diffImport([parsed(ifc.replace("مناسب برای کاربرد توافق‌شده", "نسخه ب"))], base, "file", "2026-11-06T11:00:00.000Z")).upserts;
    const file = await buildBackup({ cards: b, logs: [], aliases: [], inbox: [], settings: [] }, meta);
    const localCards = base.map((c) => a.find((u) => u.id === c.id) ?? c);
    const plan = planRestore({ cards: localCards, logs: [], aliases: [], inbox: [], settings: [] }, file);
    expect(plan.conflicts.map((c) => c.kind)).toEqual(["card"]);
  });
});
