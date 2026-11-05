// DOM helpers and iOS-style building blocks.
// All dynamic text is set with textContent. innerHTML is used only for the constant icon strings below.

type Child = Node | string | null | undefined | false;

export interface Props {
  class?: string;
  text?: string;
  dir?: "auto" | "rtl" | "ltr";
  attrs?: Record<string, string>;
  on?: Partial<Record<keyof HTMLElementEventMap, (e: Event) => void>>;
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.text !== undefined) el.textContent = props.text;
  if (props.dir) el.dir = props.dir;
  for (const [k, v] of Object.entries(props.attrs ?? {})) {
    // The CSP forbids style attributes (style-src 'self'); CSSOM assignment is allowed.
    if (k === "style") el.style.cssText = v;
    else el.setAttribute(k, v);
  }
  for (const [k, fn] of Object.entries(props.on ?? {})) if (fn) el.addEventListener(k, fn);
  add(el, ...children);
  return el;
}

const real = (c: Child[]) => c.filter((x): x is Node | string => x !== null && x !== undefined && x !== false);

/** append() that skips null/false children (native append would insert the text "null"). */
export function add(el: ParentNode, ...children: Child[]): void {
  el.append(...real(children));
}

/** replaceChildren() that skips null/false children. */
export function set(el: ParentNode, ...children: Child[]): void {
  el.replaceChildren(...real(children));
}

export function button(label: string, onClick: () => void, cls = "btn"): HTMLButtonElement {
  return h("button", { class: cls, text: label, attrs: { type: "button" }, on: { click: () => onClick() } });
}

/** Text that may be Persian or English: direction picked per element. */
export const auto = (text: string, cls = "") => h("p", { class: cls, text, dir: "auto" });
/** Persian text, right to left. */
export const fa = (text: string, cls = "") => h("p", { class: cls, text, dir: "rtl", attrs: { lang: "fa" } });

export function toast(msg: string): void {
  document.querySelector(".toast")?.remove();
  const el = h("div", { class: "toast", text: msg, attrs: { role: "status" } });
  document.body.append(el);
  setTimeout(() => el.remove(), 3200);
}

export function field(label: string, input: HTMLElement, hint?: string): HTMLElement {
  return h("label", { class: "field" }, h("span", { text: label }), input, hint ? h("small", { class: "muted small", text: hint, dir: "auto" }) : null);
}

// ---------- icons (constant strings, stroke style) ----------

const PATHS: Record<string, string> = {
  today: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  practice: '<path d="M4 6.5h11a3 3 0 013 3v4a3 3 0 01-3 3H9l-4 3v-3.2A3 3 0 014 13.5z"/><path d="M18 9.5h1.5a1.5 1.5 0 011.5 1.5v6l-2-1.5"/>',
  inbox: '<path d="M3.5 13.5l2.6-7.2A2 2 0 018 5h8a2 2 0 011.9 1.3l2.6 7.2V18a1.5 1.5 0 01-1.5 1.5H5A1.5 1.5 0 013.5 18z"/><path d="M3.5 13.5H9l1 2h4l1-2h5.5"/>',
  progress: '<path d="M5 20V11M12 20V5M19 20v-6"/>',
  more: '<circle cx="6" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18" cy="12" r="1.4"/>',
  chevron: '<path d="M9 5l7 7-7 7"/>',
  back: '<path d="M15 4l-8 8 8 8"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  sparkle: '<path d="M12 3l1.8 4.6L18 9l-4.2 1.4L12 15l-1.8-4.6L6 9l4.2-1.4z"/><path d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0013 0M12 17.5V21"/>',
  chat: '<path d="M4 6.5h11a3 3 0 013 3v4a3 3 0 01-3 3H9l-4 3v-3.2A3 3 0 014 13.5z"/>',
  pen: '<path d="M4 20l4-1 10-10-3-3L5 16z"/><path d="M13.5 7.5l3 3"/>',
  warn: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.5"/>',
  note: '<path d="M6 3h9l4 4v14H6z"/><path d="M9 11h7M9 15h7"/>',
  loop: '<path d="M4 12a8 8 0 0113.7-5.7L20 8.5M20 4v4.5h-4.5"/><path d="M20 12a8 8 0 01-13.7 5.7L4 15.5M4 20v-4.5h4.5"/>',
  speaker: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9a4 4 0 010 6M18.5 6.5a7.5 7.5 0 010 11"/>',
  download: '<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  cards: '<rect x="3" y="6" width="14" height="13" rx="2"/><path d="M7 3h12a2 2 0 012 2v11"/>',
  import: '<path d="M12 15V3"/><path d="M7 8l5-5 5 5"/><path d="M5 13v6a2 2 0 002 2h10a2 2 0 002-2v-6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5v.5"/>',
  bell: '<path d="M6 16V11a6 6 0 0112 0v5l2 2H4z"/><path d="M10 21h4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
};

