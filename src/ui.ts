// Small DOM helpers shared by the screens.
import { fmtNum, pidText, t } from "./i18n";
import type { CmdError } from "./api";
import { meta } from "./store";
import { displayUnit, extraDecimals, toDisplay } from "./units";

type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, unknown>;

/** `h("button", { class: "btn", onclick: f }, "Text")` */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs | null,
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith("on") && typeof v === "function") {
        el.addEventListener(k.slice(2), v as EventListener);
      } else if (k === "class") {
        el.className = String(v);
      } else if (k === "html") {
        el.innerHTML = String(v);
      } else if (k in el && typeof v !== "string") {
        (el as unknown as Record<string, unknown>)[k] = v;
      } else {
        el.setAttribute(k, v === true ? "" : String(v));
      }
    }
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el: HTMLElement) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function errorText(e: unknown): string {
  if (e && typeof e === "object" && "code" in e) {
    const err = e as CmdError;
    const txt = t(`errors.${err.code}`, { message: err.message });
    return txt.startsWith("errors.") ? err.message : txt;
  }
  if (typeof e === "string") return e;
  return String(e);
}

let toastBox: HTMLElement | null = null;

export function toast(message: string, kind: "info" | "ok" | "error" = "info") {
  if (!toastBox) {
    toastBox = h("div", { class: "toasts", role: "status", "aria-live": "polite" });
    document.body.append(toastBox);
  }
  const el = h("div", { class: `toast toast-${kind}` }, message);
  toastBox.append(el);
  setTimeout(() => el.classList.add("hide"), kind === "error" ? 7000 : 4000);
  setTimeout(() => el.remove(), kind === "error" ? 7600 : 4600);
}

/** Small "i" bubble showing an explanation on hover/focus. */
export function infoTip(text: string): HTMLElement {
  return h("span", { class: "tip", tabindex: 0, "data-tip": text, "aria-label": text }, "i");
}

export function pidTip(key: string): HTMLElement {
  const p = pidText(key);
  const typical = p.typical && p.typical !== "—" ? `\n${t("glossary.typical")}: ${p.typical}` : "";
  return infoTip(`${p.desc}${typical}`);
}

/** Metric unit of a parameter, as decoded from the car. */
export function baseUnitOf(key: string): string {
  return meta(key)?.unit ?? (key === "battery_voltage" ? "V" : "");
}

/** Unit shown on screen, after the user's unit choice. */
export function unitOf(key: string): string {
  return displayUnit(baseUnitOf(key));
}

/** Value converted to the unit shown on screen. */
export function displayValue(key: string, v: number): number {
  return toDisplay(baseUnitOf(key), v);
}

export function decimalsFor(key: string): number {
  const unit = baseUnitOf(key);
  let d = 1;
  if (key === "rpm" || key === "speed" || key === "run_time") d = 0;
  else if (unit === "V") d = key.startsWith("o2_") ? 3 : 2;
  else if (unit === "λ") d = 3;
  else if (unit === "°C" || unit === "kPa" || unit === "km" || unit === "min" || unit === "") d = 0;
  return d + extraDecimals(unit);
}

/** Formats a value in the unit shown on screen (without the unit). */
export function fmtValue(key: string, v: number | undefined): string {
  if (v === undefined || Number.isNaN(v)) return "—";
  return fmtNum(displayValue(key, v), decimalsFor(key));
}

export function button(
  label: string,
  onclick: (ev: MouseEvent) => unknown,
  variant: "primary" | "secondary" | "danger" | "ghost" = "secondary",
  extra: Attrs = {},
): HTMLButtonElement {
  return h("button", { class: `btn btn-${variant}`, type: "button", onclick, ...extra }, label);
}

/** Runs an async action with the button disabled and a busy label. */
export async function busy<T>(btn: HTMLButtonElement, action: () => Promise<T>): Promise<T | undefined> {
  const label = btn.textContent;
  btn.disabled = true;
  btn.classList.add("busy");
  btn.textContent = t("common.loading");
  try {
    return await action();
  } catch (e) {
    toast(errorText(e), "error");
    return undefined;
  } finally {
    btn.disabled = false;
    btn.classList.remove("busy");
    btn.textContent = label;
  }
}

export function notConnected(): HTMLElement {
  return h(
    "div",
    { class: "empty" },
    h("p", null, t("common.notConnected")),
    h("a", { class: "btn btn-primary", href: "#/connection" }, t("common.goToConnection")),
  );
}

export function section(title: string, ...children: (Child | Child[])[]): HTMLElement {
  return h("section", { class: "card" }, h("h2", null, title), ...children);
}

export function timestampForFile(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
