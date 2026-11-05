// Runs one AI request: guards, timeout, usage counting (data-model §6.4). Never logs text or the key.

import { addAiUsage, getAiUsage, getApiKey } from "../store/db";
import { loadSettings } from "../store/settings";
import { makeGemini } from "./gemini";
import { guard, type AiRequest, type AiResult } from "./provider";

const TIMEOUT_MS = 20_000;

export const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);

export async function runAi(req: AiRequest): Promise<AiResult<string>> {
  const s = await loadSettings();
  const key = await getApiKey();
  const usage = await getAiUsage(monthKey());
  const blocked = guard(req, {
    key,
    online: navigator.onLine,
    paidTierConfirmed: s["ai.paidTierConfirmed"],
    blockedWords: s["privacy.blockedWords"],
    requestsThisMonth: usage.requests,
    monthlyCap: s["ai.monthlyRequestCap"],
    enabledFeatures: s["ai.features"],
  });
  if (blocked) return { ok: false, ...blocked };

  const provider = makeGemini(s["ai.model"]);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await provider.generate(req, key!, ctrl.signal);
    if (r.ok) await addAiUsage(monthKey(), r.inputTokens, r.outputTokens);
    return r;
  } finally {
    clearTimeout(timer);
  }
}
