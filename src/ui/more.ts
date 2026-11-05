// More tab: Import, Cards, Backup, Daily reminder, Settings, Status.

import { monthKey } from "../ai/client";
import { makeGemini } from "../ai/gemini";
import { ALL_AI_FEATURES, type AiFeature } from "../ai/provider";
import { applyRestore, archiveCard, confirmCard, editGeneral, exportBackup, markBackupDone, prepareRestore, snapshot, APP_VERSION, type Resolution } from "../app/service";
import type { Conflict } from "../backup/merge";
import type { Card, Mode } from "../model/types";
import { copyText, englishVoices, isStandalone, requestPersistence, saveFile, storageStatus } from "../platform/platform";
import { getAiUsage, getApiKey, getMeta, setApiKey } from "../store/db";
import { enabledAiFeatures, invalidateSettings, loadSettings, setSetting, type Settings } from "../store/settings";
import type { Screen } from "./app";
import { add, button, fa, field, group, h, largeHeader, navBar, row, sectionLabel, set, toast, toggle } from "./dom";

export const moreScreen: Screen = async (root) => {
  const last = await getMeta<string>("lastBackupAt");
  add(root,
    largeHeader("More"),
    group(
      row({ icon: "import", color: "blue", title: "Import BIM notes", subtitle: "From Files or paste", href: "#/import" }),
      row({ icon: "cards", color: "orange", title: "Cards", subtitle: "Browse, edit General cards", href: "#/cards" }),
    ),
    group(
      row({ icon: "download", color: "yellow", title: "Backup and restore", subtitle: last ? `Last backup ${new Date(last).toLocaleDateString("en-GB")}` : "No backup yet", href: "#/backup" }),
      row({ icon: "bell", color: "red", title: "Daily reminder", subtitle: "Set it up in the Reminders app", href: "#/reminder" }),
    ),
    group(
      row({ icon: "gear", color: "grey", title: "Settings", href: "#/settings" }),
      row({ icon: "info", color: "teal", title: "Status", href: "#/status" }),
    ),
  );
};

// ---------- Cards ----------

export const cardsScreen: Screen = async (root, go) => {
  const snap = await snapshot();
  const list = h("div", { class: "group" });
  const filter = h("input", { attrs: { type: "search", placeholder: "Search", "aria-label": "Search cards" } });
  const render = () => {
    const q = filter.value.trim().toLowerCase();
    const cards = snap.cards
      .filter((c) => !c.archived && (!q || (c.term ?? c.context ?? c.id).toLowerCase().includes(q)))
      .sort((a, b) => a.deck.localeCompare(b.deck) || (a.term ?? a.id).localeCompare(b.term ?? b.id));
    set(list, ...cards.map((c) => cardRow(c, () => go("cards"))));
    if (!cards.length) set(list, row({ title: "No cards", subtitle: q ? "Try another search" : "Import a note or add words to the Inbox" }));
  };
  filter.addEventListener("input", render);
  add(root, navBar("More", "#/more", "Cards"), filter, list);
  render();
};

function cardRow(c: Card, refresh: () => void): HTMLElement {
  const title = c.kind === "scenario" ? `Scenario · ${c.source}` : (c.term ?? c.id);
  const sub = `${c.deck === "bim" ? "BIM" : "General"}${c.origin === "ai-draft" ? " · AI draft" : ""}`;
  const d = h("details", { class: "row" }, h("summary", {}, h("span", { class: "label" }, h("b", { text: title }), h("small", { text: sub }))));
  if (c.kind === "term") {
    add(d, fa(c.meaning ?? ""), h("p", { class: "sentence", text: c.usage ?? "" }));
    for (const x of c.extraUsages) add(d, h("p", { class: "muted small", text: `${x.kind === "ai-tip" ? "Tip" : "AI"}: ${x.text}` }));
  } else {
    add(d, fa(c.context ?? "", "muted small"), ...(c.turns ?? []).map((t) => h("p", { class: "small", text: `${t.speaker}: ${t.text}` })));
  }
  if (c.deck === "general" && c.kind === "term") {
    const term = h("input", { attrs: { type: "text", "aria-label": "Term" } }); term.value = c.term ?? "";
    const meaning = h("input", { attrs: { type: "text", dir: "rtl", lang: "fa", "aria-label": "Meaning" } }); meaning.value = c.meaning ?? "";
    const usage = h("textarea", { attrs: { rows: "2", "aria-label": "Usage" } }); usage.value = c.usage ?? "";
    add(d, field("Term", term), field("Meaning", meaning), field("Usage", usage),
      h("div", { class: "row-btns" },
        button("Save", async () => { await editGeneral(c, { term: term.value.trim(), meaning: meaning.value.trim(), usage: usage.value.trim() }); toast("Saved."); refresh(); }, "btn small primary"),
        c.origin === "ai-draft" ? button("Confirm", async () => { await confirmCard(c); refresh(); }, "btn small") : null,
        button("Delete", async () => { if (confirm("Archive this card? Its history is kept.")) { await archiveCard(c); refresh(); } }, "btn small ghost")));
  } else if (c.deck === "general") {
    add(d, h("div", { class: "row-btns" },
      c.origin === "ai-draft" ? button("Confirm", async () => { await confirmCard(c); refresh(); }, "btn small") : null,
      button("Delete", async () => { if (confirm("Archive this scenario? Its history is kept.")) { await archiveCard(c); refresh(); } }, "btn small ghost")));
  } else {
    add(d, h("p", { class: "muted small", text: `From “${c.source}”. Edit it in Obsidian and import again.` }));
  }
  return d;
}

