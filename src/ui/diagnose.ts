// Settings → "Run drafting test": the exact Inbox draft request for the sample word "grab",
// showing what Gemini returned and how Parley read it. No personal data is sent; the key stays on the phone.

import { runAi } from "../ai/client";
import { DRAFT_INSTRUCTIONS } from "../ai/features";
import { buildPrompt, previewReply } from "../general/prompt";
import type { InboxEntry } from "../model/types";
import { loadSettings } from "../store/settings";
import { aiError } from "./ai";
import { h, set, spinnerLine } from "./dom";

export async function runDraftingTest(box: HTMLElement): Promise<void> {
  const s = await loadSettings();
  const entry: InboxEntry = { inboxId: "test", word: "grab", slug: "grab", addedAt: "", status: "waiting" };
  set(box, spinnerLine("Running the drafting test…"));
  const t0 = performance.now();
  const r = await runAi({
    feature: "draft",
    instructions: DRAFT_INSTRUCTIONS,
    input: buildPrompt(s["general.promptTemplate"], [entry]),
    maxOutputTokens: s["ai.maxOutputTokens.draft"],
  });
  const ms = Math.round(performance.now() - t0);
  if (!r.ok) { set(box, aiError(r), h("p", { class: "muted small", text: `Failed after ${ms} ms.` })); return; }
  const p = previewReply(r.value, [entry], s["privacy.blockedWords"]);
  const codes = p.issues.map((i) => i.code).join(", ") || "none";
  set(box,
    h("p", { class: p.matched.length ? "ok" : "error", text: p.matched.length ? "Parley read the card correctly." : "Parley could not read a card from this answer." }),
    h("p", { class: "small", text: `Answered in ${ms} ms · tokens in ${r.inputTokens}, out ${r.outputTokens}${r.thoughtTokens ? `, thinking ${r.thoughtTokens}` : ""} · issues: ${codes}` }),
    h("details", { class: "group row" },
      h("summary", {}, h("b", { text: "What Gemini returned" })),
      h("p", { class: "small", dir: "auto", text: r.value.slice(0, 1500) })));
}
