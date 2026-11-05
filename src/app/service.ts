// Application service: the only place that combines store, parser, scheduler and backup.

import { buildBackup, planRestore, verifyBackup, type BackupFile, type Conflict, type MergePlan } from "../backup/merge";
import { diffImport, type ImportResult } from "../bim/importDiff";
import { contentHashOf } from "../model/hash";
import { itemIdOf, LEECH_LAPSES, TERM_MODES, type AliasEntry, type Card, type Deck, type InboxEntry, type Mode, type Rating, type ReviewLogEntry } from "../model/types";
import { parseNote } from "../parser/parse";
import { findBlockedWords, findCloze, normalizeText, slugify } from "../parser/text";
import type { ParsedTerm } from "../parser/types";
import { buildQueue, type QueueFilter, type QueueSettings } from "../review/queue";
import { fsrsParamsId, replay, wouldCycle, type FsrsSettings, type ItemState } from "../schedule/scheduler";
import { db, getMeta, installId, loadAll, nextSeq, setMeta } from "../store/db";
import { invalidateSettings, loadSettings, type Settings } from "../store/settings";

export const APP_VERSION = "0.2.0";

export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function fsrsSettingsFrom(s: Settings): FsrsSettings {
  return {
    requestRetention: s["fsrs.requestRetention"],
    maximumInterval: s["fsrs.maximumInterval"],
    enableFuzz: s["fsrs.enableFuzz"],
    enableShortTerm: s["fsrs.enableShortTerm"],
    weights: s["fsrs.weights"],
  };
}

export function queueSettingsFrom(s: Settings): QueueSettings {
  return {
    modes: s["review.modes"],
    newPerDay: s["limits.newPerDay"],
    reviewsPerDay: s["limits.reviewsPerDay"],
    rolloverHour: s["day.rolloverHour"],
  };
}

export interface Snapshot {
  cards: Card[];
  cardById: Map<string, Card>;
  logs: ReviewLogEntry[];
  aliases: AliasEntry[];
  inbox: InboxEntry[];
  states: Map<string, ItemState>;
  settings: Settings;
}

export async function snapshot(): Promise<Snapshot> {
  const [all, settings] = await Promise.all([loadAll(), loadSettings()]);
  const states = replay(all.logs, all.aliases, fsrsSettingsFrom(settings));
  return { ...all, cardById: new Map(all.cards.map((c) => [c.id, c])), states, settings };
}

export function queueFor(s: Snapshot, filter: QueueFilter = {}, now = new Date()) {
  return buildQueue(s.cards, s.states, queueSettingsFrom(s.settings), filter, now);
}

/** A card is a leech when its items were forgotten LEECH_LAPSES times or more (Anki's default). */
export function isLeech(card: Card, states: Map<string, ItemState>): boolean {
  return TERM_MODES.some((m) => (states.get(itemIdOf(card.id, m))?.fsrs.lapses ?? 0) >= LEECH_LAPSES);
}

// ---------- reviews ----------

export async function recordReview(itemId: string, rating: Rating, durationMs: number): Promise<ReviewLogEntry> {
  const s = await loadSettings();
  const inst = await installId();
  const entry: ReviewLogEntry = {
    entryId: `${inst}:${await nextSeq()}`,
    installId: inst,
    itemId,
    type: "review",
    rating,
    reviewedAt: new Date().toISOString(),
    durationMs: Math.round(durationMs),
    appVersion: APP_VERSION,
    fsrsParamsId: await fsrsParamsId(fsrsSettingsFrom(s)),
  };
  await (await db()).add("logs", entry);
  await bumpReviewsSinceBackup(1);
  return entry;
}

export async function undoReview(target: ReviewLogEntry): Promise<void> {
  const inst = await installId();
  const entry: ReviewLogEntry = {
    entryId: `${inst}:${await nextSeq()}`,
    installId: inst,
    itemId: target.itemId,
    type: "undo",
    undoes: target.entryId,
    reviewedAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    fsrsParamsId: target.fsrsParamsId,
  };
  await (await db()).add("logs", entry);
}

async function bumpReviewsSinceBackup(n: number): Promise<void> {
  await setMeta("reviewsSinceBackup", ((await getMeta<number>("reviewsSinceBackup")) ?? 0) + n);
}

// ---------- BIM import ----------

export interface ImportInput {
  source: string;
  text: string;
}

export async function importBim(inputs: ImportInput[], mode: "file" | "paste", category = "BIM"): Promise<ImportResult> {
  const s = await loadSettings();
  const notes = inputs.map((i) => parseNote(i.text, { source: i.source, mode, today: today(), blockedWords: s["privacy.blockedWords"] }));
  const d = await db();
  const existing = await d.getAll("cards");
  const result = await diffImport(notes, existing, mode, new Date().toISOString(), category);
  const tx = d.transaction(["cards", "reports"], "readwrite");
  for (const c of result.upserts) await tx.objectStore("cards").put(c);
  await tx.objectStore("reports").put({
    reportId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    summary: { added: result.added.length, changed: result.changed.length, unchanged: result.unchanged.length, archived: result.archived.length, restored: result.restored.length },
    issues: result.issues,
  });
  await tx.done;
  return result;
}

