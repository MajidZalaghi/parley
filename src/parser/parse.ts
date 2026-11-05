// Line-based parser for the English in Action contract (data-model §5).
// One parser serves BIM note files, BIM paste and General English AI replies.

import { findBlockedWords, findCloze, normalizeText, slugify, splitLines } from "./text";
import { issue, type Issue, type ParsedNote, type ParsedScenario, type ParsedTerm, type ScenarioTurn } from "./types";

const SECTION_HEADING = "## English in Action";
const TERMS_HEADING = "### Power Collocations & Terms";
const SCENARIO_HEADING = "### Meeting Scenario";

const TERM_PREFIX_RE = /^- `([^`]+)`\s*\|\s*Meaning:\s*(.*?)\s*\|\s*Usage:\s*(.*)$/;
const CONTEXT_RE = /^>\s*\[!quote\]\s*Context:\s*(.+)$/;
const TURN_RE = /^>\s*\*\*([^*]+?):\*\*\s*(.+)$/;
const CREATED_RE = /^Created:\s*["']?(\d{4}-\d{2}-\d{2})["']?\s*$/;

interface Line {
  n: number; // 1-based
  text: string;
}

export interface ParseOptions {
  source: string;
  mode: "file" | "paste";
  today: string; // YYYY-MM-DD, used when Created is missing
  blockedWords?: readonly string[];
}

// ---------- quoted text ----------

type QuoteResult =
  | { ok: true; text: string; curly: boolean }
  | { ok: false; code: "E-02" | "E-03" };

/** Reads text between an opening quote and the last closing quote on the line. */
function readQuoted(raw: string): QuoteResult {
  const s = raw.trim();
  const open = s[0];
  if (open !== '"' && open !== "“") return { ok: false, code: "E-02" };
  const closeStraight = s.lastIndexOf('"');
  const closeCurly = s.lastIndexOf("”");
  const close = Math.max(closeStraight, closeCurly);
  if (close <= 0 || close !== s.length - 1) return { ok: false, code: "E-02" };
  const text = normalizeText(s.slice(1, close));
  if (!text) return { ok: false, code: "E-03" };
  return { ok: true, text, curly: open === "“" || close === closeCurly };
}

// ---------- term lines ----------

export type TermLineResult =
  | { kind: "term"; term: ParsedTerm; issues: Issue[] }
  | { kind: "error"; issues: Issue[] }
  | { kind: "none" };

/**
 * Parses one candidate term line. `allowAltMarkers` accepts "* " and "1." list markers (AI replies, W-09).
 * Returns kind "none" when the line does not look like a term line at all.
 */
export function parseTermLine(rawLine: string, lineNo: number, allowAltMarkers = false): TermLineResult {
  let line = rawLine.trim();
  const issues: Issue[] = [];
  if (allowAltMarkers) {
    const alt = /^(?:\*|\d+[.)])\s+(?=`)/.exec(line);
    if (alt) {
      line = "- " + line.slice(alt[0].length);
      issues.push(issue("W-09", lineNo, "List marker normalised to '- '."));
    }
  }
  if (!line.startsWith("- ")) return { kind: "none" };

  const m = TERM_PREFIX_RE.exec(line);
  if (!m) {
    if (allowAltMarkers && !/Meaning:|Usage:/.test(line)) return { kind: "none" };
    issues.push(issue("E-01", lineNo, "Line does not match: - `term` | Meaning: ... | Usage: \"...\""));
    return { kind: "error", issues };
  }
  const term = normalizeText(m[1] ?? "");
  const meaning = normalizeText(m[2] ?? "");
  const q = readQuoted(m[3] ?? "");
  if (!q.ok) {
    issues.push(issue(q.code, lineNo, q.code === "E-02" ? "Usage needs opening and closing quotes." : "Usage is empty."));
    return { kind: "error", issues };
  }
  if (!meaning) {
    issues.push(issue("E-03", lineNo, "Meaning is empty."));
    return { kind: "error", issues };
  }
  const id = slugify(term);
  if (!id) {
    issues.push(issue("E-04", lineNo, `Term "${term}" gives an empty ID.`));
    return { kind: "error", issues };
  }
  if (q.curly) issues.push(issue("W-02", lineNo, "Curly quotes around Usage."));
  const clozeOk = findCloze(term, q.text) !== null;
  if (!clozeOk) issues.push(issue("W-03", lineNo, `"${term}" is not in its Usage sentence; cloze disabled.`));
  return { kind: "term", term: { id, term, meaning, usage: q.text, clozeOk, line: lineNo }, issues };
}

