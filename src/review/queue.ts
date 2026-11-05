// Daily queue (requirements §5 and §6). Pure.

import { itemIdOf, type Card, type Deck, type Mode } from "../model/types";
import type { ItemState } from "../schedule/scheduler";

export interface QueueSettings {
  modes: Record<Deck, Mode[]>;
  newPerDay: Record<Deck, number>;
  reviewsPerDay: number;
  rolloverHour: number;
}

export type DeckChoice = Deck | "both";

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

export function modesFor(card: Card, deckModes: Mode[]): Mode[] {
  if (card.kind === "scenario") {
    if (card.modes && !card.modes.includes("roleplay")) return [];
    // General-section scenarios are saved by the user from AI-F, so they always use role-play.
    return card.deck === "general" || deckModes.includes("roleplay") ? ["roleplay"] : [];
  }
  const enabled = card.modes ?? deckModes;
  return enabled.filter((m) => m !== "roleplay" && (m !== "cloze" || card.clozeOk !== false));
}

export function buildQueue(
  cards: readonly Card[],
  states: ReadonlyMap<string, ItemState>,
  s: QueueSettings,
  deck: DeckChoice,
  now: Date,
  source?: string,
): { items: QueueItem[]; counts: DayCounts } {
  const start = dayStart(now, s.rolloverHour).getTime();
  const nowMs = now.getTime();
  const decks: Deck[] = deck === "both" ? ["bim", "general"] : [deck];

  let doneToday = 0;
  const newTodayByDeck: Record<Deck, number> = { bim: 0, general: 0 };
  const cardDeck = new Map(cards.map((c) => [c.id, c.deck]));
  for (const st of states.values()) {
    for (const r of st.reviews) if (Date.parse(r.reviewedAt) >= start) doneToday++;
    const first = st.reviews[0];
    const d = cardDeck.get(st.cardId);
    if (first && d && Date.parse(first.reviewedAt) >= start) newTodayByDeck[d]++;
  }

  // Which sources have at least two reviewed term cards (scenario unlock).
  const reviewedTermsBySource = new Map<string, number>();
  for (const c of cards) {
    if (c.kind !== "term") continue;
    const any = ["cloze", "produce", "recognise"].some((m) => states.has(itemIdOf(c.id, m as Mode)));
    if (any) reviewedTermsBySource.set(c.source, (reviewedTermsBySource.get(c.source) ?? 0) + 1);
  }

  const due: QueueItem[] = [];
  const fresh: Record<Deck, QueueItem[]> = { bim: [], general: [] };
  const sorted = [...cards].sort((a, b) => a.createdDate.localeCompare(b.createdDate) || a.id.localeCompare(b.id));
  for (const c of sorted) {
    if (c.archived || !decks.includes(c.deck)) continue;
    if (source && c.source !== source && !c.otherSources.includes(source)) continue;
    for (const mode of modesFor(c, s.modes[c.deck])) {
      const itemId = itemIdOf(c.id, mode);
      const st = states.get(itemId);
      if (st) {
        const dueMs = st.fsrs.due.getTime();
        if (dueMs <= nowMs) due.push({ itemId, cardId: c.id, mode, isNew: false, due: dueMs });
        continue;
      }
      if (!unlocked(c, mode, states, start, reviewedTermsBySource)) continue;
      fresh[c.deck].push({ itemId, cardId: c.id, mode, isNew: true, due: nowMs });
    }
  }
  due.sort((a, b) => a.due - b.due || a.itemId.localeCompare(b.itemId));
  const reviewRoom = Math.max(0, s.reviewsPerDay - doneToday);
  const items = due.slice(0, reviewRoom);
  let newAvailable = 0;
  for (const d of decks) {
    const room = Math.max(0, s.newPerDay[d] - newTodayByDeck[d]);
    const take = fresh[d].slice(0, room);
    newAvailable += take.length;
    items.push(...take);
  }
  return {
    items,
    counts: { due: Math.min(due.length, reviewRoom), newAvailable, doneToday, newToday: newTodayByDeck.bim + newTodayByDeck.general },
  };
}

function unlocked(card: Card, mode: Mode, states: ReadonlyMap<string, ItemState>, dayStartMs: number, reviewedBySource: Map<string, number>): boolean {
  if (card.kind === "scenario") return card.origin !== "vault" || (reviewedBySource.get(card.source) ?? 0) >= 2;
  if (mode !== "produce" || card.clozeOk === false) return true;
  // produce unlocks the day after the first successful cloze review.
  const cloze = states.get(itemIdOf(card.id, "cloze"));
  return !!cloze?.reviews.some((r) => (r.rating ?? 0) >= 3 && Date.parse(r.reviewedAt) < dayStartMs);
}

export const PRESET_SIZE = { quick: 10, normal: 25, full: Number.POSITIVE_INFINITY } as const;
export type Preset = keyof typeof PRESET_SIZE;

/** Session order: reviews first, then new items, capped at the preset size. */
export function sessionItems(items: QueueItem[], preset: Preset): QueueItem[] {
  return items.slice(0, PRESET_SIZE[preset]);
}
