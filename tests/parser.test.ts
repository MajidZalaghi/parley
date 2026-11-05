import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseAiReply, parseNote, parseTermLine } from "../src/parser/parse";
import { findCloze, slugify } from "../src/parser/text";

const ifc = readFileSync(new URL("./fixtures/ifc-note.md", import.meta.url), "utf8");
const opts = { source: "Industry Foundation Classes (IFC)", mode: "file" as const, today: "2026-11-05" };
const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

describe("slugify", () => {
  it.each([
    ["vendor-neutral", "vendor-neutral"],
    ["fit for purpose", "fit-for-purpose"],
    ["IFC export mapping", "ifc-export-mapping"],
    ["take (something) on board", "take-something-on-board"],
    ["café", "cafe"],
    ["C++", "c"],
    ["clash/issue", "clash-issue"],
    ["+++", ""],
    ["Industry Foundation Classes (IFC)", "industry-foundation-classes-ifc"],
  ])("%s -> %s", (input, out) => expect(slugify(input)).toBe(out));
});

describe("IFC sample note (AC-01)", () => {
  const r = parseNote(ifc, opts);

  it("imports the five terms and one scenario with the expected IDs", () => {
    expect(r.terms.map((t) => t.id)).toEqual([
      "vendor-neutral", "export-mapping", "schema-version", "fit-for-purpose", "model-drop",
    ]);
    expect(r.scenario?.id).toBe("scenario:industry-foundation-classes-ifc");
  });

  it("reads Created and ignores code fences", () => {
    expect(r.createdDate).toBe("2026-11-04");
    expect(r.terms.some((t) => t.id === "fake-term")).toBe(false);
  });

  it("parses the scenario turns with free speaker names", () => {
    expect(r.scenario?.turns).toHaveLength(4);
    expect(r.scenario?.turns[0]).toMatchObject({ speaker: "Structural Lead", isYou: false });
    expect(r.scenario?.turns[1]?.isYou).toBe(true);
  });

  it("keeps Persian text including ZWNJ", () => {
    expect(r.terms[0]?.meaning).toContain("نرم‌افزار");
  });

  it("has no errors, and stores no text from other sections (AC-06)", () => {
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(JSON.stringify(r)).not.toContain("SENTINEL");
  });

  it("all terms allow cloze, and all appear in the dialogue except vendor-neutral (W-05)", () => {
    expect(r.terms.every((t) => t.clozeOk)).toBe(true);
    const w05 = r.issues.filter((i) => i.code === "W-05").map((i) => i.message);
    expect(w05).toHaveLength(1);
    expect(w05[0]).toContain("vendor-neutral");
  });
});

describe("paste import (AC-02)", () => {
  const section = ifc.slice(ifc.indexOf("## English in Action\n\n###"));
  it("gives the same IDs with the heading", () => {
    const r = parseNote(section, { ...opts, mode: "paste" });
    expect(r.terms.map((t) => t.id)).toHaveLength(5);
    expect(r.scenario).not.toBeNull();
    expect(r.createdDate).toBe("2026-11-05");
  });
  it("gives the same IDs without any heading", () => {
    const bare = section.split("\n").filter((l) => !l.startsWith("#")).join("\n");
    const r = parseNote(bare, { ...opts, mode: "paste" });
    expect(r.terms.map((t) => t.id)).toEqual([
      "vendor-neutral", "export-mapping", "schema-version", "fit-for-purpose", "model-drop",
    ]);
    expect(r.scenario?.turns).toHaveLength(4);
  });
});

