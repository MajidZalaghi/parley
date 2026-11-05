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

/** Placeholder words in phrases ("take something on board") that stand for 1 to 3 real words. */
const PLACEHOLDERS = new Set(["something", "someone", "somebody", "sth", "smth", "sb", "sb's", "someone's", "somebody's", "one's", "something's"]);
// Lazy, so a placeholder at the end of a phrase takes as few words as possible.
const ANY_WORDS = "[\\p{L}\\p{N}'’-]+(?:\\s+[\\p{L}\\p{N}'’-]+){0,2}?";

/** One real word with optional endings: s, es, d, ed, ing; a final "e" may be dropped before ing/ed. */
function wordRe(w: string): string {
  const e = escapeRegExp(w);
  if (/e$/i.test(w) && w.length > 2) return `(?:${e}(?:s|d)?|${escapeRegExp(w.slice(0, -1))}(?:ing|ed))`;
  return `${e}(?:s|es|d|ed|ing)?`;
}

/**
 * First case-insensitive whole-word match of the term in the sentence (data-model §5.6, W-03).
 * Every word may take the endings above, and placeholder words such as "something" or "sb"
 * match one to three words, so "take something on board" finds "take your comments on board".
 */
export function findCloze(term: string, sentence: string): ClozeMatch | null {
  const parts = term.trim().replace(/[()]/g, " ").split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  const body = parts.map((p) => (PLACEHOLDERS.has(p.toLowerCase()) ? ANY_WORDS : wordRe(p))).join("\\s+");
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${body})(?![\\p{L}\\p{N}])`, "iu");
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
