// App shell: hash router and the floating glass tab bar.

import { db } from "../store/db";
import { h, icon, set } from "./dom";

export type ScreenName =
  | "today" | "practice" | "inbox" | "progress" | "more"
  | "review" | "cards" | "backup" | "settings" | "status" | "import"
  | "interview" | "scenario" | "speak" | "reminder" | "notes";
export type Go = (s: ScreenName, query?: Record<string, string>) => void;
export type Screen = (root: HTMLElement, go: Go, query: URLSearchParams) => Promise<void> | void;

const TABS: { name: ScreenName; label: string; icon: string; owns: ScreenName[] }[] = [
  { name: "today", label: "Today", icon: "today", owns: [] },
  { name: "practice", label: "Practice", icon: "practice", owns: ["interview", "scenario", "speak", "notes"] },
  { name: "inbox", label: "Inbox", icon: "inbox", owns: [] },
  { name: "progress", label: "Progress", icon: "progress", owns: [] },
  { name: "more", label: "More", icon: "more", owns: ["cards", "backup", "settings", "status", "import", "reminder"] },
];
const FULL_SCREEN: ScreenName[] = ["review"];
const AI_SCREENS: ScreenName[] = ["practice", "interview", "scenario", "speak"];

export function parseHash(): { name: ScreenName; query: URLSearchParams } {
  const raw = location.hash.replace(/^#\//, "");
  const [name, q] = raw.split("?");
  return { name: ((name || "today") as ScreenName), query: new URLSearchParams(q ?? "") };
}

export function startApp(screens: Record<ScreenName, Screen>): void {
  const main = h("main", { class: "screen", attrs: { id: "screen" } });
  const tabs = h("nav", { class: "tabbar", attrs: { "aria-label": "Sections" } });
  document.getElementById("app")!.replaceChildren(main, tabs);

  const go: Go = (s, query) => {
    const hash = `#/${s}${query ? `?${new URLSearchParams(query).toString()}` : ""}`;
    if (location.hash !== hash) location.hash = hash;
    else void render();
  };

  async function render() {
    document.querySelectorAll(".backdrop").forEach((b) => b.remove()); // sheets never outlive their screen
    const { name, query } = parseHash();
    const screen = screens[name] ?? screens.today;
    const full = FULL_SCREEN.includes(name);
    tabs.hidden = full;
    main.className = full ? "screen full" : "screen";
    document.body.classList.toggle("ai", AI_SCREENS.includes(name));
    const inboxCount = (await (await db()).getAll("inbox")).filter((e) => e.status === "waiting").length;
    set(tabs, ...TABS.map((t) => {
      const active = t.name === name || t.owns.includes(name);
      return h("a", { class: `tab${active ? " active" : ""}`, attrs: { href: `#/${t.name}`, ...(active ? { "aria-current": "page" } : {}) } },
        icon(t.icon, 24), t.label,
        t.name === "inbox" && inboxCount ? h("span", { class: "dot", text: String(inboxCount) }) : null);
    }));
    main.replaceChildren();
    window.scrollTo(0, 0);
    try {
      await screen(main, go, query);
    } catch (e) {
      main.replaceChildren(h("p", { class: "error", text: `Something went wrong: ${(e as Error).message}` }));
    }
  }

  window.addEventListener("hashchange", () => void render());
  void render();
}
