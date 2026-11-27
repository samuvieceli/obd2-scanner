// "Abasteci" window: asks the litres the pump showed, shows what the program
// calculated since "Tanque cheio" and applies the pump calibration (refuel.ts).
import { fmtNum, t } from "../i18n";
import { button, h, toast } from "../ui";
import { displayUnit, toDisplay } from "../units";
import { MIN_CALC_L, MIN_KM, type FillResult } from "../refuel";
import { correction, fillTracker, finishFill } from "../trip";
import { profile } from "../prefs";

let open: HTMLElement | null = null;

function close() {
  open?.remove();
  open = null;
}

function resultText(r: FillResult): string {
  const vars = { pump: fmtNum(r.pumpL, 1), calc: fmtNum(r.calcL, 1), km: fmtNum(r.distanceKm, 0), pct: fmtNum(r.estimate * 100, 0), minKm: MIN_KM, minL: MIN_CALC_L };
  if (!r.used) return t(`refuel.rejected.${r.reason ?? "short"}`, vars);
  const p = profile();
  return t(`refuel.applied.${r.method}`, { ...vars, now: fmtNum((r.method === "map" ? p.volumetricEff : p.mafFactor) * 100, 0) });
}

export function openRefuelDialog() {
  const f = fillTracker();
  if (!f) return;
  close();
  const calcL = f.baseL * correction(f.method);
  const short = f.distanceKm < MIN_KM || calcL < MIN_CALC_L;
  const input = h("input", { type: "text", inputmode: "decimal", placeholder: "0,0", "aria-label": t("refuel.pumpLitres") }) as HTMLInputElement;
  const confirm = () => {
    const v = Number(input.value.trim().replace(",", "."));
    if (!Number.isFinite(v) || v < 0.5 || v > 200) {
      toast(t("refuel.badLitres"), "error");
      input.focus();
      return;
    }
    const r = finishFill(v);
    close();
    if (r) toast(resultText(r), r.used ? "ok" : "info");
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") confirm();
  });
  const box = h(
    "div",
    {
      class: "overlay",
      role: "dialog",
      "aria-modal": "true",
      "aria-label": t("refuel.done"),
      onclick: (e: Event) => e.target === box && close(),
      onkeydown: (e: KeyboardEvent) => e.key === "Escape" && close(),
    },
    h(
      "div",
      { class: "card sheet" },
      h("h2", null, t("refuel.done")),
      h(
        "dl",
        { class: "kv" },
        h("dt", null, t("refuel.since")),
        h("dd", null, new Date(f.since).toLocaleDateString()),
        h("dt", null, t("trip.distance")),
        h("dd", null, `${fmtNum(toDisplay("km", f.distanceKm), 0)} ${displayUnit("km")}`),
        h("dt", null, t("refuel.calculated")),
        h("dd", null, `${fmtNum(calcL, 1)} L`),
      ),
      h("p", { class: "alert small" }, t("refuel.fillRule")),
      short ? h("p", { class: "alert" }, t("refuel.tooShort", { minKm: MIN_KM, minL: MIN_CALC_L })) : h("p", { class: "muted small" }, t("refuel.askHint")),
      h("label", { class: "field" }, h("span", null, t("refuel.pumpLitres")), input),
      h("div", { class: "row" }, button(t("refuel.confirm"), confirm, "primary"), button(t("common.cancel"), close, "ghost")),
    ),
  );
  document.body.append(box);
  open = box;
  input.focus();
}
