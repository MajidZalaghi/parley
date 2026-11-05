// Provider interface and pre-request guards (data-model §6.4, requirements §8 and §11).

import { findBlockedWords } from "../parser/text";

export type AiFeature = "draft" | "feedback" | "sentence" | "explain" | "interview" | "scenario" | "speak" | "weak";
export const ALL_AI_FEATURES: readonly AiFeature[] = ["draft", "feedback", "sentence", "explain", "interview", "scenario", "speak", "weak"];

export type AiError = "no-key" | "offline" | "blocked-word" | "http" | "quota" | "invalid-reply" | "timeout" | "not-confirmed" | "cap";

export type AiResult<T> =
  | { ok: true; value: T; inputTokens: number; outputTokens: number }
  | { ok: false; error: AiError; status?: number; detail?: string };

export interface AiRequest {
  feature: AiFeature;
  instructions: string;
  input: string;
  maxOutputTokens: number;
  /** JSON Schema; when set, the provider asks for JSON output. */
  schema?: object;
}

export interface AiProvider {
  id: "gemini";
  /** Returns the raw text reply (JSON text when `schema` is set). */
  generate(req: AiRequest, key: string, signal: AbortSignal): Promise<AiResult<string>>;
}

export interface GuardContext {
  key: string | null;
  online: boolean;
  paidTierConfirmed: boolean;
  blockedWords: readonly string[];
  requestsThisMonth: number;
  monthlyCap: number;
  enabledFeatures: readonly AiFeature[];
}

/** Checks done before anything is sent. Returns null when the request may go out. */
export function guard(req: AiRequest, ctx: GuardContext): { error: AiError; detail?: string } | null {
  if (!ctx.enabledFeatures.includes(req.feature)) return { error: "not-confirmed", detail: "Feature is turned off in Settings." };
  if (!ctx.key) return { error: "no-key" };
  if (!ctx.paidTierConfirmed) return { error: "not-confirmed", detail: "Confirm in Settings that billing is enabled (paid tier)." };
  if (!ctx.online) return { error: "offline" };
  if (ctx.requestsThisMonth >= ctx.monthlyCap) return { error: "cap", detail: `Monthly cap of ${ctx.monthlyCap} requests reached.` };
  const hits = findBlockedWords(req.input, ctx.blockedWords);
  if (hits.length) return { error: "blocked-word", detail: hits.join(", ") };
  return null;
}

export function errorMessage(e: AiError, detail?: string): string {
  switch (e) {
    case "no-key": return "No Gemini key set. Add it in Settings, or use Copy prompt.";
    case "offline": return "You are offline. Try again later, or use Copy prompt.";
    case "blocked-word": return `Not sent: contains a blocked word (${detail ?? ""}).`;
    case "http": return `Gemini returned an error${detail ? `: ${detail}` : ""}.`;
    case "quota": return "Gemini quota or rate limit reached. Try later.";
    case "invalid-reply": return "Gemini's reply could not be read.";
    case "timeout": return "Gemini did not answer in 20 seconds.";
    case "cap": return detail ?? "Monthly request cap reached.";
    case "not-confirmed": return detail ?? "AI is not enabled.";
  }
}
