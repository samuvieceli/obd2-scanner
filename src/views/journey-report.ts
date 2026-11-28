// What the "Viagem" screen shows about one trip, as plain rows shared by the
// screen, the printable report (PDF), the spreadsheet (CSV) and the image
// card, so the four always say the same thing.
import { BAND_KMH, CITY_MAX_KMH, economySeries, seriesOf, WARM_C, type JourneyAnalysis, type JourneyLog, type Tip } from "../journey";
import type { JourneyMeta } from "../journey-store";
import { tripCost } from "../cost";
import { fmtNum, getLang, pidText, t } from "../i18n";
import { prefs } from "../prefs";
import { baseUnitOf, escapeHtml as e, displayValue, fmtValue, unitOf } from "../ui";
import { consumption, displayUnit, toDisplay } from "../units";
import { distanceText, economyText, moneyText, volumeText } from "./drive-history";
import { reportPage, seriesSvg } from "./report";

export const durationText = (s: number) => {
  const m = Math.round(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min` : `${m} min`;
};
const speedText = (kmh: number | undefined) => (kmh === undefined ? "—" : `${fmtValue("speed", kmh)} ${unitOf("speed")}`);
const pct = (x: number) => `${fmtNum(x * 100, 0)}%`;

/** "Ida para a praia" or the date and time it started. */
export function journeyTitle(m: JourneyMeta): string {
  const when = new Date(m.startedAt).toLocaleString(getLang(), { dateStyle: "short", timeStyle: "short" });
  return m.name.trim() ? `${m.name.trim()} (${when})` : t("journey.untitled", { date: when });
}

export function journeyCost(m: JourneyMeta, a: JourneyAnalysis) {
  return a.fuelL === undefined ? undefined : tripCost(a.fuelL, m.fuel, m.ethanolPercent, prefs().fuelPrices);
}

export type Row = [label: string, value: string, help?: string];

/** The main numbers of a trip. */
export function mainRows(m: JourneyMeta, a: JourneyAnalysis): Row[] {
  const rows: Row[] = [
    [t("journey.facts.distance"), distanceText(a.distanceKm)],
    [t("journey.facts.running"), durationText(a.runningS)],
  ];
  if (a.fuelL !== undefined) {
    rows.push([t("journey.facts.fuel"), volumeText(a.fuelL)]);
    rows.push([t("journey.facts.economy"), economyText(a.kmPerL)]);
    const c = journeyCost(m, a);
    rows.push([t("journey.facts.cost"), c?.cost !== undefined ? moneyText(c.cost) : t("journey.facts.noPrice")]);
    if (m.fuel === "auto" && c?.asGasoline !== undefined && c.asEthanol !== undefined)
      rows.push([t("journey.facts.flex"), t("journey.facts.flexValue", { g: moneyText(c.asGasoline), e: moneyText(c.asEthanol) }), t("cost.breakEven", { pct: Math.round(c.breakEven * 100) })]);
  }
  rows.push([t("journey.facts.avgSpeed"), speedText(a.avgMovingKmh), t("journey.facts.avgSpeedHelp")]);
  rows.push([t("journey.facts.maxSpeed"), speedText(a.maxSpeed)]);
  if (a.vsAverage !== undefined)
    rows.push([t("journey.facts.vsAverage"), t(a.vsAverage >= 0 ? "journey.facts.better" : "journey.facts.worse", { pct: Math.round(Math.abs(a.vsAverage)) }), t("journey.facts.vsAverageHelp")]);
  return rows;
}

/** Where the fuel went: stopped, city, road. Columns: label, time, distance, fuel (share), economy. */
export function splitRows(a: JourneyAnalysis): string[][] {
  const fuel = a.fuelL ?? 0;
  return (
    [
      ["idle", a.idle],
      ["city", a.city],
      ["road", a.road],
    ] as const
  ).map(([k, b]) => [
    t(`journey.split.${k}`, { kmh: CITY_MAX_KMH }),
    durationText(b.timeS),
    distanceText(b.distanceKm),
    a.fuelL === undefined ? "—" : `${volumeText(b.fuelL)}${fuel > 0 ? ` (${pct(b.fuelL / fuel)})` : ""}`,
    k === "idle" ? (a.fuelL === undefined || b.timeS < 1 ? "—" : `${fmtNum(toDisplay("L/h", (b.fuelL / b.timeS) * 3600), 2)} ${displayUnit("L/h")}`) : economyText(b.kmPerL),
  ]);
}

export interface BandRow {
  label: string;
  distance: string;
  economy: string;
  /** Bar length 0–1 (best band = 1). */
  share: number;
  best: boolean;
}

/** Economy per speed band, for the bar chart. */
export function bandRows(a: JourneyAnalysis): BandRow[] {
  const shown = a.bands.filter((b) => b.kmPerL !== undefined);
  // Bars follow the economy unit: with L/100 km, less is better.
  const value = (kmPerL: number) => consumption(kmPerL)[0];
  const top = Math.max(...shown.map((b) => value(b.kmPerL!)), 1e-9);
  return shown.map((b) => ({
    label: b.to === null ? t("journey.bandTop", { from: b.from }) : t("journey.band", { from: b.from, to: b.to }),
    distance: distanceText(b.distanceKm),
    economy: economyText(b.kmPerL),
    share: value(b.kmPerL!) / top,
    best: b === a.bestBand,
  }));
}

/** Driving habits. */
export function drivingRows(a: JourneyAnalysis): Row[] {
  const rows: Row[] = [
    [t("journey.driving.accels"), String(a.hardAccels), t("journey.driving.accelsHelp")],
    [t("journey.driving.brakes"), String(a.hardBrakes), t("journey.driving.brakesHelp")],
  ];
  if (a.highRpmShare !== undefined) rows.push([t("journey.driving.highRpm"), pct(a.highRpmShare), t("journey.driving.highRpmHelp")]);
  if (a.coastShare !== undefined) rows.push([t("journey.driving.coast"), pct(a.coastShare), t("journey.driving.coastHelp")]);
  if (a.maxRpm !== undefined) rows.push([t("journey.driving.maxRpm"), `${fmtValue("rpm", a.maxRpm)} ${unitOf("rpm")}`]);
  return rows;
}

/** Engine warm-up and mixture. */
export function engineRows(a: JourneyAnalysis): Row[] {
  const rows: Row[] = [];
  const temp = (c: number) => `${fmtValue("coolant_temp", c)} ${unitOf("coolant_temp")}`;
  if (a.coolantStart !== undefined) rows.push([t("journey.engine.startTemp"), temp(a.coolantStart)]);
  if (a.warmupS !== undefined) rows.push([t("journey.engine.warmup", { c: WARM_C }), durationText(a.warmupS), t("journey.engine.warmupHelp")]);
  if (a.cold.timeS >= 30 && a.fuelL !== undefined)
    rows.push([t("journey.engine.cold", { c: WARM_C }), `${durationText(a.cold.timeS)} · ${a.fuelL > 0 ? pct(a.cold.fuelL / a.fuelL) : "—"} ${t("journey.engine.ofFuel")}`, t("journey.engine.coldHelp")]);
  if (a.maxCoolant !== undefined) rows.push([t("journey.engine.maxTemp"), temp(a.maxCoolant)]);
  if (a.trimAvg !== undefined) {
    const grade = Math.abs(a.trimAvg) <= 10 ? "ok" : a.trimAvg > 0 ? "lean" : "rich";
    rows.push([t("journey.engine.trim"), `${a.trimAvg > 0 ? "+" : ""}${fmtNum(a.trimAvg, 1)}% · ${t(`journey.engine.trim_${grade}`)}`, t("journey.engine.trimHelp")]);
  } else rows.push([t("journey.engine.trim"), t("journey.engine.trimUnknown"), t("journey.engine.trimHelp")]);
  return rows;
}

export function tipText(tip: Tip): string {
  return t(`journey.tips.${tip.id}`, tip.params);
}

/** Notes on how much to trust the numbers. */
export function trustNotes(m: JourneyMeta, a: JourneyAnalysis): string[] {
  const out: string[] = [];
  if (a.fuelL === undefined) out.push(t("journey.noFuel"));
  else if (!m.calibrated && (m.method === "maf" || m.method === "map")) out.push(t("journey.notCalibrated"));
  if (m.source === "recording") out.push(t("journey.fromRecording"));
  return out;
}

/** Charts of a trip (display units): speed, economy minute by minute, engine temperature. */
export function charts(log: JourneyLog): { title: string; t: number[]; v: number[]; dots?: boolean }[] {
  const out: { title: string; t: number[]; v: number[]; dots?: boolean }[] = [];
  const sp = seriesOf(log, "speed");
  if (sp.t.length > 1) out.push({ title: `${pidText("speed").name} (${unitOf("speed")})`, t: sp.t, v: sp.v.map((x) => displayValue("speed", x)) });
  const ec = economySeries(log);
  if (ec.t.length > 1) out.push({ title: t("journey.chartEconomy", { unit: consumption(1)[1] }), t: ec.t, v: ec.v.map((x) => consumption(x)[0]), dots: true });
  const ct = seriesOf(log, "coolant_temp");
  if (ct.t.length > 1) out.push({ title: `${pidText("coolant_temp").name} (${unitOf("coolant_temp")})`, t: ct.t, v: ct.v.map((x) => displayValue("coolant_temp", x)) });
  return out;
}

export function chartsHtml(log: JourneyLog): string {
  const span = log.rows[log.rows.length - 1]?.[0] ?? 0;
  return charts(log)
    .map((c) => seriesSvg(c.title, c.t, c.v, span, [], c.dots))
    .join("");
}

const rowsTable = (rows: Row[]) => `<table>${rows.map(([k, v]) => `<tr><th>${e(k)}</th><td>${e(v)}</td></tr>`).join("")}</table>`;

/** Printable report of one trip. */
export function buildJourneyReportHtml(m: JourneyMeta, a: JourneyAnalysis, log: JourneyLog, appVersion: string): string {
  const parts: string[] = [];
  parts.push(`<p><b>${e(journeyTitle(m))}</b>${m.note.trim() ? `<br>${e(m.note.trim())}` : ""}</p>`);
  const notes = trustNotes(m, a);
  if (notes.length) parts.push(`<p class="muted">${notes.map(e).join("<br>")}</p>`);
  parts.push(`<h2>${e(t("journey.mainTitle"))}</h2>`, rowsTable(mainRows(m, a)));
  if (a.tips.length) parts.push(`<h2>${e(t("journey.tipsTitle"))}</h2><ul>${a.tips.map((x) => `<li class="tip-${x.level}">${e(tipText(x))}</li>`).join("")}</ul>`);
  const head = ["", "time", "distance", "fuel", "economy"].map((c) => (c ? t(`journey.split.col.${c}`) : ""));
  parts.push(
    `<h2>${e(t("journey.splitTitle"))}</h2>`,
    `<table class="stats"><tr>${head.map((c) => `<th>${e(c)}</th>`).join("")}</tr>${splitRows(a)
      .map((r) => `<tr><th>${e(r[0])}</th>${r.slice(1).map((c) => `<td>${e(c)}</td>`).join("")}</tr>`)
      .join("")}</table>`,
  );
  const bands = bandRows(a);
  if (bands.length)
    parts.push(
      `<h2>${e(t("journey.bandsTitle"))}</h2><p class="muted">${e(t("journey.bandsHelp", { kmh: BAND_KMH }))}</p>`,
      `<table class="bands">${bands
        .map((b) => `<tr${b.best ? ' class="best"' : ""}><th>${e(b.label)}</th><td class="barcell"><span class="bar" style="width:${Math.round(b.share * 100)}%"></span></td><td>${e(b.economy)}</td><td class="muted">${e(b.distance)}</td></tr>`)
        .join("")}</table>`,
    );
  parts.push(`<h2>${e(t("journey.drivingTitle"))}</h2>`, rowsTable(drivingRows(a)));
  parts.push(`<h2>${e(t("journey.engineTitle"))}</h2>`, rowsTable(engineRows(a)));
  const ch = chartsHtml(log);
  if (ch) parts.push(`<h2>${e(t("journey.chartsTitle"))}</h2>`, ch);
  parts.push(`<p class="muted">${e(t("journey.reportNote"))}</p>`);
  const css = `.bands th{width:28%}.bands td{white-space:nowrap}.barcell{width:50%}.bar{display:block;height:12px;background:#0e7490;border-radius:3px;print-color-adjust:exact;-webkit-print-color-adjust:exact}.best th,.best td{font-weight:700}.best .bar{background:#15803d}.tip-warn{color:#b45309;font-weight:600}.tip-good{color:#15803d}`;
  return reportPage(t("journey.reportHeading"), appVersion, parts.join("\n"), css);
}

/** The trip's rows as a spreadsheet (metric units; pt-BR uses ; and decimal comma). */
export function buildJourneyCsv(m: JourneyMeta, log: JourneyLog): string {
  const br = getLang() === "pt-BR";
  const sep = br ? ";" : ",";
  const num = (x: number | null | undefined, d = 3) => (x === null || x === undefined || !Number.isFinite(x) ? "" : br ? String(+x.toFixed(d)).replace(".", ",") : String(+x.toFixed(d)));
  const quote = (s: string) => (/[;,"\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s);
  const unit = (k: string) => (baseUnitOf(k) ? ` (${baseUnitOf(k)})` : "");
  const head = [t("journey.csv.time"), t("journey.csv.clock"), pidText("calc_fuel_flow").name, ...log.keys.map((k) => `${pidText(k).name}${unit(k)}`)];
  const lines = [head.map(quote).join(sep)];
  for (const r of log.rows) {
    const at = new Date(m.startedAt + (r[0] ?? 0) * 1000).toLocaleTimeString(getLang());
    lines.push([num(r[0], 1), at, num(r[1]), ...r.slice(2).map((x) => num(x))].join(sep));
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}

/** Short title + lines for the image card. */
export function cardLines(m: JourneyMeta, a: JourneyAnalysis): { title: string; lines: { text: string; bold?: boolean; gap?: boolean; muted?: boolean }[] } {
  const lines = mainRows(m, a).map(([k, v]) => ({ text: `${k}: ${v}` }));
  const tips = a.tips.slice(0, 4).map((x, i) => ({ text: `• ${tipText(x)}`, gap: i === 0 }));
  return { title: journeyTitle(m), lines: [...lines, ...tips, { text: t("journey.estimate"), muted: true, gap: true }] };
}

