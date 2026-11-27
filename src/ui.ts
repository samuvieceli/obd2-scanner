// Small DOM helpers shared by the screens.
import { warmState } from "./warmup";
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

/** Gap kept between a tooltip and the window edges or its icon, in px. */
const TIP_MARGIN = 8;

/**
 * Shows the text of any `.tip` icon in one shared bubble attached to the page
 * body. The bubble opens below the icon (above when there is no room), is
 * centred on it and pushed back inside the window, so it is never cut by a
 * card, the sidebar or a scrolling area. Called once at start-up.
 */
export function installTooltips() {
  const bubble = h("div", { class: "tip-bubble", role: "tooltip", "aria-hidden": "true", hidden: true });
  document.body.append(bubble);
  let current: HTMLElement | null = null;

  const hide = () => {
    current = null;
    bubble.hidden = true;
  };
  const show = (tip: HTMLElement) => {
    current = tip;
    bubble.textContent = tip.dataset.tip ?? "";
    bubble.hidden = false;
    const icon = tip.getBoundingClientRect();
    const { width, height } = bubble.getBoundingClientRect();
    const maxLeft = window.innerWidth - width - TIP_MARGIN;
    const left = Math.max(TIP_MARGIN, Math.min(icon.left + icon.width / 2 - width / 2, maxLeft));
    const below = icon.bottom + TIP_MARGIN;
    const fitsBelow = below + height <= window.innerHeight - TIP_MARGIN;
    const top = fitsBelow ? below : Math.max(TIP_MARGIN, icon.top - TIP_MARGIN - height);
    bubble.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  };
  const tipOf = (e: Event) => (e.target as Element | null)?.closest?.<HTMLElement>(".tip") ?? null;

  document.addEventListener("mouseover", (e) => {
    const tip = tipOf(e);
    if (tip && tip !== current) show(tip);
  });
  document.addEventListener("mouseout", (e) => {
    const into = (e as MouseEvent).relatedTarget as Element | null;
    if (current && tipOf(e) === current && !current.contains(into)) {
      if (document.activeElement === current) return;
      hide();
    }
  });
  document.addEventListener("focusin", (e) => {
    const tip = tipOf(e);
    if (tip) show(tip);
  });
  document.addEventListener("focusout", (e) => {
    if (tipOf(e) === current) hide();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && current) hide();
  });
  // The icon moved (scrolling, resizing; also when focus scrolls it into
  // view): follow it. It disappeared (screen change): close.
  const follow = () => current && show(current);
  document.addEventListener("scroll", follow, true);
  window.addEventListener("resize", follow);
  new MutationObserver(() => {
    if (current && !current.isConnected) hide();
  }).observe(document.body, { childList: true, subtree: true });
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

/** Badge "engine cold / warming up / ready" from the newest temperatures. */
export function warmBadge(el: HTMLElement, state_: { latest: Record<string, number> }) {
  const st = warmState(state_.latest.coolant_temp, state_.latest.oil_temp);
  el.hidden = !st;
  if (!st) return;
  el.classList.remove("warm-cold", "warm-warming", "warm-ready");
  el.classList.add(`warm-${st}`);
  el.textContent = t(`warmup.${st}`);
  el.title = t(`warmup.${st}Help`);
}
