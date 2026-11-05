// A single .md "pack" file may hold several notes: each starts with a level-1 heading ("# Note name")
// and has its own "## English in Action" section. Each becomes one note whose source is the heading.
// A file with fewer than two such notes is returned unchanged (source = the file name).

import { splitLines } from "../parser/text";

export interface NoteInput {
  source: string;
  text: string;
}

export function splitNotes(text: string, fileSource: string): NoteInput[] {
  const lines = splitLines(text);
  let frontMatter = "";
  let body = lines;
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
    if (end > 0) {
      frontMatter = lines.slice(0, end + 1).join("\n");
      body = lines.slice(end + 1);
    }
  }

  // Level-1 headings outside fenced code blocks.
  const heads: { at: number; title: string }[] = [];
  let fence: string | null = null;
  body.forEach((l, i) => {
    const t = l.trimStart();
    const f = /^(```+|~~~+)/.exec(t);
    if (fence) { if (f && f[1]!.startsWith(fence[0]!) && f[1]!.length >= fence.length) fence = null; return; }
    if (f) { fence = f[1]!; return; }
    const m = /^# (.+?)\s*#*\s*$/.exec(l);
    if (m) heads.push({ at: i, title: m[1]!.trim() });
  });

  const notes = heads
    .map((h, k) => ({ title: h.title, lines: body.slice(h.at + 1, heads[k + 1]?.at ?? body.length) }))
    .filter((n) => n.lines.some((l) => l.trimEnd() === "## English in Action"));
  if (notes.length < 2) return [{ source: fileSource, text }];
  return notes.map((n) => ({ source: n.title, text: `${frontMatter}\n${n.lines.join("\n")}` }));
}
