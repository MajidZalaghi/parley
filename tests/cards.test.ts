import { describe, expect, it } from "vitest";
import { buildPrompt, DEFAULT_PROMPT_TEMPLATE, previewReply } from "../src/general/prompt";
import type { Card, InboxEntry } from "../src/model/types";
import { categoryOf } from "../src/model/types";
import { parseCardLine } from "../src/parser/parse";
import { findCloze } from "../src/parser/text";
import { modesFor } from "../src/review/queue";

const FA = "سریع برداشتن";

describe("universal card line (Gemini, Qwen, any chat)", () => {
  it("reads all five fields", () => {
    const r = parseCardLine(`- \`grab\` | Definition: to take something quickly | IPA: /ɡræb/ | Example: "Could you grab the latest model?" | Meaning: ${FA}`, 1);
    expect(r.kind).toBe("term");
    if (r.kind !== "term") return;
    expect(r.term).toMatchObject({ id: "grab", term: "grab", definition: "to take something quickly", ipa: "/ɡræb/", usage: "Could you grab the latest model?", meaning: FA, clozeOk: true });
  });

  it("accepts any field order, no marker, IPA without slashes, no Persian", () => {
    const r = parseCardLine('**float** | Example: "We still have two weeks of float on this activity." | IPA: fləʊt | Definition: spare time before a task delays the project', 3);
    expect(r.kind).toBe("term");
    if (r.kind !== "term") return;
    expect(r.term.ipa).toBe("/fləʊt/");
    expect(r.term.meaning).toBe("");
    expect(r.term.definition).toContain("spare time");
  });

  it("still reads the earlier Meaning | Usage line", () => {
    const r = parseCardLine(`- \`grab\` | Meaning: ${FA} | Usage: "Please grab the file."`, 1);
    expect(r.kind === "term" && r.term.usage).toBe("Please grab the file.");
  });

  it("needs an example and a definition or meaning", () => {
    expect(parseCardLine("- `grab` | Definition: to take", 1).kind).toBe("error");
    expect(parseCardLine('- `grab` | IPA: /ɡræb/ | Example: "grab it"', 1).kind).toBe("error");
    expect(parseCardLine("Sure, here you go!", 1).kind).toBe("none");
  });

  it("prompt carries the category and the example line", () => {
    const e: InboxEntry = { inboxId: "1", word: "float", slug: "float", category: "Project Controls", addedAt: "", status: "waiting" };
    const p = buildPrompt(DEFAULT_PROMPT_TEMPLATE, [e]);
    expect(p).toContain("1. float [Project Controls]");
    expect(p).toContain("| Definition:");
    const reply = '- `float` | Definition: spare time in a schedule | IPA: /fləʊt/ | Example: "The task has five days of float." | Meaning: x';
    expect(previewReply(reply, [e], []).matched).toHaveLength(1);
  });
});

describe("phrases behave like words", () => {
  it("placeholder words match 1 to 3 words, and inflections work", () => {
    expect(findCloze("take something on board", "We will take your comments on board.")?.matched).toBe("take your comments on board");
    expect(findCloze("push back", "They pushed back on the dates.")?.matched).toBe("pushed back");
    expect(findCloze("follow up on sth", "I am following up on the RFI today.")?.matched).toBe("following up on the");
    expect(findCloze("take something on board", "take on board")).toBeNull();
  });
});

describe("modes and categories", () => {
  const base: Card = { id: "x", deck: "general", kind: "term", origin: "user", term: "x", usage: "x here", meaning: "", source: "s", otherSources: [], createdDate: "2026-11-06", contentHash: "h", updatedAt: "", baseHash: null, archived: false, extraUsages: [] };
  it("reverse needs a definition or meaning; cloze needs the word in the example", () => {
    expect(modesFor(base, ["flashcard", "reverse", "cloze"])).toEqual(["flashcard", "cloze"]);
    expect(modesFor({ ...base, definition: "d", clozeOk: false }, ["flashcard", "reverse", "cloze"])).toEqual(["flashcard", "reverse"]);
  });
  it("old cards get a category from their section", () => {
    expect(categoryOf({ deck: "bim" })).toBe("BIM");
    expect(categoryOf({ deck: "general" })).toBe("General");
    expect(categoryOf({ deck: "bim", category: "Contracts" })).toBe("Contracts");
  });
});
