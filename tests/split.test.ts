import { describe, expect, it } from "vitest";
import { splitNotes } from "../src/bim/split";
import { parseNote } from "../src/parser/parse";

const note = (title: string, term: string) => `# ${title}

## English in Action

### Power Collocations & Terms
- \`${term}\` | Meaning: test | Usage: "We discussed the ${term} today."

### Meeting Scenario
> [!quote] Context: test
> **Lead:** "Any news?"
> **You (Senior BIM Coordinator):** "Yes, the ${term}."
`;

describe("multi-note pack files", () => {
  const pack = `---\nCreated: 2026-11-05\n---\n\n${note("Clash Detection", "hard clash")}\n${note("Model Drops", "model audit")}`;

  it("splits into one note per heading, keeping Created", () => {
    const parts = splitNotes(pack, "pack");
    expect(parts.map((p) => p.source)).toEqual(["Clash Detection", "Model Drops"]);
    const r = parseNote(parts[1]!.text, { source: parts[1]!.source, mode: "file", today: "2026-12-01" });
    expect(r.createdDate).toBe("2026-11-05");
    expect(r.terms.map((t) => t.id)).toEqual(["model-audit"]);
    expect(r.scenario?.id).toBe("scenario:model-drops");
  });

  it("leaves a normal single note unchanged", () => {
    const one = note("Only One", "hard clash");
    expect(splitNotes(one, "Only One file")).toEqual([{ source: "Only One file", text: one }]);
    expect(splitNotes("## English in Action\n- x", "f")).toHaveLength(1);
  });

  it("ignores headings inside code fences", () => {
    const text = `${note("Real", "hard clash")}\n\`\`\`\n# Fake\n## English in Action\n\`\`\`\n`;
    expect(splitNotes(text, "f")).toHaveLength(1);
  });
});
