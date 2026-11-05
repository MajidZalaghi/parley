// Coach features AI-E to AI-H (requirements §8): request builders and strict reply validators. Pure.

import { findCloze } from "../parser/text";
import type { ScenarioTurn } from "../parser/types";
import type { AiRequest } from "./provider";

const COMMON = "Notes for me are in Persian; English examples and corrections are in British English; technical terms stay in English. Reply as JSON only, matching the schema. Keep every field short. Never use real company, client, project or person names.";

/** Parses a JSON reply (optionally in a ```json fence) and checks it has exactly these keys. */
export function parseJsonExact(text: string, keys: readonly string[]): Record<string, unknown> | null {
  let x: unknown;
  try {
    x = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return null;
  }
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  if (Object.keys(o).sort().join(",") !== [...keys].sort().join(",")) return null;
  return o;
}

const str = (v: unknown, maxWords: number): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s || s.split(/\s+/).length > maxWords) return null;
  return s;
};

// ---------- AI-E: mock interview ----------

export const INTERVIEW_TOPICS = [
  { id: "coordination", label: "Coordination", brief: "clash detection, federated models, coordination meetings and issue tracking (BCF)" },
  { id: "iso19650", label: "ISO 19650", brief: "ISO 19650, the CDE, information containers, status codes and naming" },
  { id: "bep", label: "BEP & EIR", brief: "BIM Execution Plans, EIR/OIR/AIR, MIDP/TIDP and delivery planning" },
  { id: "openbim", label: "openBIM", brief: "IFC, IDS, MVDs, export mapping and model quality checks" },
  { id: "leadership", label: "Leadership", brief: "leading coordination, handling conflict with discipline leads, deadlines and stakeholders" },
  { id: "you", label: "About you", brief: "motivation for a Senior BIM Coordinator role in the Netherlands or Ireland, career story and strengths" },
] as const;
export type InterviewTopic = (typeof INTERVIEW_TOPICS)[number]["id"];

export function interviewQuestionRequest(topic: InterviewTopic, asked: readonly string[], maxOutputTokens: number): AiRequest {
  const t = INTERVIEW_TOPICS.find((x) => x.id === topic)!;
  return {
    feature: "interview",
    instructions: `You interview candidates for a Senior BIM Coordinator role at a European engineering or construction firm. Ask ONE realistic interview question about ${t.brief}. Prefer behavioural or scenario questions. Do not repeat earlier questions. ${COMMON}`,
    input: asked.length ? `Earlier questions:\n${asked.map((q) => `- ${q}`).join("\n")}` : "This is the first question.",
    maxOutputTokens,
    schema: { type: "object", properties: { question: { type: "string", description: "One question, max 40 words" } }, required: ["question"], additionalProperties: false },
  };
}

export function parseQuestion(text: string): string | null {
  const o = parseJsonExact(text, ["question"]);
  return o ? str(o.question, 60) : null;
}

export interface InterviewFeedback {
  verdict: "good" | "ok" | "needs-work";
  content: string;
  language: string;
  better: string;
}

export function interviewFeedbackRequest(p: { topic: InterviewTopic; question: string; answer: string }, maxOutputTokens: number): AiRequest {
  return {
    feature: "interview",
    instructions: `You are an experienced interviewer and English coach. Judge my spoken answer (dictated, so ignore punctuation) for a Senior BIM Coordinator interview: content (structure such as STAR, concrete result, technical accuracy) and language (natural, professional British English). Give one improved version of MY answer that keeps my facts and adds no invented facts; where a number is missing, write [number]. ${COMMON}`,
    input: `Question: ${p.question}\nMy answer: ${p.answer}`,
    maxOutputTokens,
    schema: {
      type: "object",
      properties: {
        verdict: { type: "string", enum: ["good", "ok", "needs-work"] },
        content: { type: "string", description: "Persian, about content, max 35 words" },
        language: { type: "string", description: "Persian, the main language issue, max 35 words" },
        better: { type: "string", description: "Improved English answer, max 90 words" },
      },
      required: ["verdict", "content", "language", "better"],
      additionalProperties: false,
    },
  };
}

export function parseInterviewFeedback(text: string): InterviewFeedback | null {
  const o = parseJsonExact(text, ["verdict", "content", "language", "better"]);
  if (!o || (o.verdict !== "good" && o.verdict !== "ok" && o.verdict !== "needs-work")) return null;
  const content = str(o.content, 70);
  const language = str(o.language, 70);
  const better = str(o.better, 180);
  return content && language && better ? { verdict: o.verdict, content, language, better } : null;
}

// ---------- AI-F: new meeting scenario ----------

export const YOU_SPEAKER = "You (Senior BIM Coordinator)";

