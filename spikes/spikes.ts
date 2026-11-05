// iOS spikes S1, S2, S3, S5, S6 (architecture §7.2). S4 (SW update) is tested with the main app.
// Results are shown on screen and can be copied as text for docs/spike-results.md.
// No card text, prompts or keys are included in the copied results.

import { openDB } from "idb";
import { buildGeminiBody, extractText, GEMINI_ENDPOINT, geminiHeaders } from "../src/ai/gemini";
import { FEEDBACK_SCHEMA, parseFeedback } from "../src/ai/features";
import { copyText, englishVoices, isStandalone, saveFile, speak } from "../src/platform/platform";

const root = document.getElementById("spikes")!;
const results: string[] = [];
const log = (spike: string, msg: string) => {
  const line = `${new Date().toISOString()} [${spike}] ${msg}`;
  results.push(line);
  out.textContent = results.join("\n");
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = "", attrs: Record<string, string> = {}): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text) e.textContent = text;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}
function btn(label: string, fn: () => unknown) {
  const b = el("button", label);
  b.style.cssText = "font:inherit;padding:10px 14px;margin:4px;border-radius:10px;min-height:44px";
  b.addEventListener("click", () => void fn());
  return b;
}
function section(title: string, ...children: Node[]) {
  const s = el("section");
  s.style.cssText = "border:1px solid #ccc;border-radius:12px;padding:12px;margin:12px 0";
  s.append(el("h2", title), ...children);
  root.append(s);
}

root.style.cssText = "font:16px/1.5 -apple-system,system-ui,sans-serif;max-width:640px;margin:0 auto;padding:16px";
root.append(el("h1", "Parley spikes"), el("p", `Standalone: ${isStandalone() ? "yes" : "no"} · UA: ${navigator.userAgent}`));
const out = el("pre");
out.style.cssText = "white-space:pre-wrap;font-size:12px;background:#f3f3f3;padding:8px;border-radius:8px";

// ---------- S1: storage ----------
const dbp = openDB("parley-spike", 1, { upgrade: (d) => { d.createObjectStore("kv"); d.createObjectStore("bulk", { autoIncrement: true }); } });

section("S1 · Storage persistence and eviction",
  btn("Request persist + record status", async () => {
    const before = await navigator.storage?.persisted?.();
    const granted = await navigator.storage?.persist?.();
    const est = await navigator.storage?.estimate?.();
    log("S1", `persisted before=${before} persist()=${granted} usage=${est?.usage} quota=${est?.quota}`);
  }),
  btn("Write sentinel + 9-month dummy data", async () => {
    const d = await dbp;
    const existing = await d.get("kv", "sentinel");
    if (existing) { log("S1", `sentinel already present from ${existing}`); return; }
    await d.put("kv", new Date().toISOString(), "sentinel");
    const tx = d.transaction("bulk", "readwrite");
    for (let i = 0; i < 1000; i++) void tx.store.add({ kind: "card", i, text: "x".repeat(200) });
    for (let i = 0; i < 20000; i++) void tx.store.add({ kind: "log", i, at: new Date().toISOString(), rating: 3 });
    await tx.done;
    log("S1", `wrote sentinel, 1000 cards, 20000 logs; count=${await d.count("bulk")}`);
  }),
  btn("Check sentinel", async () => {
    const d = await dbp;
    const s = await d.get("kv", "sentinel");
    const days = s ? ((Date.now() - Date.parse(s as string)) / 86_400_000).toFixed(1) : "-";
    log("S1", s ? `sentinel OK, written ${s} (${days} days ago), bulk=${await d.count("bulk")}` : "sentinel MISSING");
  }),
);

// ---------- S2: backup file ----------
const fileIn = el("input", "", { type: "file", accept: ".json,application/json" });
fileIn.addEventListener("change", async () => {
  const f = fileIn.files?.[0];
  if (!f) return;
  const text = await f.text();
  const expected = sessionStorage.getItem("s2-hash");
  log("S2", `re-imported ${f.name} size=${text.length} hash=${await hash(text)} expected=${expected ?? "(unknown in this session)"}`);
});
async function hash(t: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}
section("S2 · Backup export and import",
  btn("Export 2 MB test file", async () => {
    const text = JSON.stringify({ test: "parley-spike", pad: "y".repeat(2_000_000) });
    sessionStorage.setItem("s2-hash", await hash(text));
    const r = await saveFile(`parley-spike-${Date.now()}.json`, text);
    log("S2", `export result=${r} canShare=${"canShare" in navigator}`);
  }),
  el("p", "Then re-import the saved file:"),
  fileIn,
);

