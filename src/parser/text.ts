// Text helpers: normalisation, slugs, cloze matching, blocked words (data-model §5.3, §5.4, §5.6).

/** NFC, trim, collapse runs of spaces and tabs. Keeps ZWNJ (U+200C) used in Persian. */
export function normalizeText(s: string): string {
  return s.normalize("NFC").replace(/[ \t]+/g, " ").trim();
}

/** Record ID rule from the Master Prompt contract. Returns "" when nothing usable remains. */
export function slugify(term: string): string {
  return term
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function splitLines(text: string): string[] {
  return text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface ClozeMatch {
  start: number;
  end: number;
  matched: string;
}

/**
 * First case-insensitive whole-word match of the term in the sentence, allowing the
 * endings s, es, ed and ing (data-model §5.6, W-03).
 */
export function findCloze(term: string, sentence: string): ClozeMatch | null {
  const parts = term.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  const words = parts.map(escapeRegExp).join("\\s+");
  // "federate" -> "federated", "federating": a final "e" may take "d" or be dropped before "ing".
  const last = parts[parts.length - 1]!;
  const alts = [`${words}(?:s|es|d|ed|ing)?`];
  if (/e$/i.test(last) && last.length > 2) {
    alts.push([...parts.slice(0, -1), last.slice(0, -1)].map(escapeRegExp).join("\\s+") + "ing");
  }
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${alts.join("|")})(?![\\p{L}\\p{N}])`, "iu");
  const m = re.exec(sentence);
  if (!m) return null;
  return { start: m.index, end: m.index + m[0].length, matched: m[0] };
}

/** Returns the blocked words that occur in the text (case-insensitive, whole word or phrase). */
export function findBlockedWords(text: string, blocked: readonly string[]): string[] {
  const hits: string[] = [];
  for (const raw of blocked) {
    const w = raw.trim();
    if (!w) continue;
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(w)}(?![\\p{L}\\p{N}])`, "iu");
    if (re.test(text)) hits.push(w);
  }
  return hits;
}
