// Feature templates and reply validators for AI-A to AI-D (data-model §6.5).

import { findCloze } from "../parser/text";
import type { AiRequest } from "./provider";

export const DRAFT_INSTRUCTIONS =
  "Follow the user's output rules exactly. Output only card lines in the requested format.";

export function feedbackRequest(p: { context: string; otherLine: string; model: string; answer: string }, maxOutputTokens: number): AiRequest {
  return {
    feature: "feedback",
    instructions: [
      "You are a strict but kind coach for spoken British English in BIM coordination meetings.",
      "Compare my answer with the model answer. My answer does not need to match the model;",
      "judge whether it would work in a real meeting.",
      "Reply as JSON only, matching the schema. Notes in Persian, corrected English in British English,",
      "technical terms in English. Keep every field short.",
    ].join(" "),
    input: [
      `Context (Persian): ${p.context}`,
      `Other speaker said: "${p.otherLine}"`,
      `Model answer: "${p.model}"`,
      `My answer: "${p.answer}"`,
    ].join("\n"),
    maxOutputTokens,
    schema: FEEDBACK_SCHEMA,
  };
}

export const FEEDBACK_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["good", "ok", "needs-work"] },
    worked: { type: "string", description: "Persian, max 25 words" },
    fix: { type: "string", description: "Persian, the single most important problem, max 30 words" },
    better: { type: "string", description: "One improved English version of MY answer, max 40 words" },
  },
  required: ["verdict", "worked", "fix", "better"],
  additionalProperties: false,
} as const;

export interface Feedback {
  verdict: "good" | "ok" | "needs-work";
  worked: string;
  fix: string;
  better: string;
}

const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/** Validates the parsed reply; the schema alone is not trusted. Length limits × 2 are a hard cap. */
export function parseFeedback(text: string): Feedback | null {
  let x: unknown;
  try {
    x = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return null;
  }
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const keys = Object.keys(o).sort().join(",");
  if (keys !== "better,fix,verdict,worked") return null;
  if (o.verdict !== "good" && o.verdict !== "ok" && o.verdict !== "needs-work") return null;
  for (const [k, max] of [["worked", 50], ["fix", 60], ["better", 80]] as const) {
    const v = o[k];
    if (typeof v !== "string" || !v.trim() || wordCount(v) > max) return null;
  }
  return { verdict: o.verdict, worked: (o.worked as string).trim(), fix: (o.fix as string).trim(), better: (o.better as string).trim() };
}

export function sentenceRequest(p: { term: string; meaning: string; usage: string }, maxOutputTokens: number): AiRequest {
  return {
    feature: "sentence",
    instructions:
      "Write one new British English sentence of 8 to 20 words, from a different work or meeting situation than the example, " +
      "containing the term exactly as written. Output only the sentence, on one line, with no quotes.",
    input: `Term: ${p.term}\nMeaning (Persian): ${p.meaning}\nExample: ${p.usage}`,
    maxOutputTokens,
  };
}

export function parseSentence(text: string, term: string): string | null {
  const s = text.trim().replace(/^["“]|["”]$/g, "").trim();
  if (!s || s.includes("\n") || s.length > 200) return null;
  return findCloze(term, s) ? s : null;
}

export function explainRequest(p: { term: string; meaning: string; usage: string }, maxOutputTokens: number): AiRequest {
  return {
    feature: "explain",
    instructions:
      "Answer in Persian, at most 120 words, plain text without Markdown: when to use the term, two common collocations " +
      "with short English examples, and one similar word with the difference. Keep technical terms and examples in English.",
    input: `Term: ${p.term}\nMeaning (Persian): ${p.meaning}\nExample: ${p.usage}`,
    maxOutputTokens,
  };
}

export function parseExplain(text: string): string | null {
  const s = text.trim();
  return s && s.length <= 2000 ? s : null;
}