export async function addAlias(fromId: string, toId: string): Promise<string | null> {
  const d = await db();
  const aliases = await d.getAll("aliases");
  if (wouldCycle(aliases, fromId, toId)) return "This rename would create a loop.";
  if (aliases.some((a) => a.fromId === fromId && !a.retracted)) return `"${fromId}" is already renamed.`;
  await d.put("aliases", { fromId, toId, createdAt: new Date().toISOString(), retracted: false });
  return null;
}

// ---------- General English ----------

export async function addInbox(word: string, seenIn: string, category?: string): Promise<{ ok: true } | { ok: false; message: string; blocked?: string[] }> {
  const w = normalizeText(word);
  const slug = slugify(w);
  if (!slug) return { ok: false, message: "Type a word or phrase." };
  const d = await db();
  if (await d.get("cards", `gen:${slug}`)) return { ok: false, message: "This word is already a card." };
  if ((await d.getAll("inbox")).some((e) => e.slug === slug)) return { ok: false, message: "This word is already in the Inbox." };
  const entry: InboxEntry = { inboxId: crypto.randomUUID(), word: w, slug, addedAt: new Date().toISOString(), status: "waiting" };
  const seen = normalizeText(seenIn);
  if (seen) entry.seenIn = seen;
  if (category) entry.category = category;
  await d.put("inbox", entry);
  return { ok: true };
}

export function blockedIn(text: string, s: Settings): string[] {
  return findBlockedWords(text, s["privacy.blockedWords"]);
}

export type CardDraft = Pick<ParsedTerm, "term" | "meaning" | "usage"> & { definition?: string; ipa?: string; category?: string };

export async function acceptGeneral(t: CardDraft, origin: "ai-draft" | "user", inboxId?: string): Promise<Card> {
  const d = await db();
  const id = `gen:${slugify(t.term)}`;
  const now = new Date().toISOString();
  const base = { deck: "general" as Deck, kind: "term" as const, term: t.term, meaning: t.meaning, usage: t.usage, archived: false };
  const prev = await d.get("cards", id);
  const card: Card = {
    ...base,
    id,
    origin,
    clozeOk: findCloze(t.term, t.usage) !== null,
    source: "General English",
    otherSources: [],
    createdDate: prev?.createdDate ?? today(),
    contentHash: await contentHashOf(base),
    updatedAt: now,
    baseHash: prev?.contentHash ?? null,
    extraUsages: prev?.extraUsages ?? [],
    category: t.category ?? prev?.category ?? "General",
    ...(t.definition ? { definition: t.definition } : {}),
    ...(t.ipa ? { ipa: t.ipa } : {}),
  };
  const tx = d.transaction(["cards", "inbox"], "readwrite");
  await tx.objectStore("cards").put(card);
  if (inboxId) await tx.objectStore("inbox").delete(inboxId);
  await tx.done;
  return card;
}

/** Edits a General card. A changed term becomes a new card plus an alias (data-model §2). */
export async function editGeneral(card: Card, next: CardDraft): Promise<Card> {
  const newId = `gen:${slugify(next.term)}`;
  const full: CardDraft = { ...next, category: next.category ?? card.category };
  if (newId === card.id) return acceptGeneral(full, "user");
  const created = await acceptGeneral(full, "user");
  await archiveCard(card);
  await addAlias(card.id, newId);
  return created;
}

export async function archiveCard(card: Card): Promise<void> {
  const archived = { ...card, archived: true };
  await (await db()).put("cards", { ...archived, contentHash: await contentHashOf(archived), baseHash: card.contentHash, updatedAt: new Date().toISOString() });
}

export async function confirmCard(card: Card): Promise<void> {
  await (await db()).put("cards", { ...card, origin: "user" });
}

/** Category, definition and IPA are not part of the content hash, so they never cause import conflicts. */
export async function updateCardExtras(card: Card, extras: { category?: string; definition?: string; ipa?: string }): Promise<void> {
  const d = await db();
  const cur = (await d.get("cards", card.id)) ?? card;
  await d.put("cards", { ...cur, ...Object.fromEntries(Object.entries(extras).filter(([, v]) => v !== undefined && v !== "")) });
}

/** Erases every store. The Gemini key is kept unless keepKey is false (Settings → Erase all data). */
export async function eraseAllData(keepKey: boolean): Promise<void> {
  const d = await db();
  const all = ["cards", "logs", "aliases", "inbox", "settings", "session", "reports", "meta", "aiUsage", "secrets"] as const;
  const stores = all.filter((st) => !(keepKey && st === "secrets"));
  const tx = d.transaction(stores, "readwrite");
  for (const st of stores) await tx.objectStore(st).clear();
  await tx.done;
  invalidateSettings();
}

