import { describe, expect, it } from "vitest";
import { parseWordList } from "../src/general/wordlist";

const none = new Set<string>();

describe("word list import", () => {
  it("reads plain, bulleted and numbered lines", () => {
    const r = parseWordList("push back\n- follow up\n3. touch base\n`take on board`\n", none, []);
    expect(r.entries.map((e) => e.word)).toEqual(["push back", "follow up", "touch base", "take on board"]);
    expect(r.entries.map((e) => e.slug)).toEqual(["push-back", "follow-up", "touch-base", "take-on-board"]);
    expect(r.skipped).toEqual([]);
  });

  it("takes text after | , a tab or ; as the seen-in sentence", () => {
    const r = parseWordList("push back | They may push back on dates.\nfollow up\tI will follow up.\ncircle back;Let us circle back", none, []);
    expect(r.entries.map((e) => e.seenIn)).toEqual(["They may push back on dates.", "I will follow up.", "Let us circle back"]);
  });

  it("skips a CSV header, blanks, repeats and known words, with reasons", () => {
    const r = parseWordList("Words\npush back\n\nPush  Back\nfollow up\n", new Set(["follow-up"]), []);
    expect(r.entries.map((e) => e.slug)).toEqual(["push-back"]);
    expect(r.skipped.map((s) => s.reason)).toEqual(["repeated in this list", "already a card or in the Inbox"]);
  });

  it("skips blocked words, symbol-only lines and long sentences", () => {
    const long = "this is clearly a whole sentence copied from a document and not a single word or phrase at all";
    const r = parseWordList(`visit AcmeCorp site\n+++\n${long}\nok term`, none, ["acmecorp"]);
    expect(r.entries.map((e) => e.word)).toEqual(["ok term"]);
    expect(r.skipped.map((s) => s.line)).toEqual([1, 2, 3]);
    expect(r.skipped[0]!.reason).toContain("blocked");
  });

  it("handles Windows line endings and a BOM", () => {
    const r = parseWordList("﻿push back\r\nfollow up\r\n", none, []);
    expect(r.entries.map((e) => e.word)).toEqual(["push back", "follow up"]);
  });
});