// ---------- lenient term lines (AI replies only) ----------

// The term may be in backticks, **bold**, *italic*, quotes, or bare. Labels are case-insensitive.
const LENIENT_RE = /^(?:`([^`]+)`|\*\*`?([^*`|]+?)`?\*\*|\*([^*|]+)\*|["“]([^"”|]+)["”]|([^|`*"“]+?))\s*\|\s*Meaning\s*:\s*(.*?)\s*\|\s*Usage\s*:\s*(.*)$/i;

/**
 * Parses a card line from an AI reply. A line with a Meaning or Usage label but a broken shape is an error;
 * a line with neither label is chatter and is ignored. Chat models often drop the "- " marker, bold the term, omit the
 * backticks or add text after the closing quote, so this accepts those shapes. Vault notes keep using the
 * strict parseTermLine. 
 */
export function parseLenientTermLine(rawLine: string, lineNo: number): TermLineResult {
  let line = rawLine.trim();
  if (!line || !/(?:Meaning|Usage)\s*:/i.test(line)) return { kind: "none" }; // no label at all: chatter
  const issues: Issue[] = [];
  const marker = /^(?:[-*•–]|\d+[.)])\s+/.exec(line);
  if (marker) {
    if (marker[0].trim() !== "-") issues.push(issue("W-09", lineNo, "List marker normalised."));
    line = line.slice(marker[0].length);
  }
  const m = LENIENT_RE.exec(line);
  if (!m) {
    issues.push(issue("E-01", lineNo, "Line does not match: `term` | Meaning: ... | Usage: \"...\""));
    return { kind: "error", issues };
  }
  const term = normalizeText(m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? "");
  const meaning = normalizeText(m[6] ?? "");

  let u = (m[7] ?? "").trim();
  let tidied = false;
  if (u.startsWith('"') || u.startsWith("“")) {
    u = u.slice(1);
    const close = Math.max(u.lastIndexOf('"'), u.lastIndexOf("”"));
    if (close >= 0) { if (close !== u.length - 1) tidied = true; u = u.slice(0, close); } else tidied = true;
    if (rawLine.includes("“") || rawLine.includes("”")) tidied = true;
  } else {
    tidied = true; // no quotes at all
  }
  const usage = normalizeText(u);
  if (tidied) issues.push(issue("W-02", lineNo, "Usage quotes normalised."));
  if (!meaning || !usage) {
    issues.push(issue("E-03", lineNo, !meaning ? "Meaning is empty." : "Usage is empty."));
    return { kind: "error", issues };
  }
  const id = slugify(term);
  if (!id) {
    issues.push(issue("E-04", lineNo, `Term "${term}" gives an empty ID.`));
    return { kind: "error", issues };
  }
  const clozeOk = findCloze(term, usage) !== null;
  if (!clozeOk) issues.push(issue("W-03", lineNo, `"${term}" is not in its Usage sentence; cloze disabled.`));
  return { kind: "term", term: { id, term, meaning, usage, clozeOk, line: lineNo }, issues };
}

// ---------- scenario ----------