// ---------- Backup ----------

export const backupScreen: Screen = async (root, go) => {
  const last = await getMeta<string>("lastBackupAt");
  const restoreBox = h("div", { attrs: { style: "display:flex;flex-direction:column;gap:12px" } });
  const fileInput = h("input", { attrs: { type: "file", accept: ".json,application/json", hidden: "" } });
  fileInput.addEventListener("change", async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    try {
      const { file, plan } = await prepareRestore(await f.text());
      const choices = new Map<Conflict, Resolution>();
      const r = plan.report;
      set(restoreBox,
        sectionLabel("Restore preview"),
        group(row({ title: "Cards added", value: String(r.cardsAdded) }), row({ title: "Cards updated", value: String(r.cardsUpdated) }),
          row({ title: "Reviews added", value: String(r.logsAdded) }), row({ title: "Inbox words", value: String(r.inboxAdded) })),
        ...plan.conflicts.map((c) => conflictBox(c, choices)),
        button(plan.conflicts.length ? "Apply with my choices" : "Apply restore", async () => { await applyRestore(file, plan, choices); toast("Restore complete."); go("today"); }, "btn primary big"));
    } catch (e) {
      set(restoreBox, h("p", { class: "error", text: (e as Error).message }));
    }
  });

  add(root,
    navBar("More", "#/more", "Backup"),
    h("section", { class: "glass" },
      h("p", { class: "muted", text: "Your reviews and General English cards live only on this phone. Save a backup to iCloud Drive or Files at least once a week." }),
      h("p", { text: last ? `Last backup: ${new Date(last).toLocaleString("en-GB")}` : "No backup yet." }),
      button("Export backup", async () => {
        const { name, json } = await exportBackup();
        const r = await saveFile(name, json);
        if (r !== "cancelled") { await markBackupDone(); toast(r === "shared" ? "Backup shared." : "Backup downloaded."); go("backup"); }
      }, "btn primary big"),
      h("p", { class: "muted small", text: "The backup never contains your Gemini key." })),
    group(row({ icon: "import", color: "blue", title: "Restore from a backup file", subtitle: "Merges; nothing newer is removed", onClick: () => fileInput.click() })),
    fileInput,
    restoreBox);
};

function conflictBox(c: Conflict, choices: Map<Conflict, Resolution>): HTMLElement {
  if (c.kind === "integrity") return h("p", { class: "issue error", text: `Log entry ${c.entryId} differs; the copy on this phone was kept.` });
  const label = c.kind === "card" ? `Card “${c.local.term ?? c.id}”` : c.kind === "alias" ? `Rename of “${c.fromId}”` : `Setting ${c.key}`;
  const show = (x: unknown) => (c.kind === "card" ? `${(x as Card).meaning ?? ""} — ${(x as Card).usage ?? ""}` : c.kind === "alias" ? (x as { toId: string }).toId : JSON.stringify((x as { value: unknown }).value));
  choices.set(c, "local");
  const name = `c-${Math.random().toString(36).slice(2)}`;
  const opt = (v: Resolution, text: string) => {
    const input = h("input", { attrs: { type: "radio", name, value: v } });
    if (v === "local") input.checked = true;
    input.addEventListener("change", () => choices.set(c, v));
    return h("label", { class: "row" }, input, h("span", { class: "label" }, h("b", { text: v === "local" ? "This phone" : "Backup" }), h("small", { text, dir: "auto" })));
  };
  return h("section", { class: "group" }, h("div", { class: "row static" }, h("b", { text: label })), opt("local", show(c.local)), opt("backup", show(c.backup)));
}

