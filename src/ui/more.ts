// More: Cards (General edit), Backup, Settings, Status.

import { monthKey } from "../ai/client";
import { applyRestore, archiveCard, confirmCard, editGeneral, exportBackup, markBackupDone, prepareRestore, snapshot, APP_VERSION, type Resolution } from "../app/service";
import type { Conflict } from "../backup/merge";
import type { Card, Mode } from "../model/types";
import { englishVoices, isStandalone, requestPersistence, saveFile, storageStatus } from "../platform/platform";
import { getAiUsage, getApiKey, getMeta, setApiKey } from "../store/db";
import { invalidateSettings, loadSettings, setSetting, type Settings } from "../store/settings";
import { makeGemini } from "../ai/gemini";
import type { Screen } from "./app";
import { add, set, auto, button, field, h, toast } from "./dom";

export const moreScreen: Screen = (root, go) => {
  add(root, 
    h("h1", { text: "More" }),
    h("div", { class: "list" },
      button("Cards", () => go("cards"), "btn list-item"),
      button("Backup and restore", () => go("backup"), "btn list-item"),
      button("Settings", () => go("settings"), "btn list-item"),
      button("Status", () => go("status"), "btn list-item"),
    ),
  );
};

// ---------- Cards ----------

export const cardsScreen: Screen = async (root, go) => {
  const snap = await snapshot();
  const list = h("div", { class: "list" });
  const filter = h("input", { attrs: { type: "search", placeholder: "Filter" } });
  const render = () => {
    const q = filter.value.trim().toLowerCase();
    const cards = snap.cards
      .filter((c) => !c.archived && (!q || (c.term ?? c.id).toLowerCase().includes(q)))
      .sort((a, b) => a.deck.localeCompare(b.deck) || (a.term ?? a.id).localeCompare(b.term ?? b.id));
    set(list, ...cards.map((c) => cardRow(c, () => go("cards"))));
  };
  filter.addEventListener("input", render);
  add(root, h("h1", { text: "Cards" }), filter, list);
  render();
};

function cardRow(c: Card, refresh: () => void): HTMLElement {
  const row = h("details", { class: "card-row" },
    h("summary", {},
      h("span", { text: c.kind === "scenario" ? `Scenario · ${c.source}` : (c.term ?? c.id) }),
      h("small", { class: "muted", text: ` ${c.deck === "bim" ? "BIM" : "General"}${c.origin === "ai-draft" ? " · AI draft" : ""}` }),
    ),
  );
  if (c.kind === "term") {
    add(row, auto(c.meaning ?? "", "fa"), h("p", { class: "sentence en", text: c.usage ?? "" }));
    for (const x of c.extraUsages) add(row, h("p", { class: "sentence en extra", text: `${x.kind === "ai-tip" ? "Tip" : "AI"}: ${x.text}` }));
  }
  if (c.deck === "general") {
    const term = h("input", { attrs: { type: "text" } }); term.value = c.term ?? "";
    const meaning = h("input", { attrs: { type: "text", dir: "auto" } }); meaning.value = c.meaning ?? "";
    const usage = h("textarea", { attrs: { rows: "2" } }); usage.value = c.usage ?? "";
    add(row, 
      field("Term", term), field("Meaning", meaning), field("Usage", usage),
      h("div", { class: "row" },
        button("Save", async () => { await editGeneral(c, { term: term.value.trim(), meaning: meaning.value.trim(), usage: usage.value.trim() }); toast("Saved."); refresh(); }, "btn small primary"),
        c.origin === "ai-draft" ? button("Confirm", async () => { await confirmCard(c); refresh(); }, "btn small") : null,
        button("Delete", async () => { if (confirm("Archive this card? Its history is kept.")) { await archiveCard(c); refresh(); } }, "btn small ghost"),
      ),
    );
  } else {
    add(row, h("p", { class: "muted small", text: `From ${c.source}. Edit it in Obsidian and re-import.` }));
  }
  return row;
}

// ---------- Backup ----------

