// Category management (Settings → Categories). Renames and deletions also update cards and waiting words.

import { categoryOf } from "../model/types";
import { db } from "../store/db";
import { loadSettings, setSetting } from "../store/settings";

export async function addCategory(name: string): Promise<string | null> {
  const n = name.trim().replace(/\s+/g, " ");
  if (!n) return "Type a name.";
  if (n.length > 30) return "Use at most 30 characters.";
  const s = await loadSettings();
  if (n.toLowerCase() === "all" || s["categories"].some((c) => c.toLowerCase() === n.toLowerCase())) return "That category already exists.";
  await setSetting("categories", [...s["categories"], n]);
  return null;
}

export async function renameCategory(from: string, to: string): Promise<string | null> {
  const n = to.trim().replace(/\s+/g, " ");
  const s = await loadSettings();
  if (!n || n === from) return null;
  if (n.toLowerCase() === "all" || s["categories"].some((c) => c !== from && c.toLowerCase() === n.toLowerCase())) return "That category already exists.";
  await setSetting("categories", s["categories"].map((c) => (c === from ? n : c)));
  if (s["categories.default"] === from) await setSetting("categories.default", n);
  if (s["session.lastCategory"] === from) await setSetting("session.lastCategory", n);
  await moveItems(from, n);
  return null;
}

/** Deletes a category; its cards and waiting words move to `moveTo`. The last category cannot be deleted. */
export async function deleteCategory(name: string, moveTo: string): Promise<string | null> {
  const s = await loadSettings();
  if (s["categories"].length <= 1) return "Keep at least one category.";
  const rest = s["categories"].filter((c) => c !== name);
  const target = rest.includes(moveTo) ? moveTo : rest[0]!;
  await setSetting("categories", rest);
  if (s["categories.default"] === name) await setSetting("categories.default", target);
  if (s["session.lastCategory"] === name) await setSetting("session.lastCategory", "All");
  await moveItems(name, target);
  return null;
}

async function moveItems(from: string, to: string): Promise<void> {
  const d = await db();
  const tx = d.transaction(["cards", "inbox"], "readwrite");
  for (const c of await tx.objectStore("cards").getAll()) if (categoryOf(c) === from) await tx.objectStore("cards").put({ ...c, category: to });
  for (const e of await tx.objectStore("inbox").getAll()) if (e.category === from) await tx.objectStore("inbox").put({ ...e, category: to });
  await tx.done;
}
