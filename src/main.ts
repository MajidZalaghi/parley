import { registerSW } from "virtual:pwa-register";
import "./styles.css";
import { requestPersistence } from "./platform/platform";
import { parseHash, startApp } from "./ui/app";
import { interviewScreen, scenarioScreen, speakScreen } from "./ui/coach";
import { h } from "./ui/dom";
import { todayScreen } from "./ui/home";
import { importScreen } from "./ui/import";
import { inboxScreen } from "./ui/inbox";
import { backupScreen, cardsScreen, categoriesScreen, moreScreen, reminderScreen, settingsScreen, statusScreen } from "./ui/more";
import { waitingScreen } from "./ui/waiting";
import { notesScreen, practiceScreen } from "./ui/practice";
import { progressScreen } from "./ui/progress";
import { reviewScreen } from "./ui/review";

// Old links (#/home) keep working.
if (location.hash === "#/home") location.hash = "#/today";

startApp({
  today: todayScreen,
  practice: practiceScreen,
  inbox: inboxScreen,
  progress: progressScreen,
  more: moreScreen,
  review: reviewScreen,
  cards: cardsScreen,
  backup: backupScreen,
  settings: settingsScreen,
  status: statusScreen,
  import: importScreen,
  interview: interviewScreen,
  scenario: scenarioScreen,
  speak: speakScreen,
  reminder: reminderScreen,
  notes: notesScreen,
  waiting: waitingScreen,
  categories: categoriesScreen,
});

void requestPersistence();

// Updates apply only after the user accepts, never in the middle of a session (requirements §9).
const updateSW = registerSW({
  onNeedRefresh() {
    if (parseHash().name === "review") return; // ask again on the next launch
    const bar = h("div", { class: "glass banner", attrs: { style: "position:fixed;left:12px;right:12px;bottom:calc(env(safe-area-inset-bottom) + 90px);max-width:536px;margin:0 auto;z-index:15;padding:14px" } },
      h("span", { text: "Update available.", attrs: { style: "flex:1" } }),
      h("button", { class: "btn small primary", text: "Update", attrs: { type: "button" }, on: { click: () => void updateSW(true) } }),
      h("button", { class: "btn small", text: "Later", attrs: { type: "button" }, on: { click: () => bar.remove() } }),
    );
    document.body.append(bar);
  },
});