export const backupScreen: Screen = async (root, go) => {
  const last = await getMeta<string>("lastBackupAt");
  const restoreBox = h("div");
  const fileInput = h("input", { attrs: { type: "file", accept: ".json,application/json" } });
  fileInput.addEventListener("change", async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    try {
      const { file, plan } = await prepareRestore(await f.text());
      const choices = new Map<Conflict, Resolution>();
      const r = plan.report;
      set(restoreBox, 
        h("h2", { text: "Restore preview" }),
        h("p", { text: `Cards added ${r.cardsAdded}, updated ${r.cardsUpdated}; reviews added ${r.logsAdded}; aliases ${r.aliasesAdded}; inbox ${r.inboxAdded}; settings ${r.settingsTaken}.` }),
        ...plan.conflicts.map((c) => conflictRow(c, choices)),
        button(plan.conflicts.length ? "Apply with my choices" : "Apply restore", async () => {
          await applyRestore(file, plan, choices);
          toast("Restore complete.");
          go("home");
        }, "btn primary"),
      );
    } catch (e) {
      set(restoreBox, h("p", { class: "error", text: (e as Error).message }));
    }
  });

  add(root, 
    h("h1", { text: "Backup" }),
    h("p", { class: "muted", text: "Your reviews and General English cards exist only on this phone. Save a backup to iCloud Drive or Files at least weekly." }),
    h("p", { text: last ? `Last backup: ${new Date(last).toLocaleString()}` : "No backup yet." }),
    button("Export backup", async () => {
      const { name, json } = await exportBackup();
      const r = await saveFile(name, json);
      if (r !== "cancelled") { await markBackupDone(); toast(r === "shared" ? "Backup shared." : "Backup downloaded."); go("backup"); }
    }, "btn primary big"),
    h("p", { class: "muted small", text: "The backup never contains your Gemini key." }),
    h("section", { class: "panel" }, h("h2", { text: "Restore" }), h("p", { class: "muted", text: "Restoring merges the file into this phone. Nothing newer is removed." }), fileInput),
    restoreBox,
  );
};

function conflictRow(c: Conflict, choices: Map<Conflict, Resolution>): HTMLElement {
  if (c.kind === "integrity") return h("p", { class: "issue error", text: `Log entry ${c.entryId} differs; local copy kept.` });
  const label = c.kind === "card" ? `Card "${c.local.term ?? c.id}"` : c.kind === "alias" ? `Rename of "${c.fromId}"` : `Setting ${c.key}`;
  const local = c.kind === "card" ? `${c.local.meaning ?? ""} — ${c.local.usage ?? ""}` : c.kind === "alias" ? c.local.toId : JSON.stringify(c.local.value);
  const backup = c.kind === "card" ? `${c.backup.meaning ?? ""} — ${c.backup.usage ?? ""}` : c.kind === "alias" ? c.backup.toId : JSON.stringify(c.backup.value);
  choices.set(c, "local");
  const name = `c-${Math.random().toString(36).slice(2)}`;
  const opt = (v: Resolution, text: string) => {
    const input = h("input", { attrs: { type: "radio", name, value: v } });
    if (v === "local") input.checked = true;
    input.addEventListener("change", () => choices.set(c, v));
    return h("label", { class: "choice" }, input, h("span", { text, dir: "auto" }));
  };
  return h("div", { class: "conflict" }, h("strong", { text: label }), opt("local", `This phone: ${local}`), opt("backup", `Backup: ${backup}`));
}

// ---------- Settings ----------

