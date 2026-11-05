// Entities from data-model §2 to §9.

import type { ScenarioTurn } from "../parser/types";

export type Deck = "bim" | "general";
export type CardKind = "term" | "scenario";
export type Origin = "vault" | "ai-draft" | "user";
export type Mode = "cloze" | "produce" | "recognise" | "roleplay";
export const ALL_MODES: readonly Mode[] = ["cloze", "produce", "recognise", "roleplay"];

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