describe("invalid-line handling (data-model §5.6, AC-04)", () => {
  const note = (terms: string, extra = "") =>
    `---\nCreated: 2026-01-02\n---\n## English in Action\n### Power Collocations & Terms\n${terms}\n${extra}`;

  it("E-01 for a line that does not match", () => {
    const r = parseNote(note("- `term` | Meaning: x"), opts);
    expect(codes(r.issues)).toContain("E-01");
  });
  it("E-02 for a missing closing quote", () => {
    const r = parseNote(note('- `term` | Meaning: x | Usage: "no close'), opts);
    expect(codes(r.issues)).toContain("E-02");
  });
  it("E-03 for an empty meaning or usage", () => {
    expect(codes(parseNote(note('- `term` | Meaning:  | Usage: "a term b"'), opts).issues)).toContain("E-03");
    expect(codes(parseNote(note('- `term` | Meaning: x | Usage: ""'), opts).issues)).toContain("E-03");
  });
  it("E-04 for an empty slug", () => {
    expect(codes(parseNote(note('- `+++` | Meaning: x | Usage: "+++ here"'), opts).issues)).toContain("E-04");
  });
  it("E-05 for a duplicate ID in one note", () => {
    const line = '- `a b` | Meaning: x | Usage: "a b here"';
    const r = parseNote(note(`${line}\n- \`A  B\` | Meaning: y | Usage: "A B there"`), opts);
    expect(codes(r.issues)).toContain("E-05");
    expect(r.terms).toHaveLength(1);
  });
  it("E-06 for a scenario without a You turn", () => {
    const sc = '### Meeting Scenario\n> [!quote] Context: c\n> **Lead:** "hi"';
    const r = parseNote(note('- `a` | Meaning: x | Usage: "a"', sc), opts);
    expect(codes(r.issues)).toContain("E-06");
    expect(r.scenario).toBeNull();
  });
  it("E-07 for a second section heading", () => {
    const r = parseNote(note('- `a` | Meaning: x | Usage: "a"', "## Other\n## English in Action\n"), opts);
    expect(codes(r.issues)).toContain("E-07");
  });
  it("E-08 for a blocked word", () => {
    const r = parseNote(note('- `a` | Meaning: x | Usage: "a for AcmeCorp"'), { ...opts, blockedWords: ["acmecorp"] });
    expect(codes(r.issues)).toContain("E-08");
    expect(r.terms).toHaveLength(0);
  });
  it("W-01 for missing Created", () => {
    const r = parseNote('## English in Action\n### Power Collocations & Terms\n- `a` | Meaning: x | Usage: "a"', opts);
    expect(codes(r.issues)).toContain("W-01");
    expect(r.createdDate).toBe("2026-11-05");
  });
  it("W-02 for curly quotes", () => {
    const r = parseNote(note("- `a` | Meaning: x | Usage: “a thing”"), opts);
    expect(codes(r.issues)).toContain("W-02");
    expect(r.terms[0]?.usage).toBe("a thing");
  });
  it("W-03 when the term is not in its usage", () => {
    const r = parseNote(note('- `model drop` | Meaning: x | Usage: "Nothing here."'), opts);
    expect(codes(r.issues)).toContain("W-03");
    expect(r.terms[0]?.clozeOk).toBe(false);
  });
  it("W-04 for fewer than 3 terms", () => {
    expect(codes(parseNote(note('- `a` | Meaning: x | Usage: "a"'), opts).issues)).toContain("W-04");
  });
  it("W-07 when the section is missing", () => {
    expect(codes(parseNote("# Title\nNo section", opts).issues)).toContain("W-07");
  });
  it("W-08 for an unrecognised line", () => {
    const r = parseNote(note('- `a` | Meaning: x | Usage: "a"\nsome stray text'), opts);
    expect(codes(r.issues)).toContain("W-08");
  });
  it("keeps going after a bad line", () => {
    const r = parseNote(note('- bad line\n- `b` | Meaning: y | Usage: "b ok"'), opts);
    expect(r.terms.map((t) => t.id)).toEqual(["b"]);
  });
  it("allows | inside the meaning and backticks", () => {
    const r = parseTermLine('- `x` | Meaning: a | b `IFC` | Usage: "x here"', 1);
    expect(r.kind).toBe("term");
    if (r.kind === "term") expect(r.term.meaning).toBe("a | b `IFC`");
  });
});

describe("cloze matching", () => {
  it("matches inflected endings", () => {
    expect(findCloze("model drop", "Two model drops a week.")?.matched).toBe("model drops");
    expect(findCloze("federate", "we federated it")?.matched).toBe("federated");
    expect(findCloze("federate", "we are federating it")?.matched).toBe("federating");
    expect(findCloze("export mapping", "your IFC Export Mapping before")?.matched).toBe("Export Mapping");
  });
  it("does not match inside other words", () => {
    expect(findCloze("cat", "concatenate")).toBeNull();
  });
});

describe("AI reply parsing (data-model §6.3)", () => {
  it("reads term lines anywhere, accepts * and 1. markers, ignores chatter", () => {
    const reply = [
      "Sure! Here are your cards:",
      '- `take something on board` | Meaning: پذیرفتن پیشنهاد | Usage: "We will take your comments on board."',
      '* `push back` | Meaning: مخالفت کردن | Usage: "The contractor may push back on the dates."',
      '2. `follow up` | Meaning: پیگیری | Usage: "I will follow up after the meeting."',
      "- `broken` | Meaning: x",
      "Hope this helps!",
    ].join("\n");
    const r = parseAiReply(reply);
    expect(r.terms.map((t) => t.id)).toEqual(["take-something-on-board", "push-back", "follow-up"]);
    expect(codes(r.issues)).toContain("W-09");
    expect(codes(r.issues)).toContain("E-01");
    expect(codes(r.issues)).toContain("W-03"); // "take something on board" vs "take your comments on board"
  });
});