export const settingsScreen: Screen = async (root, go) => {
  const s = await loadSettings();
  const key = await getApiKey();

  const keyInput = h("input", { attrs: { type: "password", placeholder: key ? "•••••••• (saved)" : "Paste Gemini API key", autocomplete: "off" } });
  const keyStatus = h("p", { class: "muted small" });
  const paid = checkbox(s["ai.paidTierConfirmed"], (v) => setSetting("ai.paidTierConfirmed", v));
  const model = textInput(s["ai.model"], (v) => setSetting("ai.model", v || "gemini-3.1-flash-lite"));

  const blocked = h("textarea", { attrs: { rows: "3", placeholder: "One per line: client names, project names…" } });
  blocked.value = s["privacy.blockedWords"].join("\n");
  blocked.addEventListener("change", () => setSetting("privacy.blockedWords", blocked.value.split("\n").map((x) => x.trim()).filter(Boolean)));

  const template = h("textarea", { attrs: { rows: "8" } });
  template.value = s["general.promptTemplate"];
  template.addEventListener("change", () => setSetting("general.promptTemplate", template.value));

  const voices = englishVoices();
  const voiceSel = h("select");
  add(voiceSel, h("option", { text: "Automatic (en-GB first)", attrs: { value: "" } }), ...voices.map((v) => h("option", { text: `${v.name} (${v.lang})`, attrs: { value: v.voiceURI } })));
  voiceSel.value = s["speech.voiceURI"] ?? "";
  voiceSel.addEventListener("change", () => setSetting("speech.voiceURI", voiceSel.value || null));

  add(root, 
    h("h1", { text: "Settings" }),
    h("section", { class: "panel" },
      h("h2", { text: "Gemini (optional)" }),
      field("API key", keyInput, "Stored only on this phone. Never in backups. Restrict the key to the Gemini API and set a budget alert."),
      h("div", { class: "row" },
        button("Save key", async () => { if (keyInput.value.trim()) { await setApiKey(keyInput.value.trim()); keyInput.value = ""; toast("Key saved."); go("settings"); } }, "btn small primary"),
        button("Test key", async () => {
          const k = await getApiKey();
          if (!k) { keyStatus.textContent = "No key saved."; return; }
          keyStatus.textContent = "Testing…";
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 20_000);
          const r = await makeGemini((await loadSettings())["ai.model"]).generate({ feature: "explain", instructions: "Reply with the single word OK.", input: "Test", maxOutputTokens: 10 }, k, ctrl.signal);
          clearTimeout(t);
          keyStatus.textContent = r.ok ? "Key works." : `Test failed: ${r.error}${r.status ? ` (${r.status})` : ""}${r.detail ? ` — ${r.detail}` : ""}`;
        }, "btn small"),
        key ? button("Delete key", async () => { await setApiKey(null); toast("Key deleted."); go("settings"); }, "btn small ghost") : null,
      ),
      keyStatus,
      field("Billing is enabled on this key's project (paid tier)", paid, "Free-tier content may be used to improve Google's products. AI stays off until you confirm."),
      field("Model", model),
      featureChecks(s),
      field("Monthly request cap", numberInput(s["ai.monthlyRequestCap"], (v) => setSetting("ai.monthlyRequestCap", v))),
    ),
    h("section", { class: "panel" },
      h("h2", { text: "Review" }),
      modeChecks("BIM modes", "bim.modes", s["bim.modes"], ["cloze", "produce", "recognise", "roleplay"]),
      modeChecks("General modes", "general.modes", s["general.modes"], ["cloze", "produce", "recognise"]),
      field("New BIM items per day", numberInput(s["bim.newPerDay"], (v) => setSetting("bim.newPerDay", v))),
      field("New General items per day", numberInput(s["general.newPerDay"], (v) => setSetting("general.newPerDay", v))),
      field("Reviews per day", numberInput(s["limits.reviewsPerDay"], (v) => setSetting("limits.reviewsPerDay", v))),
      field("Four rating buttons", checkbox(s["rating.buttons"] === 4, (v) => setSetting("rating.buttons", v ? 4 : 2))),
      field("Day starts at hour", numberInput(s["day.rolloverHour"], (v) => setSetting("day.rolloverHour", Math.min(23, Math.max(0, v))))),
      field("Voice", voiceSel, voices.length ? undefined : "No English voice found on this device."),
    ),
    h("section", { class: "panel" },
      h("h2", { text: "Privacy" }),
      field("Blocked words", blocked, "Checked on import, Inbox, and before every AI request."),
    ),
    h("section", { class: "panel" }, h("h2", { text: "AI prompt template" }), template),
  );
  invalidateSettings();
};

