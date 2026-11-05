// Gemini adapter over the Interactions REST API (architecture §5, spike S6).
// Request shape from https://aistudio.google.com/docs/text-generation and /docs/structured-output
// (checked 2026-11-05). Response: `steps[].content[].text`, usage in `usage.total_*_tokens`.

import type { AiProvider, AiRequest, AiResult } from "./provider";

export const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";

/**
 * Browser-safe headers only. The CORS preflight on generativelanguage.googleapis.com allows
 * `content-type` and `x-goog-api-key`, but rejects `Api-Revision` with 403 (checked 2026-11-05),
 * so that header must never be sent from the app.
 */
export const CORS_ALLOWED_HEADERS = ["content-type", "x-goog-api-key"] as const;

export function geminiHeaders(key: string): Record<string, string> {
  return { "Content-Type": "application/json", "x-goog-api-key": key };
}

export function buildGeminiBody(req: AiRequest, model: string): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    store: false, // P9: no server-side conversation state
    system_instruction: req.instructions,
    input: req.input,
    generation_config: { max_output_tokens: req.maxOutputTokens },
  };
  if (req.schema) body.response_format = { type: "text", mime_type: "application/json", schema: req.schema };
  return body;
}

interface InteractionResponse {
  status?: string;
  steps?: { type?: string; content?: { type?: string; text?: string }[] }[];
  usage?: { total_input_tokens?: number; total_output_tokens?: number; total_thought_tokens?: number };
  errors?: { code?: string; message?: string }[];
  error?: { message?: string; status?: string };
}

/** Joins the text blocks of the last model output step. */
export function extractText(res: InteractionResponse): string | null {
  const steps = res.steps ?? [];
  for (let i = steps.length - 1; i >= 0; i--) {
    const texts = (steps[i]!.content ?? []).filter((c) => c.type === "text" && typeof c.text === "string").map((c) => c.text!);
    if (texts.length) return texts.join("");
  }
  return null;
}

export function makeGemini(model: string, fetchImpl: typeof fetch = fetch): AiProvider {
  return {
    id: "gemini",
    async generate(req: AiRequest, key: string, signal: AbortSignal): Promise<AiResult<string>> {
      let resp: Response;
      try {
        resp = await fetchImpl(GEMINI_ENDPOINT, {
          method: "POST",
          headers: geminiHeaders(key),
          body: JSON.stringify(buildGeminiBody(req, model)),
          signal,
        });
      } catch (e) {
        if ((e as Error).name === "AbortError") return { ok: false, error: "timeout" };
        return { ok: false, error: "http", detail: "network or CORS error" };
      }
      let json: InteractionResponse;
      try {
        json = (await resp.json()) as InteractionResponse;
      } catch {
        return { ok: false, error: "invalid-reply", status: resp.status };
      }
      if (resp.status === 429) return { ok: false, error: "quota", status: 429 };
      if (!resp.ok) return { ok: false, error: "http", status: resp.status, detail: `HTTP ${resp.status}` };
      const text = extractText(json);
      if (json.status === "failed") return { ok: false, error: "invalid-reply", status: resp.status, detail: `status ${json.status}` };
      if (text === null || !text.trim()) {
        const t = json.usage?.total_thought_tokens;
        return { ok: false, error: "invalid-reply", status: resp.status, detail: `empty answer${t ? `; ${t} thinking tokens used` : ""}` };
      }
      return {
        ok: true,
        value: text,
        inputTokens: json.usage?.total_input_tokens ?? 0,
        outputTokens: json.usage?.total_output_tokens ?? 0,
        ...(json.usage?.total_thought_tokens ? { thoughtTokens: json.usage.total_thought_tokens } : {}),
      };
    },
  };
}
