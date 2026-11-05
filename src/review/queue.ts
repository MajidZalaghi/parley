// Daily queue (requirements §5, §6 and revision 5: categories, flashcard/reverse). Pure.

import { categoryOf, itemIdOf, TERM_MODES, type Card, type Mode } from "../model/types";
import type { ItemState } from "../schedule/scheduler";

export interface QueueSettings {
  modes: Mode[];
  newPerDay: number;
  reviewsPerDay: number;
  rolloverHour: number;
}

/** Optional filters: one category ("All" or undefined = every category) and/or one source note. */
export interface QueueFilter {
  category?: string;
  source?: string;
}

export interface QueueItem {
  itemId: string;
  cardId: string;
  mode: Mode;
  isNew: boolean;
  due: number; // ms
}

export interface DayCounts {
  due: number;
  newAvailable: number;
  doneToday: number;
  newToday: number;
}

/** Start of the study day in local time; the day rolls over at `rolloverHour`. */
export function dayStart(now: Date, rolloverHour: number): Date {
  const d = new Date(now);
  d.setHours(rolloverHour, 0, 0, 0);
  if (d.getTime() > now.getTime()) d.setDate(d.getDate() - 1);
  return d;
}

/** Modes that apply to a card, given the enabled modes. */
export function modesFor(card: Card, enabled: readonly Mode[]): Mode[] {
  if (card.kind === "scenario") {
    if (card.modes && !card.modes.includes("roleplay")) return [];
    return card.origin !== "vault" || enabled.includes("roleplay") ? ["roleplay"] : [];
  }
  const want = card.modes ?? enabled;
  return want.filter((m) => {
    if (!TERM_MODES.includes(m)) return false;
    if (m === "cloze") return card.clozeOk !== false && !!card.usage;
    if (m === "reverse") return !!(card.definition || card.meaning);
    if (m === "produce" || m === "recognise") return !!card.meaning;
    return true; // flashcard
  });
}

export function matchesFilter(c: Card, f: QueueFilter): boolean {
  if (f.category && f.category !== "All" && categoryOf(c) !== f.category) return false;
  if (f.source && c.source !== f.source && !c.otherSources.includes(f.source)) return false;
  return true;
}

export function buildQueue(
  cards: readonly Card[],
  states: ReadonlyMap<string, ItemState>,
  s: QueueSettings,
  filter: QueueFilter,
  now: Date,
): { items: QueueItem[]; counts: DayCounts } {
  const start = dayStart(now, s.rolloverHour).getTime();
  const nowMs = now.getTime();

  // Today's totals count every category, so the daily limits stay daily limits.
  let doneToday = 0;
  let newToday = 0;
  for (const st of states.values()) {
    for (const r of st.reviews) if (Date.parse(r.reviewedAt) >= start) doneToday++;
    const first = st.reviews[0];
    if (first && Date.parse(first.reviewedAt) >= start) newToday++;
  }

  // Sources with at least two reviewed term cards (vault scenario unlock).
  const reviewedTermsBySource = new Map<string, number>();
  for (const c of cards) {
    if (c.kind !== "term") continue;
    if (TERM_MODES.some((m) => states.has(itemIdOf(c.id, m)))) reviewedTermsBySource.set(c.source, (reviewedTermsBySource.get(c.source) ?? 0) + 1);
  }

  const due: QueueItem[] = [];
  const fresh: QueueItem[] = [];
  const sorted = [...cards].sort((a, b) => a.createdDate.localeCompare(b.createdDate) || a.id.localeCompare(b.id));
  for (const c of sorted) {
    if (c.archived || !matchesFilter(c, filter)) continue;
    for (const mode of modesFor(c, s.modes)) {
      const itemId = itemIdOf(c.id, mode);
      const st = states.get(itemId);
      if (st) {
        const dueMs = st.fsrs.due.getTime();
        if (dueMs <= nowMs) due.push({ itemId, cardId: c.id, mode, isNew: false, due: dueMs });
        continue;
      }
      if (!unlocked(c, mode, states, start, reviewedTermsBySource, s.modes)) continue;
      fresh.push({ itemId, cardId: c.id, mode, isNew: true, due: nowMs });
    }
  }
  due.sort((a, b) => a.due - b.due || a.itemId.localeCompare(b.itemId));
  const reviewRoom = Math.max(0, s.reviewsPerDay - doneToday);
  const items = due.slice(0, reviewRoom);
  const newTake = fresh.slice(0, Math.max(0, s.newPerDay - newToday));
  items.push(...newTake);
  return { items, counts: { due: Math.min(due.length, reviewRoom), newAvailable: newTake.length, doneToday, newToday } };
}

const goodBefore = (st: ItemState | undefined, dayStartMs: number) =>
  !!st?.reviews.some((r) => (r.rating ?? 0) >= 3 && Date.parse(r.reviewedAt) < dayStartMs);

function unlocked(card: Card, mode: Mode, states: ReadonlyMap<string, ItemState>, dayStartMs: number, reviewedBySource: Map<string, number>, enabled: readonly Mode[]): boolean {
  if (card.kind === "scenario") return card.origin !== "vault" || (reviewedBySource.get(card.source) ?? 0) >= 2;
  // reverse unlocks the day after the first Good on the flashcard (when flashcards are on).
  if (mode === "reverse" && enabled.includes("flashcard")) return goodBefore(states.get(itemIdOf(card.id, "flashcard")), dayStartMs);
  // produce unlocks the day after the first Good cloze (when cloze is on and possible).
  if (mode === "produce" && enabled.includes("cloze") && card.clozeOk !== false) return goodBefore(states.get(itemIdOf(card.id, "cloze")), dayStartMs);
  return true;
}

export const PRESET_SIZE = { quick: 10, normal: 25, full: Number.POSITIVE_INFINITY } as const;
export type Preset = keyof typeof PRESET_SIZE;

/** Session order: reviews first, then new items, capped at the preset size. */
export function sessionItems(items: QueueItem[], preset: Preset): QueueItem[] {
  return items.slice(0, PRESET_SIZE[preset]);
}

/** Cards that belong to the Due, New and Done tiles (for the Today drill-down). */
export function tileItems(
  cards: readonly Card[], states: ReadonlyMap<string, ItemState>, s: QueueSettings, filter: QueueFilter, now: Date,
): { due: QueueItem[]; fresh: QueueItem[]; done: { itemId: string; cardId: string; mode: Mode; rating: number }[] } {
  const { items } = buildQueue(cards, states, s, filter, now);
  const start = dayStart(now, s.rolloverHour).getTime();
  const byId = new Map(cards.map((c) => [c.id, c]));
  const done: { itemId: string; cardId: string; mode: Mode; rating: number }[] = [];
  for (const st of states.values()) {
    const c = byId.get(st.cardId);
    if (!c || !matchesFilter(c, filter)) continue;
    const last = [...st.reviews].reverse().find((r) => Date.parse(r.reviewedAt) >= start);
    if (last) done.push({ itemId: st.itemId, cardId: st.cardId, mode: st.mode, rating: last.rating ?? 0 });
  }
  return { due: items.filter((i) => !i.isNew), fresh: items.filter((i) => i.isNew), done };
}
