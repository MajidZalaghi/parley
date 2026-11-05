// Settings with defaults (data-model §9). Each key is stored as { key, value, updatedAt }.

import { ALL_AI_FEATURES, type AiFeature } from "../ai/provider";
import type { Deck, Mode } from "../model/types";
import type { Preset } from "../review/queue";
import { DEFAULT_PROMPT_TEMPLATE } from "../general/prompt";
import { db } from "./db";

export interface Settings {
  "fsrs.requestRetention": number;
  "fsrs.maximumInterval": number;
  "fsrs.enableFuzz": boolean;
  "fsrs.enableShortTerm": boolean;
  "fsrs.weights": number[] | null;
  "bim.modes": Mode[];
  "general.modes": Mode[];
  "bim.newPerDay": number;
  "general.newPerDay": number;
  "limits.reviewsPerDay": number;
  "rating.buttons": 2 | 4;
  "session.preset": Preset;
  "session.lastDeck": Deck | "both";
  "privacy.blockedWords": string[];
  "general.promptTemplate": string;
  "day.rolloverHour": number;
  "speech.voiceURI": string | null;
  "backup.reminderDays": number;
  "ai.provider": "gemini";
  "ai.model": string;
  /** Features switched off by the user; every other feature is on (new features start on). */
  "ai.featuresOff": AiFeature[];
  "ai.paidTierConfirmed": boolean;
  "ai.maxOutputTokens.draft": number;
  "ai.maxOutputTokens.feedback": number;
  "ai.maxOutputTokens.sentence": number;
  "ai.maxOutputTokens.explain": number;
  "ai.maxOutputTokens.interview": number;
  "ai.maxOutputTokens.scenario": number;
  "ai.maxOutputTokens.speak": number;
  "ai.maxOutputTokens.weak": number;
  "ai.monthlyRequestCap": number;
  "ai.priceInputPerM": number;
  "ai.priceOutputPerM": number;
}

export const DEFAULTS: Settings = {
  "fsrs.requestRetention": 0.9,
  "fsrs.maximumInterval": 180,
  "fsrs.enableFuzz": false,
  "fsrs.enableShortTerm": true,
  "fsrs.weights": null,
  "bim.modes": ["cloze", "produce", "roleplay"],
  "general.modes": ["cloze", "produce"],
  "bim.newPerDay": 5,
  "general.newPerDay": 3,
  "limits.reviewsPerDay": 80,
  "rating.buttons": 2,
  "session.preset": "quick",
  "session.lastDeck": "both",
  "privacy.blockedWords": [],
  "general.promptTemplate": DEFAULT_PROMPT_TEMPLATE,
  "day.rolloverHour": 4,
  "speech.voiceURI": null,
  "backup.reminderDays": 7,
  "ai.provider": "gemini",
  "ai.model": "gemini-3.1-flash-lite",
  "ai.featuresOff": [],
  "ai.paidTierConfirmed": false,
  "ai.maxOutputTokens.draft": 1500,
  "ai.maxOutputTokens.feedback": 400,
  "ai.maxOutputTokens.sentence": 100,
  "ai.maxOutputTokens.explain": 400,
  "ai.maxOutputTokens.interview": 600,
  "ai.maxOutputTokens.scenario": 900,
  "ai.maxOutputTokens.speak": 300,
  "ai.maxOutputTokens.weak": 900,
  "ai.monthlyRequestCap": 500,
  "ai.priceInputPerM": 0.25,
  "ai.priceOutputPerM": 1.5,
};

let cache: Settings | null = null;

export async function loadSettings(): Promise<Settings> {
  if (cache) return cache;
  const rows = await (await db()).getAll("settings");
  const s: Record<string, unknown> = { ...DEFAULTS };
  for (const r of rows) if (r.key in DEFAULTS) s[r.key] = r.value;
  cache = s as unknown as Settings;
  return cache;
}

export async function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void> {
  await (await db()).put("settings", { key, value, updatedAt: new Date().toISOString() });
  if (cache) cache = { ...cache, [key]: value };
}

export function invalidateSettings(): void {
  cache = null;
}

export function enabledAiFeatures(s: Settings): AiFeature[] {
  const off = new Set(s["ai.featuresOff"]);
  return ALL_AI_FEATURES.filter((f) => !off.has(f));
}