// ---------- Daily reminder (F-4) ----------

export const reminderScreen: Screen = (root) => {
  const url = `${location.origin}${location.pathname}`;
  add(root,
    navBar("More", "#/more", "Reminder"),
    h("h1", { class: "large-title", text: "Daily reminder" }),
    h("p", { class: "muted", text: "Parley has no server, so it cannot send notifications itself. The iPhone Reminders app can remind you every day instead." }),
    h("section", { class: "glass" },
      h("p", { text: "1. Copy the Parley link below." }),
      button("Copy Parley link", async () => toast((await copyText(url)) ? "Link copied." : url), "btn"),
      h("p", { text: "2. Open Reminders, tap New Reminder, and type “Parley · 10 minutes”." }),
      h("p", { text: "3. Tap the info button: turn on Date and Time, choose a time, set Repeat to Daily." }),
      h("p", { text: "4. Paste the link into URL, then tap Done." }),
      h("p", { class: "muted small", text: "Tapping the reminder's link opens Parley in Safari; open it from the Home Screen icon to use your saved data." })));
};

// ---------- Settings ----------

const FEATURE_NAMES: Record<AiFeature, string> = {
  draft: "Draft cards", feedback: "Role-play feedback", sentence: "New sentence", explain: "Explain",
  interview: "Mock interview", scenario: "New meeting scenario", speak: "Speak freely", weak: "Weak-card sentences",
};

export const settingsScreen: Screen = async (root, go) => {
  invalidateSettings();
  const s = await loadSettings();
  const key = await getApiKey();

  const keyInput = h("input", { attrs: { type: "password", placeholder: key ? "•••••••• saved" : "Paste Gemini API key", autocomplete: "off", "aria-label": "Gemini API key" } });
  const keyStatus = h("p", { class: "muted small" });
  const model = h("input", { attrs: { type: "text", "aria-label": "Model" } }); model.value = s["ai.model"];
  model.addEventListener("change", () => void setSetting("ai.model", model.value.trim() || "gemini-3.1-flash-lite"));
  const blocked = h("textarea", { attrs: { rows: "3", placeholder: "One per line: client names, project names…", "aria-label": "Blocked words" } });
  blocked.value = s["privacy.blockedWords"].join("\n");
  blocked.addEventListener("change", () => void setSetting("privacy.blockedWords", blocked.value.split("\n").map((x) => x.trim()).filter(Boolean)));
  const template = h("textarea", { attrs: { rows: "8", "aria-label": "Prompt template" } }); template.value = s["general.promptTemplate"];
  template.addEventListener("change", () => void setSetting("general.promptTemplate", template.value));
  const voices = englishVoices();
  const voiceSel = h("select", { attrs: { "aria-label": "Voice" } });
  add(voiceSel, h("option", { text: "Automatic (en-GB first)", attrs: { value: "" } }), ...voices.map((v) => h("option", { text: `${v.name} (${v.lang})`, attrs: { value: v.voiceURI } })));
  voiceSel.value = s["speech.voiceURI"] ?? "";
  voiceSel.addEventListener("change", () => void setSetting("speech.voiceURI", voiceSel.value || null));

  const enabled = new Set(enabledAiFeatures(s));
  const featureRows = ALL_AI_FEATURES.map((f) => row({
    title: FEATURE_NAMES[f],
    trailing: toggle(enabled.has(f), (v) => { v ? enabled.add(f) : enabled.delete(f); return setSetting("ai.featuresOff", ALL_AI_FEATURES.filter((x) => !enabled.has(x))); }, FEATURE_NAMES[f]),
  }));

  add(root,
    navBar("More", "#/more", "Settings"),
    sectionLabel("Gemini"),
    h("section", { class: "glass" },
      field("API key", keyInput, "Stored only on this phone, never in backups. Restrict it to the Gemini API and set a budget alert."),
      h("div", { class: "row-btns" },
        button("Save key", async () => { if (keyInput.value.trim()) { await setApiKey(keyInput.value.trim()); keyInput.value = ""; toast("Key saved."); go("settings"); } }, "btn small primary"),
        button("Test key", async () => {
          const k = await getApiKey();
          if (!k) { keyStatus.textContent = "No key saved."; return; }
          keyStatus.textContent = "Testing…";
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 20_000);
          const r = await makeGemini((await loadSettings())["ai.model"]).generate({ feature: "explain", instructions: "Reply with the single word OK.", input: "Test", maxOutputTokens: 10 }, k, ctrl.signal);
          clearTimeout(t);
          keyStatus.textContent = r.ok ? "Key works." : `Test failed: ${r.error}${r.status ? ` (${r.status})` : ""}`;
        }, "btn small"),
        key ? button("Delete key", async () => { await setApiKey(null); toast("Key deleted."); go("settings"); }, "btn small ghost") : null),
      keyStatus,
      field("Model", model)),
    group(row({ title: "Billing is enabled (paid tier)", subtitle: "AI stays off until you confirm", trailing: toggle(s["ai.paidTierConfirmed"], (v) => setSetting("ai.paidTierConfirmed", v), "Paid tier confirmed") })),
    sectionLabel("AI features"),
    group(...featureRows),
    group(row({ title: "Monthly request cap", trailing: numberInput(s["ai.monthlyRequestCap"], (v) => setSetting("ai.monthlyRequestCap", v)) })),
    sectionLabel("Review"),
    group(...modeRows("BIM", "bim.modes", s["bim.modes"], ["cloze", "produce", "recognise", "roleplay"])),
    group(...modeRows("General", "general.modes", s["general.modes"], ["cloze", "produce", "recognise"])),
    group(
      row({ title: "New BIM items per day", trailing: numberInput(s["bim.newPerDay"], (v) => setSetting("bim.newPerDay", v)) }),
      row({ title: "New General items per day", trailing: numberInput(s["general.newPerDay"], (v) => setSetting("general.newPerDay", v)) }),
      row({ title: "Reviews per day", trailing: numberInput(s["limits.reviewsPerDay"], (v) => setSetting("limits.reviewsPerDay", v)) }),
      row({ title: "Four rating buttons", trailing: toggle(s["rating.buttons"] === 4, (v) => setSetting("rating.buttons", v ? 4 : 2), "Four rating buttons") }),
      row({ title: "Day starts at hour", trailing: numberInput(s["day.rolloverHour"], (v) => setSetting("day.rolloverHour", Math.min(23, Math.max(0, v)))) })),
    field("Voice", voiceSel, voices.length ? undefined : "No English voice found on this device."),
    sectionLabel("Privacy"),
    field("Blocked words", blocked, "Checked on import, Inbox and before every AI request."),
    sectionLabel("AI prompt for drafting cards"),
    template,
  );
};