export function scenarioRequest(terms: readonly string[], maxOutputTokens: number): AiRequest {
  return {
    feature: "scenario",
    instructions: `Write a short, realistic BIM coordination meeting dialogue that naturally uses each of the given terms at least once, mostly in my lines. 4 to 8 turns, alternating between one other role (for example Structural Lead, MEP Engineer, Project Manager, Architect) and me. My speaker name is exactly "${YOU_SPEAKER}". Include at least two of my turns. The context is one Persian sentence describing the situation. ${COMMON}`,
    input: `Terms: ${terms.join(", ")}`,
    maxOutputTokens,
    schema: {
      type: "object",
      properties: {
        context: { type: "string", description: "Persian, one sentence" },
        turns: {
          type: "array",
          items: {
            type: "object",
            properties: { speaker: { type: "string" }, text: { type: "string", description: "max 45 words" } },
            required: ["speaker", "text"],
            additionalProperties: false,
          },
        },
      },
      required: ["context", "turns"],
      additionalProperties: false,
    },
  };
}

export interface GeneratedScenario {
  context: string;
  turns: ScenarioTurn[];
  usedTerms: string[];
}

export function parseScenario(text: string, terms: readonly string[]): GeneratedScenario | null {
  const o = parseJsonExact(text, ["context", "turns"]);
  if (!o || !Array.isArray(o.turns)) return null;
  const context = str(o.context, 60);
  if (!context || o.turns.length < 3 || o.turns.length > 10) return null;
  const turns: ScenarioTurn[] = [];
  for (const t of o.turns) {
    if (!t || typeof t !== "object") return null;
    const r = t as Record<string, unknown>;
    const speaker = str(r.speaker, 8);
    const line = str(r.text, 70);
    if (!speaker || !line) return null;
    const isYou = speaker.startsWith("You");
    turns.push({ speaker: isYou ? YOU_SPEAKER : speaker, isYou, text: line.replace(/^["“]|["”]$/g, "") });
  }
  if (turns.filter((t) => t.isYou).length < 2 || !turns.some((t) => !t.isYou)) return null;
  const all = turns.map((t) => t.text).join(" ");
  const usedTerms = terms.filter((term) => findCloze(term, all));
  if (usedTerms.length < Math.min(2, terms.length)) return null;
  return { context, turns, usedTerms };
}

// ---------- AI-G: speak freely ----------

export interface SpeakCorrection {
  corrected: string;
  note: string;
}

export function speakRequest(text: string, maxOutputTokens: number): AiRequest {
  return {
    feature: "speak",
    instructions: `I dictated one or two sentences about my work day. Rewrite them as natural, professional British English, keeping my meaning and adding nothing. Then give one short Persian note on the most useful correction. ${COMMON}`,
    input: text,
    maxOutputTokens,
    schema: {
      type: "object",
      properties: { corrected: { type: "string", description: "max 60 words" }, note: { type: "string", description: "Persian, max 30 words" } },
      required: ["corrected", "note"],
      additionalProperties: false,
    },
  };
}

export function parseSpeak(text: string): SpeakCorrection | null {
  const o = parseJsonExact(text, ["corrected", "note"]);
  if (!o) return null;
  const corrected = str(o.corrected, 120);
  const note = str(o.note, 60);
  return corrected && note ? { corrected, note } : null;
}

// ---------- AI-H: sentences for weak cards ----------

export function weakSentencesRequest(terms: readonly string[], maxOutputTokens: number): AiRequest {
  return {
    feature: "weak",
    instructions: `For each term, write one new British English sentence of 8 to 20 words that a professional would say at work, containing the term exactly as written. Use a different situation for each. ${COMMON}`,
    input: `Terms:\n${terms.map((t) => `- ${t}`).join("\n")}`,
    maxOutputTokens,
    schema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: { type: "object", properties: { term: { type: "string" }, sentence: { type: "string" } }, required: ["term", "sentence"], additionalProperties: false },
        },
      },
      required: ["items"],
      additionalProperties: false,
    },
  };
}

/** Keeps only sentences for requested terms that contain the term; one per term. */
export function parseWeakSentences(text: string, terms: readonly string[]): { term: string; sentence: string }[] {
  const o = parseJsonExact(text, ["items"]);
  if (!o || !Array.isArray(o.items)) return [];
  const wanted = new Map(terms.map((t) => [t.toLowerCase(), t]));
  const out: { term: string; sentence: string }[] = [];
  for (const it of o.items) {
    if (!it || typeof it !== "object") continue;
    const r = it as Record<string, unknown>;
    const term = typeof r.term === "string" ? wanted.get(r.term.trim().toLowerCase()) : undefined;
    const sentence = str(r.sentence, 30);
    if (!term || !sentence || sentence.length > 220 || !findCloze(term, sentence)) continue;
    if (out.some((x) => x.term === term)) continue;
    out.push({ term, sentence: sentence.replace(/^["“]|["”]$/g, "") });
  }
  return out;
}