// ---------- S3: speech ----------
section("S3 · Speech synthesis",
  btn("List voices", () => {
    const now = englishVoices().map((v) => `${v.name}/${v.lang}${v.localService ? "/local" : ""}`);
    log("S3", `voices now: ${now.length} ${now.join(", ")}`);
    speechSynthesis.onvoiceschanged = () => log("S3", `voiceschanged: ${englishVoices().length} English voices`);
  }),
  btn("Speak test term", () => {
    const ok = speak("The model is not fit for purpose yet.", null);
    log("S3", `speak called: ${ok ? "voice found" : "NO voice"} online=${navigator.onLine}`);
  }),
);

// ---------- S5: files and clipboard ----------
const mdIn = el("input", "", { type: "file", multiple: "", accept: ".md,text/markdown,text/plain" });
mdIn.addEventListener("change", async () => {
  const files = Array.from(mdIn.files ?? []);
  for (const f of files) {
    const t = await f.text();
    log("S5", `read ${f.name} type="${f.type}" chars=${t.length} hasSection=${t.includes("## English in Action")}`);
  }
});
const pasteBack = el("textarea", "", { rows: "4", placeholder: "Paste the AI reply here" });
pasteBack.style.width = "100%";
section("S5 · Note files and clipboard",
  el("p", "Pick .md notes from iCloud Drive and, if available, the Google Drive location:"),
  mdIn,
  btn("Copy 2 KB prompt", async () => {
    const ok = await copyText("Reply with: - `push back` | Meaning: مخالفت | Usage: \"They may push back.\"\n" + "pad ".repeat(480));
    log("S5", `clipboard.writeText ok=${ok}`);
  }),
  pasteBack,
  btn("Check pasted reply", () => log("S5", `pasted chars=${pasteBack.value.length} hasTermLine=${/^- `/m.test(pasteBack.value)}`)),
);

// ---------- S6: Gemini direct call ----------
const keyIn = el("input", "", { type: "password", placeholder: "Test Gemini key (kept only in this page's memory)", autocomplete: "off" });
keyIn.style.width = "100%";
async function callGemini(json: boolean) {
  const key = keyIn.value.trim();
  if (!key) { log("S6", "no key entered"); return; }
  const req = json
    ? { feature: "feedback" as const, instructions: "Reply as JSON only, matching the schema. Notes in Persian.", input: 'Model answer: "Please update the export mapping."\nMy answer: "Update mapping please."', maxOutputTokens: 300, schema: FEEDBACK_SCHEMA }
    : { feature: "explain" as const, instructions: "Reply with one short sentence.", input: "Say hello.", maxOutputTokens: 50 };
  const t0 = performance.now();
  try {
    const resp = await fetch(GEMINI_ENDPOINT, {
      method: "POST",
      headers: geminiHeaders(key),
      body: JSON.stringify(buildGeminiBody(req, "gemini-3.1-flash-lite")),
    });
    const ms = Math.round(performance.now() - t0);
    const body = await resp.json().catch(() => null);
    const text = body ? extractText(body) : null;
    const usage = body?.usage ? `in=${body.usage.total_input_tokens} out=${body.usage.total_output_tokens}` : "no usage";
    const extra = json ? ` schemaValid=${text ? parseFeedback(text) !== null : false}` : "";
    log("S6", `${json ? "json" : "text"} status=${resp.status} ${ms}ms textReturned=${text !== null} ${usage}${extra}${!resp.ok ? ` error=${JSON.stringify(body?.error ?? body?.errors ?? null).slice(0, 200)}` : ""}`);
  } catch (e) {
    log("S6", `fetch failed after ${Math.round(performance.now() - t0)}ms: ${(e as Error).name}: ${(e as Error).message} (CORS or network)`);
  }
}
section("S6 · Direct Gemini call",
  keyIn,
  btn("Text request", () => callGemini(false)),
  btn("JSON (schema) request", () => callGemini(true)),
  el("p", "Check the network panel on PC: the key must be only in the x-goog-api-key header."),
);

section("Results", btn("Copy results", async () => { const ok = await copyText(results.join("\n")); log("-", `results copied=${ok}`); }), out);
