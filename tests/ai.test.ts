import { describe, expect, it } from "vitest";
import { feedbackRequest, parseFeedback, parseSentence } from "../src/ai/features";
import { buildGeminiBody, extractText, makeGemini } from "../src/ai/gemini";
import { guard, type GuardContext } from "../src/ai/provider";
import { buildPrompt, DEFAULT_PROMPT_TEMPLATE, previewReply } from "../src/general/prompt";
import type { InboxEntry } from "../src/model/types";

const ctx: GuardContext = {
  key: "test-key", online: true, paidTierConfirmed: true, blockedWords: ["AcmeCorp"],
  requestsThisMonth: 0, monthlyCap: 500, enabledFeatures: ["draft", "feedback", "sentence", "explain"],
};
const fb = feedbackRequest({ context: "c", otherLine: "So what do you need?", model: "Please update the mapping.", answer: "Update mapping please." }, 400);

describe("guards (AC-24, AC-26)", () => {
  it("allows a clean request", () => expect(guard(fb, ctx)).toBeNull());
  it("blocks without key, offline, unconfirmed tier, cap or blocked word", () => {
    expect(guard(fb, { ...ctx, key: null })?.error).toBe("no-key");
    expect(guard(fb, { ...ctx, online: false })?.error).toBe("offline");
    expect(guard(fb, { ...ctx, paidTierConfirmed: false })?.error).toBe("not-confirmed");
    expect(guard(fb, { ...ctx, requestsThisMonth: 500 })?.error).toBe("cap");
    const bad = feedbackRequest({ context: "c", otherLine: "x", model: "y", answer: "send it to acmecorp" }, 400);
    expect(guard(bad, ctx)?.error).toBe("blocked-word");
  });
});

describe("Gemini request (AC-28)", () => {
  it("sends only the intended fields, store false, key in header", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fakeFetch = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({
        status: "completed",
        steps: [{ type: "model_output", content: [{ type: "text", text: '{"verdict":"ok","worked":"خوب","fix":"کوتاه","better":"Please update the export mapping."}' }] }],
        usage: { total_input_tokens: 120, total_output_tokens: 40 },
      }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await makeGemini("gemini-3.1-flash-lite", fakeFetch).generate(fb, "secret-123", new AbortController().signal);
    expect(r.ok).toBe(true);
    const s = seen!;
    expect(s.url).not.toContain("secret-123");
    expect((s.init.headers as Record<string, string>)["x-goog-api-key"]).toBe("secret-123");
    const body = JSON.parse(String(s.init.body));
    expect(Object.keys(body).sort()).toEqual(["generation_config", "input", "model", "response_format", "store", "system_instruction"]);
    expect(body.store).toBe(false);
    expect(String(s.init.body)).not.toContain("secret-123");
    if (r.ok) expect(parseFeedback(r.value)?.verdict).toBe("ok");
  });

  it("maps 429 to quota and network failure to http", async () => {
    const f429 = (async () => new Response("{}", { status: 429 })) as unknown as typeof fetch;
    expect((await makeGemini("m", f429).generate(fb, "k", new AbortController().signal)).ok).toBe(false);
    const fNet = (async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch;
    const r = await makeGemini("m", fNet).generate(fb, "k", new AbortController().signal);
    expect(r.ok === false && r.error).toBe("http");
  });

  it("extracts the last text step", () => {
    expect(extractText({ steps: [{ content: [{ type: "text", text: "a" }] }, { content: [{ type: "text", text: "b" }, { type: "text", text: "c" }] }] })).toBe("bc");
    expect(buildGeminiBody({ feature: "explain", instructions: "i", input: "x", maxOutputTokens: 9 }, "m")).not.toHaveProperty("response_format");
  });
});

describe("reply validators (AC-25)", () => {
  it("rejects malformed feedback", () => {
    expect(parseFeedback("not json")).toBeNull();
    expect(parseFeedback('{"verdict":"great","worked":"a","fix":"b","better":"c"}')).toBeNull();
    expect(parseFeedback('{"verdict":"ok","worked":"a","fix":"b"}')).toBeNull();
    expect(parseFeedback('{"verdict":"ok","worked":"a","fix":"b","better":"c","extra":1}')).toBeNull();
  });
  it("accepts a fenced JSON reply", () => {
    expect(parseFeedback('```json\n{"verdict":"good","worked":"a","fix":"b","better":"c"}\n```')?.verdict).toBe("good");
  });
  it("accepts a new sentence only if it contains the term", () => {
    expect(parseSentence('"We missed the model drop last week."', "model drop")).toBe("We missed the model drop last week.");
    expect(parseSentence("Something else entirely.", "model drop")).toBeNull();
  });
});

describe("General English prompt and preview (AC-08, AC-09)", () => {
  const entry = (word: string, slug: string): InboxEntry => ({ inboxId: slug, word, slug, addedAt: "2026-11-05T00:00:00.000Z", status: "waiting" });
  const waiting = [entry("push back", "push-back"), entry("follow up", "follow-up"), entry("touch base", "touch-base")];

  it("builds the prompt with exactly the waiting words", () => {
    const p = buildPrompt(DEFAULT_PROMPT_TEMPLATE, waiting);
    expect(p).toContain("1. push back\n2. follow up\n3. touch base");
    expect(p).not.toContain("{{words}}");
  });

  it("matches reply lines to waiting words", () => {
    const reply = [
      '- `push back` | Meaning: مخالفت | Usage: "They may push back on the dates."',
      '- `follow up` | Meaning: پیگیری | Usage: "I will follow up tomorrow."',
      '- `touch base` | Meaning: x',
      '- `circle back` | Meaning: برگشتن | Usage: "Let us circle back on this."',
    ].join("\n");
    const r = previewReply(reply, waiting, []);
    expect(r.matched.map((m) => m.entry.slug)).toEqual(["push-back", "follow-up"]);
    expect(r.notRequested.map((t) => t.id)).toEqual(["circle-back"]);
    expect(r.missing.map((e) => e.slug)).toEqual(["touch-base"]);
    expect(r.issues.some((i) => i.code === "E-01")).toBe(true);
  });
});
