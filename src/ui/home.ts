// Today tab (revision 5): category chips, Start, and tappable Due / New / Done tiles.
// The backup reminder appears only when the last backup (or first use) is older than the reminder days.

import { queueFor, queueSettingsFrom, snapshot, startSession, type Snapshot } from "../app/service";
import { categoryOf, type Mode } from "../model/types";
import type { Preset, QueueItem } from "../review/queue";
import { PRESET_SIZE, sessionItems, tileItems } from "../review/queue";
import { db, getMeta } from "../store/db";
import { setSetting } from "../store/settings";
import type { Screen } from "./app";
import { add, button, chips, group, h, icon, largeHeader, row, segmented, set, sheet } from "./dom";

const RESUME_MS = 12 * 60 * 60 * 1000;
const DAY = 86_400_000;
const MODE_SHORT: Record<Mode, string> = { flashcard: "Card", reverse: "Reverse", cloze: "Cloze", produce: "Produce", recognise: "Recognise", roleplay: "Role-play" };

export const todayScreen: Screen = async (root, go) => {
  const snap = await snapshot();
  const s = snap.settings;
  const cats = ["All", ...s["categories"]];
  let category = cats.includes(s["session.lastCategory"]) ? s["session.lastCategory"] : "All";
  let preset: Preset = s["session.preset"];

  const session = await (await db()).get("session", "current");
  const left = session ? session.itemIds.length - session.pos : 0;
  const canResume = !!session && left > 0 && Date.now() - Date.parse(session.updatedAt) < RESUME_MS;

  // Backup banner only after the reminder period (never on a fresh install).
  const lastBackup = await getMeta<string>("lastBackupAt");
  const firstUse = snap.logs.reduce<number | null>((m, l) => { const t = Date.parse(l.reviewedAt); return m === null || t < m ? t : m; }, null);
  const since = lastBackup ? Date.parse(lastBackup) : firstUse;
  const backupDays = since === null ? 0 : Math.floor((Date.now() - since) / DAY);
  const needBackup = since !== null && backupDays > s["backup.reminderDays"];

  const summary = h("span", { attrs: { style: "font-size:28px;font-weight:700;letter-spacing:-0.01em" } });
  const tiles = h("div", { class: "tiles" });
  const startBtn = h("button", { class: "btn primary big", attrs: { type: "button" }, text: "Start" });
  const presetBadge = h("span", { class: "badge" });

  const filter = () => ({ category });
  function refresh() {
    const { items, counts } = queueFor(snap, filter());
    const n = sessionItems(items, preset).length;
    summary.textContent = n ? `${n} item${n === 1 ? "" : "s"} · ~${Math.max(1, Math.round(n * 0.35))} min` : "All done for now";
    presetBadge.textContent = { quick: "Quick", normal: "Normal", full: "Full" }[preset];
    startBtn.disabled = n === 0;
    startBtn.textContent = n ? "Start" : "Nothing due";
    const t = tileItems(snap.cards, snap.states, queueSettingsFrom(s), filter(), new Date());
    set(tiles,
      tile(counts.due, "Due", () => showList("Due", t.due.map((i) => itemLine(snap, i)))),
      tile(counts.newAvailable, "New", () => showList("New today", t.fresh.map((i) => itemLine(snap, i)))),
      tile(counts.doneToday, "Done", () => showList("Done today", t.done.map((d) => itemLine(snap, d, ["", "Again", "Hard", "Good", "Easy"][d.rating] ?? "")))));
  }

  startBtn.addEventListener("click", async () => {
    const chosen = sessionItems(queueFor(snap, filter()).items, preset);
    await startSession(chosen.map((i) => i.itemId), "normal", category === "All" ? undefined : category);
    go("review");
  });

  const date = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  add(root,
    largeHeader("Today", date, h("a", { class: "btn round", attrs: { href: "#/settings", "aria-label": "Settings" } }, icon("gear", 20))),
    needBackup
      ? group(row({ icon: "download", color: "yellow", title: "Time for a backup", subtitle: lastBackup ? `Last backup ${backupDays} days ago` : "Your cards exist only on this phone", href: "#/backup" }))
      : null,
    h("section", { class: "glass" },
      h("div", { class: "kv", attrs: { style: "align-items:center" } },
        h("div", { attrs: { style: "display:flex;flex-direction:column;gap:4px" } }, h("span", { class: "muted", text: "Ready to practise" }), summary),
        presetBadge),
      chips(cats.map((c) => [c, c]) as [string, string][], category, async (v) => { category = v; await setSetting("session.lastCategory", v); refresh(); }),
      startBtn,
      canResume ? button(`Continue last session · ${left} left`, () => go("review"), "btn") : null,
      segmented<Preset>([["quick", `Quick ${PRESET_SIZE.quick}`], ["normal", `Normal ${PRESET_SIZE.normal}`], ["full", "Full"]], preset, async (v) => { preset = v; await setSetting("session.preset", v); refresh(); }),
    ),
    tiles,
    snap.cards.length === 0
      ? group(
          row({ icon: "plus", color: "orange", title: "Add your first word", subtitle: "Inbox → waiting list → cards", href: "#/inbox" }),
          row({ icon: "import", color: "blue", title: "Import BIM notes", subtitle: "A pack file or notes from Files", href: "#/import" }))
      : null,
  );
  refresh();
};

function tile(n: number, label: string, onTap: () => void) {
  return h("button", { class: "tile", attrs: { type: "button", "aria-label": `${label}: ${n}. Show the list` }, on: { click: onTap } },
    h("strong", { text: String(n) }), h("span", { text: `${label} ›` }));
}

function itemLine(snap: Snapshot, i: Pick<QueueItem, "cardId" | "mode">, extra = ""): HTMLElement {
  const c = snap.cardById.get(i.cardId);
  const title = c?.kind === "scenario" ? `Scenario · ${c.source}` : c?.term ?? i.cardId;
  return row({ title, subtitle: `${c ? categoryOf(c) : ""} · ${MODE_SHORT[i.mode]}`, value: extra });
}

function showList(title: string, rows: HTMLElement[]) {
  const close = sheet(
    h("h2", { class: "title", text: `${title} · ${rows.length}` }),
    rows.length ? group(...rows.slice(0, 200)) : h("p", { class: "muted", text: "Nothing here." }),
    button("Close", () => close(), "btn big"));
}