export function icon(name: keyof typeof PATHS | string, size = 20): SVGSVGElement {
  const tpl = document.createElement("template");
  tpl.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] ?? ""}</svg>`;
  return tpl.content.firstElementChild as SVGSVGElement;
}

// ---------- iOS-style blocks ----------

export interface RowOpts {
  icon?: string;
  color?: "orange" | "violet" | "teal" | "red" | "blue" | "grey" | "yellow" | "green";
  title: string;
  subtitle?: string;
  value?: string;
  href?: string;
  onClick?: () => void;
  chevron?: boolean;
  trailing?: Node;
  dir?: "auto" | "rtl";
}

export function row(o: RowOpts): HTMLElement {
  const label = h("span", { class: "label" }, h("b", { text: o.title, dir: o.dir }), o.subtitle ? h("small", { text: o.subtitle, dir: "auto" }) : null);
  const kids: Child[] = [
    o.icon ? h("span", { class: `icon ${o.color ?? "grey"}` }, icon(o.icon, 18)) : null,
    label,
    o.value ? h("span", { class: "value", text: o.value }) : null,
    o.trailing ?? null,
    o.chevron !== false && (o.href || o.onClick) ? h("span", { class: "chev" }, icon("chevron", 14)) : null,
  ];
  if (o.href) return h("a", { class: "row", attrs: { href: o.href } }, ...kids);
  if (o.onClick) return h("button", { class: "row", attrs: { type: "button" }, on: { click: () => o.onClick!() } }, ...kids);
  return h("div", { class: "row static" }, ...kids);
}

export const group = (...rows: Child[]) => h("div", { class: "group" }, ...rows);
export const sectionLabel = (text: string) => h("h2", { class: "section-label", text });

export function largeHeader(title: string, eyebrow?: string, trailing?: Node): HTMLElement {
  return h("header", { class: "header" },
    h("div", {}, eyebrow ? h("p", { class: "eyebrow", text: eyebrow }) : null, h("h1", { class: "large-title", text: title })),
    trailing ?? null);
}

export function navBar(backLabel: string, backHref: string, title: string, trailing?: Node): HTMLElement {
  return h("div", { class: "review-top" },
    h("a", { class: "btn ghost", attrs: { href: backHref, style: "padding-left:0" } }, icon("back", 18), backLabel),
    h("span", { class: "title", text: title, attrs: { style: "flex:1;text-align:center;font-size:17px" } }),
    trailing ?? h("span", { attrs: { style: "width:72px" } }));
}

export function segmented<T extends string>(options: [T, string][], value: T, onChange: (v: T) => void): HTMLElement {
  const wrap = h("div", { class: "segmented", attrs: { role: "radiogroup" } });
  const render = (v: T) =>
    set(wrap, ...options.map(([val, label]) =>
      h("button", {
        class: val === v ? "seg active" : "seg",
        text: label,
        attrs: { type: "button", role: "radio", "aria-checked": String(val === v) },
        on: { click: () => { render(val); onChange(val); } },
      })));
  render(value);
  return wrap;
}

export function chips<T extends string>(options: [T, string][], value: T, onChange: (v: T) => void): HTMLElement {
  const wrap = h("div", { class: "chips", attrs: { role: "radiogroup" } });
  const render = (v: T) =>
    set(wrap, ...options.map(([val, label]) =>
      h("button", { class: val === v ? "chip active" : "chip", text: label, attrs: { type: "button", role: "radio", "aria-checked": String(val === v) }, on: { click: () => { render(val); onChange(val); } } })));
  render(value);
  return wrap;
}

export function toggle(checked: boolean, onChange: (v: boolean) => unknown, label: string): HTMLInputElement {
  const c = h("input", { class: "switch", attrs: { type: "checkbox", "aria-label": label } });
  c.checked = checked;
  c.addEventListener("change", () => void onChange(c.checked));
  return c;
}

/** Bottom sheet. Returns a close function. */
export function sheet(...content: Child[]): () => void {
  const panel = h("div", { class: "sheet", attrs: { role: "dialog", "aria-modal": "true" } }, ...content);
  const back = h("div", { class: "backdrop" }, panel);
  const close = () => back.remove();
  back.addEventListener("click", (e) => { if (e.target === back) close(); });
  document.body.append(back);
  return close;
}

export function spinnerLine(text: string): HTMLElement {
  return h("div", { class: "row-btns muted" }, h("span", { class: "spinner" }), h("span", { text }));
}
