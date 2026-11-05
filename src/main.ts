import { registerSW } from "virtual:pwa-register";
import "./styles.css";
import { requestPersistence } from "./platform/platform";
import { startApp } from "./ui/app";
import { h } from "./ui/dom";
import { homeScreen } from "./ui/home";
import { importScreen } from "./ui/import";
import { inboxScreen } from "./ui/inbox";
import { backupScreen, cardsScreen, moreScreen, settingsScreen, statusScreen } from "./ui/more";
import { reviewScreen } from "./ui/review";

startApp({
  home: homeScreen,
  review: reviewScreen,
  inbox: inboxScreen,
  import: importScreen,
  more: moreScreen,
  cards: cardsScreen,
  backup: backupScreen,
  settings: settingsScreen,
  status: statusScreen,
});

void requestPersistence();

// Updates apply only after the user accepts, never in the middle of a session (requirements §9).
const updateSW = registerSW({
  onNeedRefresh() {
    if (location.hash === "#/review") return; // ask again on the next launch
    const bar = h("div", { class: "banner update" },
      h("span", { text: "Update available." }),
      h("button", { class: "btn small primary", text: "Update", attrs: { type: "button" }, on: { click: () => void updateSW(true) } }),
      h("button", { class: "btn small ghost", text: "Later", attrs: { type: "button" }, on: { click: () => bar.remove() } }),
    );
    document.body.append(bar);
  },
});
