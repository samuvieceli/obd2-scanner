// Post-trip summary card: opens by itself when the engine stops or the
// connection ends after a drive of 2 minutes or more. The last summary can be
// opened again from the dashboard's trip box.
import { activeAlerts } from "../alerts";
import { tripCost } from "../cost";
import { fmtNum, getLang, pidText, t } from "../i18n";
import { prefs, profile } from "../prefs";
import { copyCard, drawCard, type Line } from "../share";
import { emit, on, state } from "../store";
import { Drive, type DriveSummary } from "../summary";
import { fuelFlow } from "../trip";
import { button, fmtValue, h, unitOf } from "../ui";
import { consumption, displayUnit, toDisplay } from "../units";

const drive = new Drive();
let lastT: number | null = null;
/** The newest finished drive, kept until the app closes. */
export let lastDrive: DriveSummary | null = null;
let open: HTMLElement | null = null;

const duration = (s: number) => {
  const m = Math.round(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min` : `${m} min`;
};

/** Label/value pairs of a summary, shared by the card and the copied image. */
export function summaryRows(s: DriveSummary): [string, string][] {
  const rows: [string, string][] = [];
  const pct = (x: number) => (s.runningS > 0 ? ` (${fmtNum((x / s.runningS) * 100, 0)}%)` : "");
  rows.push([t("summary.duration"), duration(s.runningS)]);
  rows.push([t("summary.moving"), duration(s.movingS) + pct(s.movingS)]);
  rows.push([t("summary.idle"), duration(s.idleS) + pct(s.idleS)]);
  if (s.distanceKm > 0.05) rows.push([t("summary.distance"), `${fmtNum(toDisplay("km", s.distanceKm), 1)} ${displayUnit("km")}`]);
  if (s.avgMovingKmh !== undefined) rows.push([t("summary.avgSpeed"), `${fmtValue("speed", s.avgMovingKmh)} ${unitOf("speed")}`]);
  if (s.maxSpeed !== undefined) rows.push([t("summary.maxSpeed"), `${fmtValue("speed", s.maxSpeed)} ${unitOf("speed")}`]);
  if (s.maxRpm !== undefined) rows.push([t("summary.maxRpm"), `${fmtValue("rpm", s.maxRpm)} ${unitOf("rpm")}`]);
  if (s.maxCoolant !== undefined) rows.push([t("summary.maxCoolant"), `${fmtValue("coolant_temp", s.maxCoolant)} ${unitOf("coolant_temp")}`]);
  if (s.minBatteryRunning !== undefined)
    rows.push([t("summary.minBattery"), `${fmtValue("battery_voltage", s.minBatteryRunning)} ${unitOf("battery_voltage")}`]);
  if (s.fuelL > 0.01) {
    rows.push([t("summary.fuel"), `${fmtNum(toDisplay("L", s.fuelL), 2)} ${displayUnit("L")}`]);
    if (s.distanceKm > 1) {
      const [v, unit] = consumption(s.distanceKm / s.fuelL);
      rows.push([t("summary.economy"), `${fmtNum(v, 1)} ${unit}`]);
    }
    const c = tripCost(s.fuelL, profile().fuel, state.latest.ethanol_percent, prefs().fuelPrices);
    if (c.cost !== undefined) rows.push([t("cost.trip"), `${t("cost.currency")} ${fmtNum(c.cost, 2)}`]);
  }
  return rows;
}

function alertText(s: DriveSummary): string {
  return s.alerts.length ? t("summary.alerts", { names: s.alerts.map((k) => pidText(k).name).join(", ") }) : t("summary.noAlerts");
}

export function closeSummary() {
  open?.remove();
  open = null;
}

export function showSummary(s: DriveSummary) {
  closeSummary();
  const title = t(s.reason === "engine_off" ? "summary.titleOff" : "summary.titleLost");
  const copy = () => {
    const lines: Line[] = summaryRows(s).map(([k, v]) => ({ text: `${k}: ${v}` }));
    lines.push({ text: alertText(s), gap: true, bold: s.alerts.length > 0 });
    void copyCard(drawCard(title, lines), "obd2-resumo-viagem");
  };
  const box = h(
    "div",
    { class: "overlay", role: "dialog", "aria-modal": "true", "aria-label": title, onclick: (e: Event) => e.target === box && closeSummary() },
    h(
      "div",
      { class: "card sheet" },
      h("h2", null, title),
      h("p", { class: "muted small" }, new Date(s.endedAt).toLocaleTimeString(getLang(), { hour: "2-digit", minute: "2-digit" })),
      h(
        "dl",
        { class: "kv" },
        summaryRows(s).flatMap(([k, v]) => [h("dt", null, k), h("dd", null, v)]),
      ),
      h("p", { class: s.alerts.length ? "alert" : "muted" }, alertText(s)),
      h("p", { class: "muted small" }, t("summary.note")),
      h(
        "div",
        { class: "row" },
        button(t("share.copy"), copy, "secondary", { title: t("share.help") }),
        button(t("common.close"), closeSummary, "primary"),
      ),
    ),
  );
  document.body.append(box);
  open = box;
  (box.querySelector(".btn-primary") as HTMLElement | null)?.focus();
}

function finished(s: DriveSummary | undefined) {
  if (!s) return;
  lastDrive = s;
  emit("trip");
  showSummary(s);
}

export function initDriveSummary() {
  on("frame", () => {
    const t_ = state.lastFrameT;
    if (t_ === undefined) return;
    const dt = lastT === null ? 0 : t_ - lastT;
    lastT = t_;
    for (const k of activeAlerts) drive.noteAlert(k);
    finished(drive.push(dt, state.latest, fuelFlow(state.latest)));
  });
  on("connection", () => {
    if (state.connection !== "connected" && !state.playback) {
      lastT = null;
      finished(drive.finish("disconnected"));
    }
  });
  // Replays are not real drives of this session: start fresh around them.
  let replaying = false;
  on("playback", () => {
    if (!!state.playback !== replaying) {
      replaying = !!state.playback;
      drive.reset();
      lastT = null;
    }
  });
  document.addEventListener("keydown", (e) => {
    if (open && e.key === "Escape") closeSummary();
  });
}