function parseScenarioBlock(lines: Line[], scenarioId: string): { scenario: ParsedScenario | null; issues: Issue[] } {
  const issues: Issue[] = [];
  const nonEmpty = lines.filter((l) => l.text.trim() !== "");
  const first = nonEmpty[0];
  if (!first) return { scenario: null, issues };
  const ctx = CONTEXT_RE.exec(first.text.trim());
  if (!ctx) {
    issues.push(issue("E-06", first.n, "Scenario must start with: > [!quote] Context: ..."));
    return { scenario: null, issues };
  }
  const turns: ScenarioTurn[] = [];
  const startIdx = lines.indexOf(first);
  for (let i = startIdx + 1; i < lines.length; i++) {
    const l = lines[i]!;
    const t = l.text.trim();
    if (!t.startsWith(">")) break;
    if (t === ">") continue;
    const tm = TURN_RE.exec(t);
    if (!tm) {
      issues.push(issue("W-08", l.n, "Unrecognised scenario line ignored."));
      continue;
    }
    const q = readQuoted(tm[2] ?? "");
    if (!q.ok) {
      issues.push(issue("W-08", l.n, "Scenario turn without quotes ignored."));
      continue;
    }
    if (q.curly) issues.push(issue("W-02", l.n, "Curly quotes in scenario turn."));
    const speaker = normalizeText(tm[1] ?? "");
    turns.push({ speaker, isYou: speaker.startsWith("You"), text: q.text });
  }
  const hasYou = turns.some((t) => t.isYou);
  const hasOther = turns.some((t) => !t.isYou);
  if (!hasYou || !hasOther) {
    issues.push(issue("E-06", first.n, "Scenario needs at least one other-role turn and one 'You' turn."));
    return { scenario: null, issues };
  }
  return {
    scenario: { id: scenarioId, context: normalizeText(ctx[1] ?? ""), turns, line: first.n },
    issues,
  };
}

// ---------- section detection ----------

function stripFrontMatter(lines: Line[]): { body: Line[]; created: string | null } {
  if (lines[0]?.text.trim() !== "---") return { body: lines, created: null };
  let created: string | null = null;
  for (let i = 1; i < lines.length; i++) {
    const t = lines[i]!.text;
    if (t.trim() === "---") return { body: lines.slice(i + 1), created };
    const m = CREATED_RE.exec(t.trim());
    if (m) created = m[1] ?? null;
  }
  return { body: lines, created: null }; // unterminated front matter: treat as body
}

