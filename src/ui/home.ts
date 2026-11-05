import { queueFor, snapshot } from "../app/service";
import type { DeckChoice, Preset } from "../review/queue";
import { PRESET_SIZE, sessionItems } from "../review/queue";
import { db, getMeta } from "../store/db";
import { setSetting } from "../store/settings";
import type { Screen } from "./app";
import { add, set, button, h } from "./dom";

const RESUME_MS = 12 * 60 * 60 * 1000;

export const homeScreen: Screen = async (root, go) => {
  const snap = await snapshot();
  const s = snap.settings;
  let deck: DeckChoice = s["session.lastDeck"];
  let preset: Preset = s["session.preset"];

  const session = await (await db()).get("session", "current");
  const left = session ? session.itemIds.length - session.pos : 0;
  const canResume = session && left > 0 && Date.now() - Date.parse(session.updatedAt) < RESUME_MS;

  const lastBackup = await getMeta<string>("lastBackupAt");
  const sinceBackup = (await getMeta<number>("reviewsSinceBackup")) ?? 0;
  const backupDays = lastBackup ? (Date.now() - Date.parse(lastBackup)) / 86_400_000 : Infinity;
  const needBackup = (snap.logs.length > 0 || snap.cards.length > 0) && (backupDays > s["backup.reminderDays"] || sinceBackup >= 100);

  const countsBox = h("div", { class: "counts" });
  const startBtn = h("button", { class: "btn primary big", attrs: { type: "button" } });

  function refresh() {
    const { items, counts } = queueFor(snap, deck);
    const n = sessionItems(items, preset).length;
    set(countsBox, 
      stat("Due", counts.due), stat("New", counts.newAvailable), stat("Done today", counts.doneToday),
    );
    startBtn.textContent = n ? `Start (${n})` : "Nothing due";
    startBtn.disabled = n === 0;
  }

  startBtn.addEventListener("click", async () => {
    const { items } = queueFor(snap, deck);
    const chosen = sessionItems(items, preset);
    const now = new Date().toISOString();
    await (await db()).put("session", { key: "current", itemIds: chosen.map((i) => i.itemId), pos: 0, deck, startedAt: now, updatedAt: now, lastEntry: null });
    go("review");
  });

  const deckSel = segmented<DeckChoice>([["bim", "BIM"], ["general", "General"], ["both", "Both"]], deck, async (v) => {
    deck = v;
    await setSetting("session.lastDeck", v);
    refresh();
  });
  const presetSel = segmented<Preset>([["quick", `Quick ${PRESET_SIZE.quick}`], ["normal", `Normal ${PRESET_SIZE.normal}`], ["full", "Full"]], preset, async (v) => {
    preset = v;
    await setSetting("session.preset", v);
    refresh();
  });

  add(root, 
    h("h1", { text: "Parley" }),
    needBackup
      ? h("div", { class: "banner warn" },
          h("span", { text: lastBackup ? `Last backup ${Math.floor(backupDays)} days ago.` : "No backup yet. Your data exists only on this phone." }),
          button("Back up now", () => go("backup"), "btn small"))
      : null,
    canResume ? button(`Continue (${left} left)`, () => go("review"), "btn primary big") : null,
    deckSel,
    countsBox,
    startBtn,
    presetSel,
    snap.cards.length === 0
      ? h("p", { class: "muted", text: "No cards yet. Import a BIM note or add words to the Inbox." })
      : null,
  );
  refresh();
};

function stat(label: string, n: number) {
  return h("div", { class: "stat" }, h("strong", { text: String(n) }), h("span", { text: label }));
}

export function segmented<T extends string>(options: [T, string][], value: T, onChange: (v: T) => void): HTMLElement {
  const wrap = h("div", { class: "segmented", attrs: { role: "radiogroup" } });
  const render = (v: T) =>
    set(wrap, 
      ...options.map(([val, label]) =>
        h("button", {
          class: val === v ? "seg active" : "seg",
          text: label,
          attrs: { type: "button", role: "radio", "aria-checked": String(val === v) },
          on: { click: () => { render(val); onChange(val); } },
        }),
      ),
    );
  render(value);
  return wrap;
}
