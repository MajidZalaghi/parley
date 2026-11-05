// General English prompt template and reply matching (data-model §6.2, §6.3).

import { parseAiReply } from "../parser/parse";
import type { Issue, ParsedTerm } from "../parser/types";
import type { InboxEntry } from "../model/types";

export const DEFAULT_PROMPT_TEMPLATE = `I am a BIM Coordinator learning professional British English. Make one
spaced-repetition card for each word or phrase below.

Output rules:
- Write exactly one line per word, in the same order, and nothing else:
  no heading, no numbering, no explanation, no code block.
- Use exactly this format:
  - \`term\` | Meaning: <short Persian explanation> | Usage: "<one sentence>"
- term: copy the word exactly as I wrote it, inside backticks.
- Meaning: natural, fluent Persian, at most 15 words. Keep technical terms
  in English. If the word has several senses, use the sense in "seen in";
  otherwise use the most common sense at work.
- Usage: one natural British English sentence, 8 to 20 words, that a
  professional could say in a meeting or at work. It must contain the term
  exactly as written.
- Do not use real company, client, project or person names.

Words:
{{words}}`;

export const MAX_BATCH = 20;

export function buildPrompt(template: string, entries: readonly InboxEntry[]): string {
  const list = entries
    .slice(0, MAX_BATCH)
    .map((e, i) => `${i + 1}. ${e.word}${e.seenIn ? ` (seen in: "${e.seenIn.replace(/"/g, "'")}")` : ""}`)
    .join("\n");
  return template.includes("{{words}}") ? template.replace("{{words}}", list) : `${template}\n\nWords:\n${list}`;
}

export interface ReplyPreview {
  matched: { entry: InboxEntry; term: ParsedTerm }[];
  notRequested: ParsedTerm[];
  missing: InboxEntry[];
  issues: Issue[];
}

export function previewReply(reply: string, waiting: readonly InboxEntry[], blockedWords: readonly string[]): ReplyPreview {
  const { terms, issues } = parseAiReply(reply, blockedWords);
  const bySlug = new Map(waiting.map((e) => [e.slug, e]));
  const matched: ReplyPreview["matched"] = [];
  const notRequested: ParsedTerm[] = [];
  for (const t of terms) {
    const e = bySlug.get(t.id);
    if (e) { matched.push({ entry: e, term: t }); bySlug.delete(t.id); }
    else notRequested.push(t);
  }
  return { matched, notRequested, missing: [...bySlug.values()], issues };
}
