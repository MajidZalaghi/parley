// Backup file format and restore merge (data-model §8). Pure apart from hashing.

import { sha256Hex } from "../model/hash";
import type { AliasEntry, Card, InboxEntry, ReviewLogEntry, SettingRecord } from "../model/types";

export interface BackupData {
  cards: Card[];
  logs: ReviewLogEntry[];
  aliases: AliasEntry[];
  inbox: InboxEntry[];
  settings: SettingRecord[];
}

export interface BackupFile extends BackupData {
  format: "parley-backup";
  formatVersion: 1;
  appVersion: string;
  exportedAt: string;
  installId: string;
  seqHigh: number;
  sha256: string;
}

type Unhashed = Omit<BackupFile, "sha256">;

function canonicalJson(b: Unhashed): string {
  // Fixed key order so the hash is stable.
  return JSON.stringify({
    format: b.format, formatVersion: b.formatVersion, appVersion: b.appVersion, exportedAt: b.exportedAt,
    installId: b.installId, seqHigh: b.seqHigh, cards: b.cards, logs: b.logs, aliases: b.aliases,
    inbox: b.inbox, settings: b.settings,
  });
}

export async function buildBackup(data: BackupData, meta: { appVersion: string; exportedAt: string; installId: string; seqHigh: number }): Promise<BackupFile> {
  const body: Unhashed = { format: "parley-backup", formatVersion: 1, ...meta, ...data };
  return { ...body, sha256: await sha256Hex(canonicalJson(body)) };
}

export async function verifyBackup(raw: unknown): Promise<BackupFile> {
  const b = raw as Partial<BackupFile>;
  if (!b || b.format !== "parley-backup" || b.formatVersion !== 1) throw new Error("Not a Parley backup file.");
  for (const k of ["cards", "logs", "aliases", "inbox", "settings"] as const) {
    if (!Array.isArray(b[k])) throw new Error(`Backup is missing "${k}".`);
  }
  const { sha256, ...rest } = b as BackupFile;
  if ((await sha256Hex(canonicalJson(rest))) !== sha256) throw new Error("Backup hash does not match; the file is damaged or edited.");
  if (JSON.stringify(b).includes("gemini.apiKey")) throw new Error("Backup contains secrets; refused.");
  return b as BackupFile;
}

export type Conflict =
  | { kind: "card"; id: string; local: Card; backup: Card }
  | { kind: "alias"; fromId: string; local: AliasEntry; backup: AliasEntry }
  | { kind: "setting"; key: string; local: SettingRecord; backup: SettingRecord }
  | { kind: "integrity"; entryId: string };

export interface MergePlan {
  cards: Card[];          // cards to write (new or replaced)
  logs: ReviewLogEntry[]; // log entries to add
  aliases: AliasEntry[];  // alias entries to write
  inbox: InboxEntry[];    // inbox entries to add
  settings: SettingRecord[];
  conflicts: Conflict[];
  report: { cardsAdded: number; cardsUpdated: number; logsAdded: number; aliasesAdded: number; inboxAdded: number; settingsTaken: number; inboxDropped: number };
}

const aliasKey = (a: AliasEntry) => `${a.fromId}\u0000${a.toId}\u0000${a.createdAt}`;

export function planRestore(local: BackupData, backup: BackupFile): MergePlan {
  const plan: MergePlan = {
    cards: [], logs: [], aliases: [], inbox: [], settings: [], conflicts: [],
    report: { cardsAdded: 0, cardsUpdated: 0, logsAdded: 0, aliasesAdded: 0, inboxAdded: 0, settingsTaken: 0, inboxDropped: 0 },
  };

  // Logs: union by entryId.
  const localLogs = new Map(local.logs.map((l) => [l.entryId, l]));
  for (const e of backup.logs) {
    const l = localLogs.get(e.entryId);
    if (!l) { plan.logs.push(e); plan.report.logsAdded++; }
    else if (JSON.stringify(l) !== JSON.stringify(e)) plan.conflicts.push({ kind: "integrity", entryId: e.entryId });
  }

  // Cards: three-way by hash.
  const localCards = new Map(local.cards.map((c) => [c.id, c]));
  for (const r of backup.cards) {
    const l = localCards.get(r.id);
    if (!l) { plan.cards.push(r); plan.report.cardsAdded++; continue; }
    const extras = mergeExtras(l, r);
    if (l.contentHash === r.contentHash) {
      if (extras !== l.extraUsages) { plan.cards.push({ ...l, extraUsages: extras }); plan.report.cardsUpdated++; }
      continue;
    }
    if (r.baseHash === l.contentHash) { plan.cards.push({ ...r, extraUsages: extras }); plan.report.cardsUpdated++; }
    else if (l.baseHash === r.contentHash) { if (extras !== l.extraUsages) plan.cards.push({ ...l, extraUsages: extras }); }
    else plan.conflicts.push({ kind: "card", id: r.id, local: l, backup: r });
  }

  // Aliases: union, retraction wins, forks are conflicts.
  const localAliases = new Map(local.aliases.map((a) => [aliasKey(a), a]));
  const activeByFrom = new Map(local.aliases.filter((a) => !a.retracted).map((a) => [a.fromId, a]));
  for (const a of backup.aliases) {
    const same = localAliases.get(aliasKey(a));
    if (same) {
      if (a.retracted && !same.retracted) plan.aliases.push({ ...same, retracted: true });
      continue;
    }
    const active = activeByFrom.get(a.fromId);
    if (!a.retracted && active && active.toId !== a.toId) {
      plan.conflicts.push({ kind: "alias", fromId: a.fromId, local: active, backup: a });
      continue;
    }
    plan.aliases.push(a);
    plan.report.aliasesAdded++;
  }

  // Inbox: union by id; drop entries already turned into cards.
  const localInbox = new Set(local.inbox.map((i) => i.inboxId));
  const cardIds = new Set([...local.cards, ...backup.cards].map((c) => c.id));
  for (const i of backup.inbox) {
    if (localInbox.has(i.inboxId)) continue;
    if (cardIds.has(`gen:${i.slug}`)) { plan.report.inboxDropped++; continue; }
    plan.inbox.push(i);
    plan.report.inboxAdded++;
  }

  // Settings: per key (data-model §8.2).
  const localSettings = new Map(local.settings.map((s) => [s.key, s]));
  for (const r of backup.settings) {
    const l = localSettings.get(r.key);
    if (!l) { plan.settings.push(r); plan.report.settingsTaken++; continue; }
    if (JSON.stringify(l.value) === JSON.stringify(r.value)) continue;
    if (l.updatedAt <= backup.exportedAt && r.updatedAt >= l.updatedAt) { plan.settings.push(r); plan.report.settingsTaken++; }
    else if (l.updatedAt > backup.exportedAt && r.updatedAt > l.updatedAt) plan.conflicts.push({ kind: "setting", key: r.key, local: l, backup: r });
    // otherwise local is newer: keep it
  }
  return plan;
}

function mergeExtras(l: Card, r: Card): Card["extraUsages"] {
  const have = new Set(l.extraUsages.map((x) => `${x.kind}\u0000${x.text}`));
  const add = r.extraUsages.filter((x) => !have.has(`${x.kind}\u0000${x.text}`));
  return add.length ? [...l.extraUsages, ...add] : l.extraUsages;
}
