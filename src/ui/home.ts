// Today tab (approved mockup: Main).

import { queueFor, snapshot, startSession } from "../app/service";
import type { DeckChoice, Preset } from "../review/queue";
import { PRESET_SIZE, sessionItems } from "../review/queue";
import { db, getMeta } from "../store/db";
import { setSetting } from "../store/settings";
import { aiStatus } from "./ai";
import type { Screen } from "./app";
import { add, button, group, h, icon, largeHeader, row, segmented, set } from "./dom";

const RESUME_MS = 12 * 60 * 60 * 1000;

export const todayScreen: Screen = async (root, go) => {
  const snap = await snapshot();
  const s = snap.settings;
  let deck: DeckChoice = s["session.lastDeck"];
  let preset: Preset = s["session.preset"];

  const session = await (await db()).get("session", "current");
  const left = session ? session.itemIds.length - session.pos : 0;
  const canResume = !!session && left > 0 && Date.now() - Date.parse(session.updatedAt) < RESUME_MS;

  const lastBackup = await getMeta<string>("lastBackupAt");
  const sinceBackup = (await getMeta<number>("reviewsSinceBackup")) ?? 0;
  const backupDays = lastBackup ? Math.floor((Date.now() - Date.parse(lastBackup)) / 86_400_000) : null;
  const hasData = snap.logs.length > 0 || snap.cards.length > 0;
  const needBackup = hasData && (backupDays === null || backupDays > s["backup.reminderDays"] || sinceBackup >= 100);
  const ai = await aiStatus();

  const summary = h("span", { attrs: { style: "font-size:28px;font-weight:700;letter-spacing:-0.01em" } });
  const tiles = h("div", { class: "tiles" });
  const startBtn = h("button", { class: "btn primary big", attrs: { type: "button" }, text: "Start" });
  const presetBadge = h("span", { class: "badge" });

  function refresh() {
    const { items, counts } = queueFor(snap, deck);
    const n = sessionItems(items, preset).length;
    summary.textContent = n ? `${n} items · ~${Math.max(1, Math.round(n * 0.35))} min` : "All done for now";
    presetBadge.textContent = { quick: "Quick", normal: "Normal", full: "Full" }[preset];
    startBtn.disabled = n === 0;
    startBtn.textContent = n ? "Start" : "Nothing due";
    set(tiles, tile(counts.due, "Due"), tile(counts.newAvailable, "New"), tile(counts.doneToday, "Done"));
  }

  startBtn.addEventListener("click", async () => {
    const chosen = sessionItems(queueFor(snap, deck).items, preset);
    await startSession(chosen.map((i) => i.itemId), deck, "normal");
    go("review");
  });

  const date = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  add(root,
    largeHeader("Today", date, h("a", { class: "btn round", attrs: { href: "#/settings", "aria-label": "Settings" } }, icon("gear", 20))),
    h("section", { class: "glass" },
      h("div", { class: "kv", attrs: { style: "align-items:center" } },
        h("div", { attrs: { style: "display:flex;flex-direction:column;gap:4px" } }, h("span", { class: "muted", text: "Ready to practise" }), summary),
        presetBadge),
      segmented<DeckChoice>([["bim", "BIM"], ["general", "General"], ["both", "Both"]], deck, async (v) => { deck = v; await setSetting("session.lastDeck", v); refresh(); }),
      startBtn,
      canResume ? button(`Continue last session · ${left} left`, () => go("review"), "btn") : null,
      segmented<Preset>([["quick", `Quick ${PRESET_SIZE.quick}`], ["normal", `Normal ${PRESET_SIZE.normal}`], ["full", "Full"]], preset, async (v) => { preset = v; await setSetting("session.preset", v); refresh(); }),
    ),
    tiles,
    group(
      row({
        icon: "sparkle", color: "violet", title: "Gemini coach",
        subtitle: "Interview, scenarios, feedback",
        href: ai === "ready" ? "#/practice" : "#/settings",
        trailing: h("span", { class: ai === "ready" ? "ok small" : "warn small", text: ai === "ready" ? "● Ready" : "Set up" }),
        chevron: false,
      }),
      needBackup
        ? row({ icon: "download", color: "yellow", title: "Back up now", subtitle: backupDays === null ? "No backup yet — data is only on this phone" : `Last backup ${backupDays} days ago`, href: "#/backup" })
        : null,
      snap.cards.length === 0 ? row({ icon: "import", color: "blue", title: "Import your first BIM note", subtitle: "Or add words to the Inbox", href: "#/import" }) : null,
    ),
  );
  refresh();
};

function tile(n: number, label: string) {
  return h("div", { class: "tile" }, h("strong", { text: String(n) }), h("span", { text: label }));
}