function numberInput(value: number, onChange: (v: number) => unknown): HTMLInputElement {
  const i = h("input", { attrs: { type: "number", inputmode: "numeric", min: "0", style: "width:84px;text-align:right", "aria-label": "Value" } });
  i.value = String(value);
  i.addEventListener("change", () => { const n = Number(i.value); if (Number.isFinite(n) && n >= 0) void onChange(n); });
  return i;
}

function modeRows(deck: string, key: "bim.modes" | "general.modes", current: Mode[], options: Mode[]): HTMLElement[] {
  const names: Record<Mode, string> = { cloze: "Cloze", produce: "Meaning → Term", recognise: "Term → Meaning", roleplay: "Role-play" };
  const on = new Set(current);
  return options.map((m) => row({
    title: `${deck} · ${names[m]}`,
    trailing: toggle(on.has(m), (v) => { v ? on.add(m) : on.delete(m); return setSetting(key, options.filter((o) => on.has(o))); }, `${deck} ${names[m]}`),
  }));
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
  const s: Settings = snap.settings;
  const usage = await getAiUsage(monthKey());
  const cost = (usage.inputTokens * s["ai.priceInputPerM"] + usage.outputTokens * s["ai.priceOutputPerM"]) / 1_000_000;
  const last = await getMeta<string>("lastBackupAt");
  const mb = (n?: number) => (n === undefined ? "?" : `${(n / 1_048_576).toFixed(1)} MB`);
  const r = (k: string, v: string) => row({ title: k, value: v });
  add(root,
    navBar("More", "#/more", "Status"),
    group(r("App version", APP_VERSION), r("Installed on Home Screen", isStandalone() ? "Yes" : "No"), r("Offline cache", await swStatus()),
      r("Persistent storage", String(st.persisted ?? persisted ?? "unknown")), r("Storage used", `${mb(st.usage)} of ${mb(st.quota)}`)),
    group(r("Last backup", last ? new Date(last).toLocaleDateString("en-GB") : "Never"), r("Active cards", String(snap.cards.filter((c) => !c.archived).length)),
      r("Reviews logged", String(snap.logs.filter((l) => l.type === "review").length)), r("Inbox waiting", String(snap.inbox.filter((i) => i.status === "waiting").length))),
    group(r(`AI requests ${usage.month}`, String(usage.requests)), r("Estimated AI cost", `$${cost.toFixed(3)}`), r("English voices", String(englishVoices().length))),
  );
};
