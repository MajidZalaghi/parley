// Bulk word list for the Inbox (General English): one word or phrase per line. Pure.
//
// Accepted line shapes (all optional decoration is stripped):
//   push back
//   - push back
//   1. push back
//   `push back` | I heard it in a meeting      (text after | , a tab or ; becomes "seen in")

import { findBlockedWords, normalizeText, slugify, splitLines } from "../parser/text";

export const MAX_WORD_CHARS = 80;

export interface WordInput {
  word: string;
  slug: string;
  seenIn?: string;
}

export interface SkippedLine {
  line: number;
  text: string;
  reason: string;
}

export interface WordListResult {
  entries: WordInput[];
  skipped: SkippedLine[];
}

const HEADER_WORDS = new Set(["word", "words", "term", "terms", "vocabulary", "vocab", "phrase", "phrases"]);

export function parseWordList(text: string, known: ReadonlySet<string>, blockedWords: readonly string[]): WordListResult {
  const entries: WordInput[] = [];
  const skipped: SkippedLine[] = [];
  const seen = new Set<string>();
  const lines = splitLines(text);
  lines.forEach((raw, idx) => {
    const lineNo = idx + 1;
    let line = raw.trim();
    if (!line) return;
    line = line.replace(/^(?:[-*•–]|\d+[.)])\s+/, "");
    const parts = line.split(/\t|\||;/);
    const clean = (s: string) => normalizeText(s.replace(/^[`"'“”*_\s]+|[`"'“”*_\s]+$/g, ""));
    const word = clean(parts[0] ?? "");
    const seenIn = clean(parts.slice(1).join(" "));
    if (idx === 0 && HEADER_WORDS.has(word.toLowerCase()) && parts.length <= 2) return; // CSV header
    if (!word) return;
    const slug = slugify(word);
    const skip = (reason: string) => skipped.push({ line: lineNo, text: raw.trim().slice(0, 60), reason });
    if (!slug) return skip("no letters or digits");
    if (word.length > MAX_WORD_CHARS) return skip(`longer than ${MAX_WORD_CHARS} characters (looks like a sentence)`);
    const hits = findBlockedWords(`${word} ${seenIn}`, blockedWords);
    if (hits.length) return skip(`blocked word: ${hits.join(", ")}`);
    if (known.has(slug)) return skip("already a card or in the Inbox");
    if (seen.has(slug)) return skip("repeated in this list");
    seen.add(slug);
    entries.push(seenIn ? { word, slug, seenIn } : { word, slug });
  });
  return { entries, skipped };
}
