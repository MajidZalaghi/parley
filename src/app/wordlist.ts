// Writes a bulk word list into the Inbox in one transaction.

import { parseWordList, type WordListResult } from "../general/wordlist";
import { slugify } from "../parser/text";
import { db } from "../store/db";
import { loadSettings } from "../store/settings";

export async function importWordList(text: string): Promise<WordListResult & { added: number }> {
  const s = await loadSettings();
  const d = await db();
  const known = new Set<string>();
  for (const c of await d.getAll("cards")) if (c.deck === "general" && c.kind === "term" && c.term) known.add(slugify(c.term));
  for (const e of await d.getAll("inbox")) known.add(e.slug);
  const r = parseWordList(text, known, s["privacy.blockedWords"]);
  const tx = d.transaction("inbox", "readwrite");
  const base = Date.now();
  for (const [i, e] of r.entries.entries()) {
    await tx.store.put({
      inboxId: crypto.randomUUID(), word: e.word, slug: e.slug, ...(e.seenIn ? { seenIn: e.seenIn } : {}),
      addedAt: new Date(base + i).toISOString(), status: "waiting",
    });
  }
  await tx.done;
  return { ...r, added: r.entries.length };
}
