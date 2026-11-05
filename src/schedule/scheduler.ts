// FSRS wrapper and deterministic log replay (data-model §4.1, D-05, D-12).

import { createEmptyCard, fsrs, generatorParameters, type Card as FsrsCard, type Grade, type FSRS } from "ts-fsrs";
import { sha256Hex } from "../model/hash";
import { splitItemId, itemIdOf, type AliasEntry, type Mode, type ReviewLogEntry } from "../model/types";

export interface FsrsSettings {
  requestRetention: number;
  maximumInterval: number;
  enableFuzz: boolean;
  enableShortTerm: boolean;
  weights: number[] | null;
}

export const DEFAULT_FSRS: FsrsSettings = {
  requestRetention: 0.9,
  maximumInterval: 180,
  enableFuzz: false,
  enableShortTerm: true,
  weights: null,
};

export function makeScheduler(s: FsrsSettings): FSRS {
  return fsrs(
    generatorParameters({
      request_retention: s.requestRetention,
      maximum_interval: s.maximumInterval,
      enable_fuzz: s.enableFuzz,
      enable_short_term: s.enableShortTerm,
      ...(s.weights ? { w: s.weights } : {}),
    }),
  );
}

export function fsrsParamsId(s: FsrsSettings): Promise<string> {
  return sha256Hex(JSON.stringify(s)).then((h) => h.slice(0, 12));
}

/** Follows non-retracted aliases to the current card ID. Cycles are refused when aliases are created. */
export function makeCanonical(aliases: readonly AliasEntry[]): (id: string) => string {
  const next = new Map<string, string>();
  for (const a of aliases) if (!a.retracted) next.set(a.fromId, a.toId);
  return (id: string) => {
    const seen = new Set<string>();
    let cur = id;
    while (next.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      cur = next.get(cur)!;
    }
    return cur;
  };
}

/** True if adding from → to would create a cycle. */
export function wouldCycle(aliases: readonly AliasEntry[], fromId: string, toId: string): boolean {
  const canonical = makeCanonical(aliases);
  return canonical(toId) === fromId || fromId === toId;
}

export interface ItemState {
  itemId: string;
  cardId: string;
  mode: Mode;
  fsrs: FsrsCard;
  reviews: ReviewLogEntry[]; // live reviews in replay order
}

/** Live review entries: reviews not cancelled by an undo entry. */
export function liveReviews(logs: readonly ReviewLogEntry[]): ReviewLogEntry[] {
  const cancelled = new Set(logs.filter((l) => l.type === "undo" && l.undoes).map((l) => l.undoes!));
  return logs.filter((l) => l.type === "review" && l.rating && !cancelled.has(l.entryId));
}

const order = (a: ReviewLogEntry, b: ReviewLogEntry) =>
  a.reviewedAt < b.reviewedAt ? -1 : a.reviewedAt > b.reviewedAt ? 1 : a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0;

/** Rebuilds every item that has history. Items without history are new and use createEmptyCard. */
export function replay(logs: readonly ReviewLogEntry[], aliases: readonly AliasEntry[], settings: FsrsSettings): Map<string, ItemState> {
  const scheduler = makeScheduler(settings);
  const canonical = makeCanonical(aliases);
  const groups = new Map<string, ReviewLogEntry[]>();
  for (const e of liveReviews(logs)) {
    const { cardId, mode } = splitItemId(e.itemId);
    const key = itemIdOf(canonical(cardId), mode);
    const list = groups.get(key) ?? [];
    list.push(e);
    groups.set(key, list);
  }
  const out = new Map<string, ItemState>();
  for (const [itemId, list] of groups) {
    list.sort(order);
    let card = createEmptyCard(new Date(list[0]!.reviewedAt));
    for (const e of list) card = scheduler.next(card, new Date(e.reviewedAt), e.rating as Grade).card;
    const { cardId, mode } = splitItemId(itemId);
    out.set(itemId, { itemId, cardId, mode, fsrs: card, reviews: list });
  }
  return out;
}

/** Applies one new rating to an existing state (used live; replay gives the same result). */
export function applyRating(state: FsrsCard | null, at: Date, rating: Grade, settings: FsrsSettings): FsrsCard {
  const scheduler = makeScheduler(settings);
  return scheduler.next(state ?? createEmptyCard(at), at, rating).card;
}
