// IndexedDB schema and access (data-model §1). The `secrets` store is never exported.

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Issue } from "../parser/types";
import type { AliasEntry, Card, InboxEntry, ReviewLogEntry, SettingRecord } from "../model/types";

export interface SessionState {
  key: "current";
  itemIds: string[];
  pos: number;
  deck: "bim" | "general" | "both";
  startedAt: string;
  updatedAt: string;
  lastEntry: { entryId: string; itemId: string } | null;
  /** normal = daily queue; weak = weak cards; note = one source note; free = no schedule changes (F-5). */
  kind?: "normal" | "weak" | "note" | "free";
  title?: string;
}

export interface AiUsageRecord {
  month: string; // YYYY-MM
  requests: number;
  inputTokens: number;
  outputTokens: number;
}

export interface ImportReportRecord {
  reportId: string;
  createdAt: string;
  summary: Record<string, number>;
  issues: Issue[];
}

interface ParleyDB extends DBSchema {
  cards: { key: string; value: Card; indexes: { byDeck: string } };
  logs: { key: string; value: ReviewLogEntry; indexes: { byItem: string } };
  aliases: { key: [string, string, string]; value: AliasEntry };
  inbox: { key: string; value: InboxEntry };
  settings: { key: string; value: SettingRecord };
  session: { key: string; value: SessionState };
  reports: { key: string; value: ImportReportRecord };
  meta: { key: string; value: { key: string; value: unknown } };
  secrets: { key: string; value: { key: string; value: string } };
  aiUsage: { key: string; value: AiUsageRecord };
}

export type DB = IDBPDatabase<ParleyDB>;

let dbPromise: Promise<DB> | null = null;

export function db(): Promise<DB> {
  dbPromise ??= openDB<ParleyDB>("parley", 1, {
    upgrade(d) {
      const cards = d.createObjectStore("cards", { keyPath: "id" });
      cards.createIndex("byDeck", "deck");
      const logs = d.createObjectStore("logs", { keyPath: "entryId" });
      logs.createIndex("byItem", "itemId");
      d.createObjectStore("aliases", { keyPath: ["fromId", "toId", "createdAt"] });
      d.createObjectStore("inbox", { keyPath: "inboxId" });
      d.createObjectStore("settings", { keyPath: "key" });
      d.createObjectStore("session", { keyPath: "key" });
      d.createObjectStore("reports", { keyPath: "reportId" });
      d.createObjectStore("meta", { keyPath: "key" });
      d.createObjectStore("secrets", { keyPath: "key" });
      d.createObjectStore("aiUsage", { keyPath: "month" });
    },
  });
  return dbPromise;
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await (await db()).get("meta", key))?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await (await db()).put("meta", { key, value });
}

/** Install ID and the next log sequence number (data-model §8.3). */
export async function installId(): Promise<string> {
  let id = await getMeta<string>("installId");
  if (!id) {
    id = `inst-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
    await setMeta("installId", id);
  }
  return id;
}

export async function nextSeq(): Promise<number> {
  const d = await db();
  const tx = d.transaction("meta", "readwrite");
  const cur = ((await tx.store.get("seq"))?.value as number | undefined) ?? 0;
  await tx.store.put({ key: "seq", value: cur + 1 });
  await tx.done;
  return cur + 1;
}

export async function loadAll(): Promise<{ cards: Card[]; logs: ReviewLogEntry[]; aliases: AliasEntry[]; inbox: InboxEntry[]; settings: SettingRecord[] }> {
  const d = await db();
  const [cards, logs, aliases, inbox, settings] = await Promise.all([
    d.getAll("cards"), d.getAll("logs"), d.getAll("aliases"), d.getAll("inbox"), d.getAll("settings"),
  ]);
  return { cards, logs, aliases, inbox, settings };
}

// ---------- secrets (K1, K2) ----------

const KEY_NAME = "gemini.apiKey";

export async function getApiKey(): Promise<string | null> {
  return (await (await db()).get("secrets", KEY_NAME))?.value ?? null;
}

export async function setApiKey(value: string | null): Promise<void> {
  const d = await db();
  if (value) await d.put("secrets", { key: KEY_NAME, value });
  else await d.delete("secrets", KEY_NAME);
}

export async function addAiUsage(month: string, inputTokens: number, outputTokens: number): Promise<void> {
  const d = await db();
  const tx = d.transaction("aiUsage", "readwrite");
  const cur = (await tx.store.get(month)) ?? { month, requests: 0, inputTokens: 0, outputTokens: 0 };
  await tx.store.put({ month, requests: cur.requests + 1, inputTokens: cur.inputTokens + inputTokens, outputTokens: cur.outputTokens + outputTokens });
  await tx.done;
}

export async function getAiUsage(month: string): Promise<AiUsageRecord> {
  return (await (await db()).get("aiUsage", month)) ?? { month, requests: 0, inputTokens: 0, outputTokens: 0 };
}
