// AI buttons are always visible (requirements §8.1). Without a key they open a setup sheet.

import type { AiFeature } from "../ai/provider";
import { errorMessage, type AiResult } from "../ai/provider";
import { getApiKey } from "../store/db";
import { enabledAiFeatures, loadSettings } from "../store/settings";
import { button, h, icon, sheet } from "./dom";

export type AiStatus = "ready" | "no-key" | "not-confirmed" | "off";

export async function aiStatus(feature?: AiFeature): Promise<AiStatus> {
  const s = await loadSettings();
  if (!(await getApiKey())) return "no-key";
  if (!s["ai.paidTierConfirmed"]) return "not-confirmed";
  if (feature && !enabledAiFeatures(s).includes(feature)) return "off";
  return "ready";
}

export function setupSheet(status: AiStatus): void {
  const text = {
    "no-key": "Add your Gemini API key in Settings. It stays only on this phone.",
    "not-confirmed": "Confirm in Settings that billing is enabled on the key's project (paid tier).",
    off: "This feature is switched off in Settings.",
    ready: "",
  }[status];
  const close = sheet(
    h("h2", { class: "title", text: "Set up Gemini" }),
    h("p", { class: "muted", text }),
    button("Open Settings", () => { close(); location.hash = "#/settings"; }, "btn primary big"),
    button("Not now", () => close(), "btn big"),
  );
}

/** A button that runs `run` only when the feature is ready; otherwise shows the setup sheet. */
export function aiButton(label: string, feature: AiFeature, run: () => void | Promise<void>, cls = "btn ai small"): HTMLButtonElement {
  const b = h("button", { class: cls, attrs: { type: "button" } }, icon("sparkle", 16), label);
  b.addEventListener("click", async () => {
    const st = await aiStatus(feature);
    if (st !== "ready") { setupSheet(st); return; }
    await run();
  });
  return b;
}

export function aiError<T>(r: AiResult<T> & { ok: false }): HTMLElement {
  return h("p", { class: "error", text: errorMessage(r.error, r.detail) });
}
