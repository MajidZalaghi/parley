// Entities from data-model §2 to §9.

import type { ScenarioTurn } from "../parser/types";

export type Deck = "bim" | "general";
export type CardKind = "term" | "scenario";
export type Origin = "vault" | "ai-draft" | "user";
/**
 * flashcard: front = term (+ category), back = definition, IPA, example, Persian on demand (Anki-style).
 * reverse:   front = definition (or Persian meaning), back = term. Unlocks after the first Good flashcard.
 * cloze, produce, recognise: earlier modes, optional. roleplay: scenarios.
 */
export type Mode = "flashcard" | "reverse" | "cloze" | "produce" | "recognise" | "roleplay";
export const ALL_MODES: readonly Mode[] = ["flashcard", "reverse", "cloze", "produce", "recognise", "roleplay"];
export const TERM_MODES: readonly Mode[] = ["flashcard", "reverse", "cloze", "produce", "recognise"];

export const DEFAULT_CATEGORIES = ["BIM", "Project Controls", "Contracts", "Structural", "MEP", "Architecture", "General"] as const;

/** A card whose items were forgotten this many times is a leech (Anki's default threshold). */
export const LEECH_LAPSES = 8;

export interface ExtraUsage {
  text: string;
  kind: "ai-sentence" | "ai-tip";
  addedAt: string;
}

export interface Card {
  id: string;
  deck: Deck;
  kind: CardKind;
  origin: Origin;
  term?: string;
  meaning?: string;
  usage?: string;
  clozeOk?: boolean;
  context?: string;
  turns?: ScenarioTurn[];
  source: string;
  otherSources: string[];
  createdDate: string;
  contentHash: string;
  updatedAt: string;
  baseHash: string | null;
  archived: boolean;
  modes?: Mode[];
  extraUsages: ExtraUsage[];
  /** User-facing grouping (Settings → Categories). Absent on old cards: see categoryOf(). */
  category?: string;
  /** Simple English definition (back of the flashcard). Not part of the content hash. */
  definition?: string;
  /** British IPA, e.g. "/ɡræb/". Not part of the content hash. */
  ipa?: string;
}

export function categoryOf(c: Pick<Card, "category" | "deck">): string {
  return c.category ?? (c.deck === "bim" ? "BIM" : "General");
}

export type Rating = 1 | 2 | 3 | 4;

export interface ReviewLogEntry {
  entryId: string;
  installId: string;
  itemId: string;
  type: "review" | "undo";
  rating?: Rating;
  reviewedAt: string;
  durationMs?: number;
  undoes?: string;
  appVersion: string;
  fsrsParamsId: string;
}

export interface AliasEntry {
  fromId: string;
  toId: string;
  createdAt: string;
  retracted: boolean;
}

export interface InboxEntry {
  inboxId: string;
  word: string;
  slug: string;
  seenIn?: string;
  category?: string;
  addedAt: string;
  status: "waiting" | "rejected";
}

export interface SettingRecord {
  key: string;
  value: unknown;
  updatedAt: string;
}

export const itemIdOf = (cardId: string, mode: Mode) => `${cardId}::${mode}`;

export function splitItemId(itemId: string): { cardId: string; mode: Mode } {
  const i = itemId.lastIndexOf("::");
  return { cardId: itemId.slice(0, i), mode: itemId.slice(i + 2) as Mode };
}
