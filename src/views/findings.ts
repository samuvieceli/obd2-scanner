// Renders interpretation findings (shared by dashboard and report).
import type { Finding } from "../api";
import { t } from "../i18n";
import { h } from "../ui";

/** `mixture_lean_b1` -> text of `findings.mixture_lean` with bank 1. */
export function findingText(f: Finding): string {
  const m = /^(.*)_b([12])$/.exec(f.id);
  const id = m ? m[1] : f.id;
  const params: Record<string, string | number> = { ...f.values };
  if (m) params.bank = m[2];
  return t(`findings.${id}`, params);
}

export function findingList(list: Finding[]): HTMLElement {
  if (!list.length) return h("p", { class: "muted" }, t("dashboard.findingsEmpty"));
  return h(
    "ul",
    { class: "findings" },
    list.map((f) => h("li", { class: `finding sev-${f.severity}` }, h("span", { class: "sev-dot", "aria-hidden": "true" }), findingText(f))),
  );
}
