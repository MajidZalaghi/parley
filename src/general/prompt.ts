// Universal card prompt (revision 5) and reply matching (data-model §6.2, §6.3).
// The same prompt is sent to Gemini and copied for a local model (for example Qwen) or any chat,
// so every route produces the same line format that parseCardLine reads.

import { parseAiReply } from "../parser/parse";
import type { Issue, ParsedTerm } from "../parser/types";
import type { InboxEntry } from "../model/types";

export const DEFAULT_PROMPT_TEMPLATE = `You make vocabulary flashcards for a Senior BIM Coordinator who works in English
in the Netherlands and Ireland. Make one card for each word or phrase in the list.

Write exactly one line per item, in the same order, and nothing else.
No heading, no numbering, no notes, no code block.

Each line must have exactly this format:
- \`TERM\` | Definition: DEFINITION | IPA: /IPA/ | Example: "EXAMPLE" | Meaning: MEANING

Rules:
- TERM: copy the word or phrase exactly as written in the list.
- DEFINITION: a simple English definition, at most 20 words, for the field in [brackets].
- IPA: British pronunciation in IPA between slashes.
- EXAMPLE: one natural British English sentence of 8 to 20 words that a professional
  would say at work in that field. It must contain the TERM.
- MEANING: a short, natural Persian meaning, at most 12 words. Keep technical terms in English.
- If "seen in" is given, use the sense of that sentence.
- Never use real company, client, project or person names.

Example of one correct line:
- \`grab\` | Definition: to take something quickly | IPA: /ɡræb/ | Example: "Could you grab the latest model before the meeting?" | Meaning: سریع برداشتن یا گرفتن

List:
{{words}}`;

export const MAX_BATCH = 20;

export function buildPrompt(template: string, entries: readonly InboxEntry[], fallbackCategory = "General"): string {
  const list = entries
    .slice(0, MAX_BATCH)
    .map((e, i) => `${i + 1}. ${e.word} [${e.category ?? fallbackCategory}]${e.seenIn ? ` (seen in: "${e.seenIn.replace(/"/g, "'")}")` : ""}`)
    .join("\n");
  return template.includes("{{words}}") ? template.replace("{{words}}", list) : `${template}\n\nList:\n${list}`;
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
