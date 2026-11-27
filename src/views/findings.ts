// Renders interpretation findings (shared by dashboard and report).
import type { Finding } from "../api";
import { t } from "../i18n";
import { state } from "../store";
import { h } from "../ui";
import { displayUnit, toDisplay } from "../units";

/** `mixture_lean_b1` -> text of `findings.mixture_lean` with bank 1. */
export function findingText(f: Finding): string {
  const m = /^(.*)_b([12])$/.exec(f.id);
  const id = m ? m[1] : f.id;
  const params: Record<string, string | number> = { ...f.values };
  if (m) params.bank = m[2];
  let text = t(`findings.${id}`, params);
  // Temperatures are written "{value} °C" in the texts.
  if (displayUnit("°C") !== "°C" && text.includes("°C") && typeof f.values.value === "number") {
    text = t(`findings.${id}`, { ...params, value: Math.round(toDisplay("°C", f.values.value)) }).replaceAll("°C", displayUnit("°C"));
  }
  return text;
}

export function findingList(list: Finding[]): HTMLElement {
  if (!list.length) {
    // Reading with nothing unusual is not the same as not reading yet.
    const reading = Object.keys(state.latest).length > 0;
    return h("p", { class: "muted" }, t(reading ? "dashboard.findingsNormal" : "dashboard.findingsEmpty"));
  }
  return h(
    "ul",
    { class: "findings" },
    list.map((f) => h("li", { class: `finding sev-${f.severity}` }, h("span", { class: "sev-dot", "aria-hidden": "true" }), findingText(f))),
  );
}
