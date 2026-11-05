// Progress statistics (requirements F-1, F-2). Pure.

import { State } from "ts-fsrs";
import { itemIdOf, type Card, type Mode, type ReviewLogEntry } from "../model/types";
import type { ItemState } from "../schedule/scheduler";
import { dayStart } from "./queue";

export const TARGET_DATE = "2027-08-04";

export interface Stats {
  daily: number[];         // reviews per study day, oldest first, last entry = today
  dailyStart: Date;        // first day shown
  today: number;
  retention: number | null; // share of Good/Easy/Hard in the last 30 days (0..1)
  streak: number;          // consecutive study days with at least one review, ending today or yesterday
  counts: { known: number; learning: number; fresh: number };
  weak: { card: Card; lapses: number; again: number }[];
  daysLeft: number;
}

const DAY = 86_400_000;
const MODES: Mode[] = ["cloze", "produce", "recognise", "roleplay"];

export function computeStats(
  cards: readonly Card[],
  states: ReadonlyMap<string, ItemState>,
  reviews: readonly ReviewLogEntry[], // live reviews only
  now: Date,
  rolloverHour: number,
  days = 14,
): Stats {
  const todayStart = dayStart(now, rolloverHour).getTime();
  const firstStart = todayStart - (days - 1) * DAY;
  const daily = new Array<number>(days).fill(0);
  const activeDays = new Set<number>();
  let good = 0;
  let total30 = 0;
  for (const r of reviews) {
    const t = Date.parse(r.reviewedAt);
    const dayIdx = Math.floor((t - firstStart) / DAY);
    if (dayIdx >= 0 && dayIdx < days) daily[dayIdx]!++;
    activeDays.add(Math.floor((t - todayStart) / DAY));
    if (t >= todayStart - 29 * DAY) {
      total30++;
      if ((r.rating ?? 0) >= 2) good++;
    }
  }
  let streak = 0;
  let d = activeDays.has(0) ? 0 : -1;
  while (activeDays.has(d)) { streak++; d--; }

  const counts = { known: 0, learning: 0, fresh: 0 };
  const weak: Stats["weak"] = [];
  for (const c of cards) {
    if (c.archived) continue;
    const items = MODES.map((m) => states.get(itemIdOf(c.id, m))).filter((x): x is ItemState => !!x);
    if (!items.length) { counts.fresh++; continue; }
    const known = items.every((i) => i.fsrs.state === State.Review && i.fsrs.stability >= 7);
    if (known) counts.known++; else counts.learning++;
    const lapses = items.reduce((n, i) => n + i.fsrs.lapses, 0);
    const again = items.reduce((n, i) => n + i.reviews.filter((r) => r.rating === 1).length, 0);
    if (again > 0) weak.push({ card: c, lapses, again });
  }
  weak.sort((a, b) => b.again - a.again || b.lapses - a.lapses || a.card.id.localeCompare(b.card.id));

  const target = new Date(`${TARGET_DATE}T00:00:00`);
  const daysLeft = Math.max(0, Math.ceil((target.getTime() - todayStart) / DAY));
  return {
    daily, dailyStart: new Date(firstStart), today: daily[days - 1] ?? 0,
    retention: total30 ? good / total30 : null, streak, counts, weak: weak.slice(0, 10), daysLeft,
  };
}

/** Item IDs for a weak-cards session: every enabled, existing item of the weakest cards. */
export function weakItemIds(weak: Stats["weak"], states: ReadonlyMap<string, ItemState>, limit = 10): string[] {
  const ids: string[] = [];
  for (const w of weak) {
    for (const m of MODES) {
      const id = itemIdOf(w.card.id, m);
      if (states.has(id)) ids.push(id);
      if (ids.length >= limit) return ids;
    }
  }
  return ids;
}
