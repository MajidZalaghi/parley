import { describe, expect, it } from "vitest";
import { previewReply } from "../src/general/prompt";
import type { InboxEntry } from "../src/model/types";
import { parseAiReply, parseLenientTermLine } from "../src/parser/parse";

const entry = (word: string, slug: string): InboxEntry => ({ inboxId: slug, word, slug, addedAt: "2026-11-05T00:00:00.000Z", status: "waiting" });
const MEANING = "گرفتن"; // Persian text

describe("lenient AI reply lines (the 'no card returned for: grab' case)", () => {
  const variants: [string, string][] = [
    ["no list marker", `\`grab\` | Meaning: ${MEANING} | Usage: "Could you grab the latest model?"`],
    ["dash marker", `- \`grab\` | Meaning: ${MEANING} | Usage: "Could you grab the latest model?"`],
    ["bold term", `- **grab** | Meaning: ${MEANING} | Usage: "Could you grab the latest model?"`],
    ["bold backtick term", `**\`grab\`** | Meaning: ${MEANING} | Usage: "Could you grab the latest model?"`],
    ["plain term", `grab | Meaning: ${MEANING} | Usage: "Could you grab the latest model?"`],
    ["lowercase labels", `- \`grab\` | meaning: ${MEANING} | usage: "Could you grab the latest model?"`],
    ["trailing period after quote", `- \`grab\` | Meaning: ${MEANING} | Usage: "Could you grab the latest model?".`],
    ["curly quotes", `- \`grab\` | Meaning: ${MEANING} | Usage: “Could you grab the latest model?”`],
    ["no quotes", `- \`grab\` | Meaning: ${MEANING} | Usage: Could you grab the latest model?`],
    ["numbered", `1. \`grab\` | Meaning: ${MEANING} | Usage: "Could you grab the latest model?"`],
  ];
  for (const [name, line] of variants) {
    it(`reads: ${name}`, () => {
      const r = parseLenientTermLine(line, 1);
      expect(r.kind).toBe("term");
      if (r.kind === "term") {
        expect(r.term.id).toBe("grab");
        expect(r.term.usage).toBe("Could you grab the latest model?");
        expect(r.term.clozeOk).toBe(true);
      }
    });
  }

  it("matches the waiting word and ignores chatter and code fences", () => {
    const reply = ["Sure, here is your card:", "```", `grab | Meaning: ${MEANING} | Usage: "Please grab the file."`, "```", "Let me know!"].join("\n");
    const p = previewReply(reply, [entry("grab", "grab")], []);
    expect(p.matched).toHaveLength(1);
    expect(p.missing).toHaveLength(0);
  });

  it("still reports a line with both labels but a broken shape", () => {
    const r = parseAiReply("grab - Meaning: x - Usage: y", []);
    expect(r.terms).toHaveLength(0);
    expect(r.issues.map((i) => i.code)).toContain("E-01");
  });
});