/** Marks lines inside fenced code blocks so headings there are ignored. */
function fencedMask(lines: Line[]): boolean[] {
  const mask: boolean[] = [];
  let fence: string | null = null;
  for (const l of lines) {
    const t = l.text.trimStart();
    const m = /^(```+|~~~+)/.exec(t);
    if (fence) {
      mask.push(true);
      if (m && m[1]!.startsWith(fence[0]!) && m[1]!.length >= fence.length) fence = null;
    } else if (m) {
      fence = m[1]!;
      mask.push(true);
    } else {
      mask.push(false);
    }
  }
  return mask;
}

const isTopHeading = (t: string) => t.startsWith("# ") || t.startsWith("## ");
const isSubHeading = (t: string) => t.startsWith("### ");

/** Returns the section body lines, or null when no section heading exists. */
function findSection(lines: Line[], issues: Issue[]): Line[] | null {
  const mask = fencedMask(lines);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (mask[i]) continue;
    if (lines[i]!.text.trimEnd() === SECTION_HEADING) {
      if (start === -1) start = i;
      else issues.push(issue("E-07", lines[i]!.n, "Second '## English in Action' heading ignored."));
    }
  }
  if (start === -1) return null;
  const out: Line[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (!mask[i] && isTopHeading(lines[i]!.text)) break;
    out.push(lines[i]!);
  }
  return out;
}

function subSections(section: Line[]): { terms: Line[] | null; scenario: Line[] | null } {
  let terms: Line[] | null = null;
  let scenario: Line[] | null = null;
  let current: Line[] | null = null;
  for (const l of section) {
    const t = l.text.trimEnd();
    if (isSubHeading(t) || isTopHeading(t)) {
      if (t === TERMS_HEADING) current = terms = terms ?? [];
      else if (t === SCENARIO_HEADING) current = scenario = scenario ?? [];
      else current = null;
      continue;
    }
    current?.push(l);
  }
  return { terms, scenario };
}

// ---------- public entry points ----------

/** Parses one BIM note (file or paste). */
export function parseNote(text: string, opts: ParseOptions): ParsedNote {
  const issues: Issue[] = [];
  const all: Line[] = splitLines(text).map((t, i) => ({ n: i + 1, text: t }));
  const { body, created } = stripFrontMatter(all);
  if (!created && opts.mode === "file") issues.push(issue("W-01", null, "Missing or invalid Created; import date used."));
  const createdDate = created ?? opts.today;

  let section = findSection(body, issues);
  const hasSection = section !== null;
  if (!section) {
    if (opts.mode === "file") {
      issues.push(issue("W-07", null, "No '## English in Action' section."));
      return { source: opts.source, createdDate, hasSection, terms: [], scenario: null, issues };
    }
    section = body; // paste without heading: whole text is the section (§5.3 rule 6)
  }

  let { terms: termLines, scenario: scenarioLines } = subSections(section);
  if (!termLines && !scenarioLines) {
    // Paste without sub-headings: terms are "- " lines, scenario starts at the Context line.
    const ctxIdx = section.findIndex((l) => CONTEXT_RE.test(l.text.trim()));
    termLines = section.filter((l, i) => (ctxIdx === -1 || i < ctxIdx) && l.text.trim().startsWith("- "));
    scenarioLines = ctxIdx === -1 ? null : section.slice(ctxIdx);
  }

  const blocked = opts.blockedWords ?? [];
  const terms: ParsedTerm[] = [];
  const seen = new Set<string>();
  for (const l of termLines ?? []) {
    const t = l.text.trim();
    if (!t) continue;
    const r = parseTermLine(t, l.n);
    if (r.kind === "none") {
      issues.push(issue("W-08", l.n, "Unrecognised line ignored."));
      continue;
    }
    issues.push(...r.issues);
    if (r.kind !== "term") continue;
    const hits = findBlockedWords(`${r.term.term} ${r.term.meaning} ${r.term.usage}`, blocked);
    if (hits.length) {
      issues.push(issue("E-08", l.n, `Blocked word: ${hits.join(", ")}.`));
      continue;
    }
    if (seen.has(r.term.id)) {
      issues.push(issue("E-05", l.n, `Duplicate ID "${r.term.id}" in this note.`));
      continue;
    }
    seen.add(r.term.id);
    terms.push(r.term);
  }

  let scenario: ParsedScenario | null = null;
  if (scenarioLines) {
    const r = parseScenarioBlock(scenarioLines, `scenario:${slugify(opts.source)}`);
    issues.push(...r.issues);
    if (r.scenario) {
      const allText = [r.scenario.context, ...r.scenario.turns.map((t) => `${t.speaker} ${t.text}`)].join(" ");
      const hits = findBlockedWords(allText, blocked);
      if (hits.length) issues.push(issue("E-08", r.scenario.line, `Blocked word in scenario: ${hits.join(", ")}.`));
      else scenario = r.scenario;
    }
  }

  if (hasSection || opts.mode === "file") {
    if (terms.length < 3 || terms.length > 5) {
      issues.push(issue("W-04", null, `${terms.length} terms found; the Master Prompt expects 3 to 5.`));
    }
  }
  if (scenario) {
    const dialogue = scenario.turns.map((t) => t.text).join(" ");
    for (const t of terms) {
      if (!findCloze(t.term, dialogue)) issues.push(issue("W-05", scenario.line, `"${t.term}" is not used in the scenario.`));
    }
  }

  for (const i of issues) i.source = opts.source;
  return { source: opts.source, createdDate, hasSection, terms, scenario, issues };
}

/** Parses a General English AI reply: term lines anywhere, other lines ignored silently (data-model §6.3). */
export function parseAiReply(text: string, blockedWords: readonly string[] = []): { terms: ParsedTerm[]; issues: Issue[] } {
  const issues: Issue[] = [];
  const terms: ParsedTerm[] = [];
  const seen = new Set<string>();
  splitLines(text).forEach((raw, i) => {
    const r = parseLenientTermLine(raw, i + 1);
    if (r.kind === "none") return;
    issues.push(...r.issues);
    if (r.kind !== "term") return;
    const hits = findBlockedWords(`${r.term.term} ${r.term.meaning} ${r.term.usage}`, blockedWords);
    if (hits.length) {
      issues.push(issue("E-08", i + 1, `Blocked word: ${hits.join(", ")}.`));
      return;
    }
    if (seen.has(r.term.id)) {
      issues.push(issue("E-05", i + 1, `Duplicate "${r.term.term}" in reply.`));
      return;
    }
    seen.add(r.term.id);
    terms.push(r.term);
  });
  return { terms, issues };
}
