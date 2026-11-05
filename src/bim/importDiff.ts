// BIM import: turns parsed notes into card changes (data-model §5.7, W-06).
// Pure apart from hashing; the caller writes the result in one transaction.

import { contentHashOf } from "../model/hash";
import type { Card } from "../model/types";
import { issue, type Issue, type ParsedNote } from "../parser/types";

export interface RenameSuggestion {
  fromId: string;
  toId: string;
  source: string;
}

export interface ImportResult {
  upserts: Card[];
  added: string[];
  changed: string[];
  unchanged: string[];
  archived: string[];
  restored: string[];
  renames: RenameSuggestion[];
  issues: Issue[];
}

interface Candidate {
  card: Omit<Card, "contentHash" | "updatedAt" | "baseHash" | "otherSources" | "extraUsages">;
}

function words(s: string | undefined): Set<string> {
  return new Set((s ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2));
}

function overlap(a: Card | undefined, b: Card | undefined): number {
  const wa = words(a?.usage);
  const wb = words(b?.usage);
  let n = 0;
  for (const w of wa) if (wb.has(w)) n++;
  return n;
}

/**
 * @param notes   parsed notes from this import
 * @param existing all cards currently stored (any deck)
 * @param mode    "file" archives terms missing from re-imported notes; "paste" never archives
 */
export async function diffImport(notes: ParsedNote[], existing: Card[], mode: "file" | "paste", now: string): Promise<ImportResult> {
  const res: ImportResult = { upserts: [], added: [], changed: [], unchanged: [], archived: [], restored: [], renames: [], issues: [] };
  const byId = new Map(existing.filter((c) => c.deck === "bim").map((c) => [c.id, c]));

  // 1. Candidates per ID; resolve duplicates across notes (W-06): earliest Created, then file name.
  const candidates = new Map<string, Candidate[]>();
  for (const n of notes) {
    res.issues.push(...n.issues);
    for (const t of n.terms) {
      const list = candidates.get(t.id) ?? [];
      list.push({
        card: {
          id: t.id, deck: "bim", kind: "term", origin: "vault", term: t.term, meaning: t.meaning, usage: t.usage,
          clozeOk: t.clozeOk, source: n.source, createdDate: n.createdDate, archived: false,
        },
      });
      candidates.set(t.id, list);
    }
    if (n.scenario) {
      candidates.set(n.scenario.id, [{
        card: {
          id: n.scenario.id, deck: "bim", kind: "scenario", origin: "vault", context: n.scenario.context,
          turns: n.scenario.turns, source: n.source, createdDate: n.createdDate, archived: false,
        },
      }]);
    }
  }

  const touched = new Set<string>();
  for (const [id, list] of candidates) {
    const prev = byId.get(id);
    // Sources already known for this ID from earlier imports also compete for primary.
    const all = [...list];
    if (prev && !list.some((c) => c.card.source === prev.source) && !prev.archived) {
      all.push({ card: { ...prev } });
    }
    all.sort((a, b) => a.card.createdDate.localeCompare(b.card.createdDate) || a.card.source.localeCompare(b.card.source));
    const primary = all[0]!.card;
    const others = new Set<string>([...(prev?.otherSources ?? []), ...all.slice(1).map((c) => c.card.source)]);
    others.delete(primary.source);
    if (all.length > 1) {
      res.issues.push({ ...issue("W-06", null, `"${id}" appears in several notes; primary source is "${primary.source}".`), source: primary.source });
    }
    const hash = await contentHashOf(primary);
    touched.add(id);
    if (!prev) {
      res.added.push(id);
      res.upserts.push({ ...primary, otherSources: [...others], contentHash: hash, updatedAt: now, baseHash: null, extraUsages: [] });
    } else if (prev.contentHash !== hash || prev.source !== primary.source || others.size !== prev.otherSources.length) {
      const contentChanged = prev.contentHash !== hash;
      (prev.archived ? res.restored : contentChanged ? res.changed : res.unchanged).push(id);
      res.upserts.push({
        ...prev, ...primary, otherSources: [...others], contentHash: hash,
        updatedAt: contentChanged ? now : prev.updatedAt, baseHash: contentChanged ? prev.contentHash : prev.baseHash,
      });
    } else {
      res.unchanged.push(id);
    }
  }

  // 2. Archive IDs whose note was re-imported as a file but no longer contains them.
  if (mode === "file") {
    const importedSources = new Set(notes.map((n) => n.source));
    for (const c of byId.values()) {
      if (c.archived || touched.has(c.id) || !importedSources.has(c.source)) continue;
      const archivedCard = { ...c, archived: true };
      const hash = await contentHashOf(archivedCard);
      res.archived.push(c.id);
      res.upserts.push({ ...archivedCard, contentHash: hash, baseHash: c.contentHash, updatedAt: now });
    }
    // 3. Rename suggestions per note (one lost + one gained, or pair by usage overlap).
    for (const n of notes) {
      const lost = res.archived.map((id) => byId.get(id)!).filter((c) => c.source === n.source && c.kind === "term");
      const gained = res.added.map((id) => res.upserts.find((u) => u.id === id)!).filter((c) => c.source === n.source && c.kind === "term");
      if (!lost.length || !gained.length) continue;
      const free = new Set(gained.map((g) => g.id));
      for (const l of lost) {
        let best: Card | undefined;
        let bestScore = -1;
        for (const g of gained) {
          if (!free.has(g.id)) continue;
          const s = lost.length === 1 && gained.length === 1 ? 1 : overlap(l, g);
          if (s > bestScore) { best = g; bestScore = s; }
        }
        if (best && bestScore > 0) {
          free.delete(best.id);
          res.renames.push({ fromId: l.id, toId: best.id, source: n.source });
        }
      }
    }
  }
  return res;
}
