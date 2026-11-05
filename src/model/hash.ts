// SHA-256 helpers (data-model §2.1, §8.1). Uses Web Crypto, available in browsers and Node 18+.

export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

import type { Card } from "./types";

/** Content hash over the fields that define what is studied; metadata is excluded. */
export function contentHashOf(c: Pick<Card, "deck" | "kind" | "term" | "meaning" | "usage" | "context" | "turns" | "archived">): Promise<string> {
  return sha256Hex(
    JSON.stringify([c.deck, c.kind, c.term ?? null, c.meaning ?? null, c.usage ?? null, c.context ?? null, c.turns ?? null, c.archived]),
  );
}
