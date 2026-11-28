// "Abasteci" window: asks how much fuel the pump showed (litres or gallons), shows what the program
// calculated since "Tanque cheio" and applies the pump calibration (refuel.ts).
import { fmtNum, t } from "../i18n";
import { button, h, toast } from "../ui";
import { displayUnit, fromDisplay, toDisplay } from "../units";
import { MIN_CALC_L, MIN_KM, type FillResult } from "../refuel";
import { correction, fillTracker, finishFill } from "../trip";
import { profile } from "../prefs";

let open: HTMLElement | null = null;

function close() {
  open?.remove();
  open = null;
}

/** Amount of fuel in the chosen volume unit, e.g. "38,5 L" or "10.2 gal". */
export const volumeText = (litres: number) => `${fmtNum(toDisplay("L", litres), 1)} ${displayUnit("L")}`;
/** Distance in the chosen unit, e.g. "412 km" or "256 mi". */
export const distanceText = (km: number) => `${fmtNum(toDisplay("km", km), 0)} ${displayUnit("km")}`;

/** Lower limits of a calibration, in the chosen units. */
const limits = () => ({ minDist: distanceText(MIN_KM), minVol: volumeText(MIN_CALC_L) });

function resultText(r: FillResult): string {
  const vars = { pump: volumeText(r.pumpL), calc: volumeText(r.calcL), dist: distanceText(r.distanceKm), pct: fmtNum(r.estimate * 100, 0), ...limits() };
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
  const unit = displayUnit("L");
  const input = h("input", { type: "text", inputmode: "decimal", placeholder: fmtNum(0, 1), "aria-label": t("refuel.pumpLitres", { unit }) }) as HTMLInputElement;
  const confirm = () => {
    // Typed in the chosen unit (litres or gallons), kept in litres.
    const v = fromDisplay("L", Number(input.value.trim().replace(",", ".")));
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
        h("dd", null, distanceText(f.distanceKm)),
        h("dt", null, t("refuel.calculated")),
        h("dd", null, volumeText(calcL)),
      ),
      h("p", { class: "alert small" }, t("refuel.fillRule")),
      short ? h("p", { class: "alert" }, t("refuel.tooShort", limits())) : h("p", { class: "muted small" }, t("refuel.askHint")),
      h("label", { class: "field" }, h("span", null, t("refuel.pumpLitres", { unit })), input),
      h("div", { class: "row" }, button(t("refuel.confirm"), confirm, "primary"), button(t("common.cancel"), close, "ghost")),
    ),
  );
  document.body.append(box);
  open = box;
  input.focus();
}