export async function addExtraUsage(card: Card, text: string, kind: "ai-sentence" | "ai-tip"): Promise<void> {
  const d = await db();
  const cur = (await d.get("cards", card.id)) ?? card;
  if (cur.extraUsages.some((x) => x.text === text)) return;
  await d.put("cards", { ...cur, extraUsages: [...cur.extraUsages, { text, kind, addedAt: new Date().toISOString() }] });
}

// ---------- backup ----------

export async function exportBackup(): Promise<{ name: string; json: string }> {
  const all = await loadAll();
  const file = await buildBackup(all, {
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    installId: await installId(),
    seqHigh: (await getMeta<number>("seq")) ?? 0,
  });
  return { name: `parley-backup-${today()}.json`, json: JSON.stringify(file) };
}

export async function markBackupDone(): Promise<void> {
  await setMeta("lastBackupAt", new Date().toISOString());
  await setMeta("reviewsSinceBackup", 0);
}

export async function prepareRestore(text: string): Promise<{ file: BackupFile; plan: MergePlan }> {
  const file = await verifyBackup(JSON.parse(text));
  return { file, plan: planRestore(await loadAll(), file) };
}

export type Resolution = "local" | "backup";

export async function applyRestore(file: BackupFile, plan: MergePlan, choices: Map<Conflict, Resolution>): Promise<void> {
  const d = await db();
  const tx = d.transaction(["cards", "logs", "aliases", "inbox", "settings", "meta"], "readwrite");
  for (const c of plan.cards) await tx.objectStore("cards").put(c);
  for (const l of plan.logs) await tx.objectStore("logs").put(l);
  for (const a of plan.aliases) await tx.objectStore("aliases").put(a);
  for (const i of plan.inbox) await tx.objectStore("inbox").put(i);
  for (const s of plan.settings) await tx.objectStore("settings").put(s);
  for (const [c, r] of choices) {
    if (r !== "backup") continue;
    if (c.kind === "card") await tx.objectStore("cards").put({ ...c.backup, baseHash: c.local.contentHash, updatedAt: new Date().toISOString() });
    if (c.kind === "alias") {
      await tx.objectStore("aliases").put({ ...c.local, retracted: true });
      await tx.objectStore("aliases").put(c.backup);
    }
    if (c.kind === "setting") await tx.objectStore("settings").put({ ...c.backup, updatedAt: new Date().toISOString() });
  }
  // Keep entry IDs unique: continue after the highest restored seq (data-model §8.3).
  const seqStore = tx.objectStore("meta");
  const cur = ((await seqStore.get("seq"))?.value as number | undefined) ?? 0;
  const restoredMax = Math.max(0, ...plan.logs.map((l) => Number(l.entryId.split(":")[1]) || 0), file.seqHigh);
  await seqStore.put({ key: "seq", value: Math.max(cur, restoredMax) });
  await tx.done;
  invalidateSettings();
}

// ---------- sessions ----------

export async function startSession(itemIds: string[], kind: "normal" | "weak" | "note" | "free", title?: string): Promise<void> {
  const now = new Date().toISOString();
  await (await db()).put("session", { key: "current", itemIds, pos: 0, deck: "both", startedAt: now, updatedAt: now, lastEntry: null, kind, ...(title ? { title } : {}) });
}

// ---------- AI scenario and interview history ----------

export async function saveAiScenario(s: { context: string; turns: Card["turns"] }): Promise<Card> {
  const base = { deck: "general" as Deck, kind: "scenario" as const, context: s.context, turns: s.turns, archived: false };
  const hash = await contentHashOf(base);
  const card: Card = {
    ...base,
    id: `gen:scenario:${hash.slice(0, 10)}`,
    origin: "ai-draft",
    source: "AI scenario",
    otherSources: [],
    createdDate: today(),
    contentHash: hash,
    updatedAt: new Date().toISOString(),
    baseHash: null,
    extraUsages: [],
    category: "General",
  };
  await (await db()).put("cards", card);
  return card;
}

export interface InterviewSummary {
  at: string;
  topic: string;
  verdicts: string[];
}

export async function addInterviewSummary(s: InterviewSummary): Promise<void> {
  const list = (await getMeta<InterviewSummary[]>("interviewHistory")) ?? [];
  await setMeta("interviewHistory", [s, ...list].slice(0, 100));
}

export async function interviewHistory(): Promise<InterviewSummary[]> {
  return (await getMeta<InterviewSummary[]>("interviewHistory")) ?? [];
}

export function cardModesLabel(mode: Mode): string {
  return { flashcard: "Flashcard", reverse: "Reverse", cloze: "Cloze", produce: "Meaning → Term", recognise: "Term → Meaning", roleplay: "Role-play" }[mode];
}

export { itemIdOf };
