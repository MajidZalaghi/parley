// App shell and hash router.

import { h } from "./dom";

export type ScreenName = "home" | "review" | "inbox" | "import" | "cards" | "backup" | "settings" | "status" | "more";
export type Screen = (root: HTMLElement, go: (s: ScreenName) => void) => Promise<void> | void;

const TABS: { name: ScreenName; label: string }[] = [
  { name: "home", label: "Home" },
  { name: "inbox", label: "Inbox" },
  { name: "import", label: "Import" },
  { name: "more", label: "More" },
];

export function startApp(screens: Record<ScreenName, Screen>): void {
  const main = h("main", { class: "screen", attrs: { id: "screen" } });
  const tabs = h("nav", { class: "tabs", attrs: { "aria-label": "Sections" } });
  document.getElementById("app")!.replaceChildren(main, tabs);

  const go = (s: ScreenName) => {
    if (location.hash !== `#/${s}`) location.hash = `#/${s}`;
    else void render();
  };

  async function render() {
    const name = (location.hash.replace(/^#\//, "") || "home") as ScreenName;
    const screen = screens[name] ?? screens.home;
    tabs.replaceChildren(
      ...TABS.map((t) =>
        h("a", {
          class: `tab${t.name === name || (t.name === "more" && ["cards", "backup", "settings", "status", "more"].includes(name)) ? " active" : ""}`,
          text: t.label,
          attrs: { href: `#/${t.name}` },
        }),
      ),
    );
    tabs.hidden = name === "review";
    main.replaceChildren();
    window.scrollTo(0, 0);
    try {
      await screen(main, go);
    } catch (e) {
      main.replaceChildren(h("p", { class: "error", text: `Something went wrong: ${(e as Error).message}` }));
    }
  }

  window.addEventListener("hashchange", () => void render());
  void render();
}
