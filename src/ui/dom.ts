// Minimal DOM helpers. All text is set with textContent, never innerHTML (architecture §8).

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
  for (const [k, v] of Object.entries(props.attrs ?? {})) el.setAttribute(k, v);
  for (const [k, fn] of Object.entries(props.on ?? {})) if (fn) el.addEventListener(k, fn);
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(typeof c === "string" ? document.createTextNode(c) : c);
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

/** Text that may be Persian or English: the browser picks direction per element. */
export const auto = (text: string, cls = "") => h("p", { class: cls, text, dir: "auto" });

export function toast(msg: string): void {
  const el = h("div", { class: "toast", text: msg, attrs: { role: "status" } });
  document.body.append(el);
  setTimeout(() => el.remove(), 3500);
}

export function field(label: string, input: HTMLElement, hint?: string): HTMLElement {
  return h("label", { class: "field" }, h("span", { class: "field-label", text: label }), input, hint ? h("small", { class: "hint", text: hint, dir: "auto" }) : null);
}