function checkbox(value: boolean, onChange: (v: boolean) => unknown): HTMLInputElement {
  const c = h("input", { attrs: { type: "checkbox" } });
  c.checked = value;
  c.addEventListener("change", () => void onChange(c.checked));
  return c;
}

function numberInput(value: number, onChange: (v: number) => unknown): HTMLInputElement {
  const i = h("input", { attrs: { type: "number", inputmode: "numeric", min: "0" } });
  i.value = String(value);
  i.addEventListener("change", () => { const n = Number(i.value); if (Number.isFinite(n) && n >= 0) void onChange(n); });
  return i;
}

function textInput(value: string, onChange: (v: string) => unknown): HTMLInputElement {
  const i = h("input", { attrs: { type: "text" } });
  i.value = value;
  i.addEventListener("change", () => void onChange(i.value.trim()));
  return i;
}

function modeChecks(label: string, key: "bim.modes" | "general.modes", current: Mode[], options: Mode[]): HTMLElement {
  const names: Record<Mode, string> = { cloze: "Cloze", produce: "Meaning → Term", recognise: "Term → Meaning", roleplay: "Role-play" };
  const set = new Set(current);
  return h("fieldset", { class: "checks" }, h("legend", { text: label }),
    ...options.map((m) => h("label", { class: "choice" }, checkbox(set.has(m), (v) => { v ? set.add(m) : set.delete(m); return setSetting(key, options.filter((o) => set.has(o))); }), h("span", { text: names[m] }))),
  );
}

function featureChecks(s: Settings): HTMLElement {
  const names = { draft: "Draft cards", feedback: "Role-play feedback", sentence: "New sentence", explain: "Explain" } as const;
  const set = new Set(s["ai.features"]);
  const all = Object.keys(names) as (keyof typeof names)[];
  return h("fieldset", { class: "checks" }, h("legend", { text: "AI features" }),
    ...all.map((f) => h("label", { class: "choice" }, checkbox(set.has(f), (v) => { v ? set.add(f) : set.delete(f); return setSetting("ai.features", all.filter((x) => set.has(x))); }), h("span", { text: names[f] }))),
  );
}

// ---------- Status ----------

async function swStatus(): Promise<string> {
  if (!("serviceWorker" in navigator)) return "not supported";
  try {
    const reg = await Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => setTimeout(() => r(null), 3000))]);
    return reg?.active ? "active" : "not active";
  } catch {
    return "error";
  }
}

export const statusScreen: Screen = async (root) => {
  const persisted = await requestPersistence();
  const st = await storageStatus();
  const snap = await snapshot();
  const s = snap.settings;
  const usage = await getAiUsage(monthKey());
  const cost = (usage.inputTokens * s["ai.priceInputPerM"] + usage.outputTokens * s["ai.priceOutputPerM"]) / 1_000_000;
  const last = await getMeta<string>("lastBackupAt");
  const mb = (n?: number) => (n === undefined ? "?" : `${(n / 1_048_576).toFixed(1)} MB`);
  const row = (k: string, v: string) => h("div", { class: "kv" }, h("span", { text: k }), h("strong", { text: v }));
  add(root, 
    h("h1", { text: "Status" }),
    row("App version", APP_VERSION),
    row("Installed (standalone)", isStandalone() ? "yes" : "no — add to Home Screen"),
    row("Persistent storage", String(st.persisted ?? persisted ?? "unknown")),
    row("Storage used", `${mb(st.usage)} of ${mb(st.quota)}`),
    row("Last backup", last ? new Date(last).toLocaleString() : "never"),
    row("Cards (active)", String(snap.cards.filter((c) => !c.archived).length)),
    row("Reviews logged", String(snap.logs.filter((l) => l.type === "review").length)),
    row("Inbox waiting", String(snap.inbox.filter((i) => i.status === "waiting").length)),
    row(`AI requests ${usage.month}`, `${usage.requests} (≈ $${cost.toFixed(3)})`),
    row("English voices", String(englishVoices().length)),
    row("Offline cache (service worker)", await swStatus()),
  );
};
