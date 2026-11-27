// Builds a standalone HTML diagnostic report (can be printed to PDF) from a
// recording: what was saved with it (vehicle, trouble codes, readiness,
// Mode 06) and what happened along the trip (minimum, average and maximum
// of each parameter, findings, charts of the main parameters).
import { fmtNum, getLang, msgs, pidText, t } from "../i18n";
import { escapeHtml as e, displayValue, fmtValue, unitOf } from "../ui";
import { findingText } from "./findings";
import { fmtTest, monitorName, testName } from "./diagnostics";
import type { DiagnosticSnapshot, DtcInfo, RecordingReport } from "../api";

/** "m:ss" (or "h:mm:ss") since the start of the recording. */
export function clock(s: number): string {
  const total = Math.max(0, Math.round(s));
  const hh = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = String(total % 60).padStart(2, "0");
  return hh ? `${hh}:${String(mm).padStart(2, "0")}:${ss}` : `${mm}:${ss}`;
}

/** Newest snapshot that has `part`, with the moment it was read. */
function newest<K extends keyof DiagnosticSnapshot>(list: DiagnosticSnapshot[], part: K) {
  for (let i = list.length - 1; i >= 0; i--) if (list[i][part] != null) return { snap: list[i], at: i === 0 ? "start" : "end" };
  return null;
}

export function buildReportHtml(r: RecordingReport, name?: string): string {
  const lang = getLang();
  const diag = r.diagnostics;
  const first = diag[0] ?? {};
  const parts: string[] = [];
  // Recordings from earlier versions (or reads the car did not answer).
  const notSaved = `<p class="muted">${e(t(diag.length ? "report.notRead" : "report.notSaved"))}</p>`;

  // Recording
  const started = r.started_at_unix_ms ? new Date(r.started_at_unix_ms).toLocaleString(lang) : "—";
  const recRows: [string, string][] = [];
  if (name) recRows.push([t("report.file"), name]);
  recRows.push(
    [t("report.startedAt"), started],
    [t("report.duration"), clock(r.duration_s)],
    [t("report.readings"), fmtNum(r.frames, 0)],
  );
  if (r.marks.length) recRows.push([t("report.marks"), r.marks.map((m) => clock(m / 1000)).join(", ")]);
  parts.push(`<h2>${e(t("report.recording"))}</h2>`, table(recRows));

  // Vehicle and adapter
  const v = first.vehicle;
  const rows: [string, string][] = [];
  const vin = v?.vinInfo?.vin ?? r.vehicle.vin;
  if (vin) rows.push([t("vehicle.vin"), vin]);
  if (v?.vinInfo?.manufacturer) rows.push([t("vehicle.manufacturer"), v.vinInfo.manufacturer]);
  if (v?.vinInfo?.model_year) rows.push([t("vehicle.modelYear"), String(v.vinInfo.model_year)]);
  if (v?.vinInfo?.country) rows.push([t("vehicle.country"), (msgs().places as Record<string, string>)[v.vinInfo.country] ?? v.vinInfo.country]);
  const cal = v?.identity.calibration_id ?? r.vehicle.calibration_id;
  if (cal) rows.push([t("vehicle.calibration"), cal]);
  const ecu = v?.identity.ecu_name ?? r.vehicle.ecu_name;
  if (ecu) rows.push([t("vehicle.ecuName"), ecu]);
  if (r.adapter.trim()) rows.push([t("vehicle.adapter"), r.adapter]);
  if (r.protocol) rows.push([t("vehicle.protocol"), r.protocol]);
  if (v?.batteryVoltage != null) rows.push([t("report.voltageAtStart"), `${fmtNum(v.batteryVoltage, 1)} V`]);
  parts.push(`<h2>${e(t("nav.vehicle"))}</h2>`, rows.length ? table(rows) : notSaved);

  // Trouble codes: as read at the start, plus any that showed up by the end.
  parts.push(`<h2>${e(t("dtc.title"))}</h2>`);
  const startDtcs = first.dtcs;
  const endDtcs = diag.length > 1 ? diag[diag.length - 1].dtcs : undefined;
  if (startDtcs) {
    const list = (title: string, items: DtcInfo[]) =>
      `<h3>${e(title)} (${items.length})</h3>` +
      (items.length ? dtcList(items) : `<p>${e(t("dtc.noCodes"))}</p>`);
    parts.push(list(t("dtc.stored"), startDtcs.stored), list(t("dtc.pending"), startDtcs.pending), list(t("dtc.permanent"), startDtcs.permanent));
  } else parts.push(notSaved);
  if (endDtcs) {
    const before = new Set(startDtcs ? [...startDtcs.stored, ...startDtcs.pending, ...startDtcs.permanent].map((d) => d.code) : []);
    const seen = new Set<string>();
    const fresh = [...endDtcs.stored, ...endDtcs.pending, ...endDtcs.permanent].filter((d) => !before.has(d.code) && !seen.has(d.code) && seen.add(d.code));
    parts.push(
      `<h3>${e(t("report.newCodes"))}</h3>`,
      fresh.length ? `<p class="sev-warning">${e(t("report.newCodesFound"))}</p>${dtcList(fresh)}` : `<p>${e(t("report.noNewCodes"))}</p>`,
    );
  }

  // Freeze frame
  const freeze = first.freeze;
  if (freeze?.dtc) {
    parts.push(`<h3>${e(t("dtc.freezeFrame"))} — ${e(freeze.dtc.code)}</h3>`);
    parts.push(table(freeze.values.map((x) => [pidText(x.key).name, `${fmtValue(x.key, x.value)} ${unitOf(x.key)}`])));
  }

  // Readiness: the newest read (monitors can complete during the trip).
  parts.push(`<h2>${e(t("vehicle.readiness"))}</h2>`);
  const ready = newest(diag, "readiness");
  if (ready?.snap.readiness) {
    const rd = ready.snap.readiness;
    parts.push(
      `<p class="muted">${e(t(ready.at === "start" ? "report.readAtStart" : "report.readAtEnd"))}</p>`,
      table([
        [t("vehicle.mil"), rd.mil_on ? t("vehicle.milOn") : t("vehicle.milOff")],
        [t("vehicle.dtcCount"), String(rd.dtc_count)],
        ...rd.monitors.filter((m) => m.state !== "not_supported").map((m) => [t(`monitors.${m.key}.name`), t(`vehicle.state.${m.state}`)] as [string, string]),
      ]),
    );
  } else parts.push(notSaved);

  // Mode 06: failed tests first.
  if (first.mode06?.length) {
    const sorted = [...first.mode06].sort((a, b) => Number(a.passed) - Number(b.passed) || a.mid - b.mid);
    parts.push(`<h2>${e(t("mode06.title"))}</h2>`);
    parts.push(
      table(
        sorted.map((x) => [
          `${monitorName(x)} — ${testName(x)}`,
          `${x.passed ? e(t("mode06.passed")) : `<b>${e(t("mode06.failed"))}</b>`}: ${e(fmtTest(x, x.value))} <span class="muted">(${e(fmtTest(x, x.min))} … ${e(fmtTest(x, x.max))})</span>`,
          true,
        ]),
      ),
    );
  }

  // Findings along the whole trip.
  parts.push(`<h2>${e(t("report.findings"))}</h2>`);
  if (r.findings.length) {
    parts.push(
      `<ul>${r.findings
        .map(
          (f) =>
            `<li class="sev-${f.severity}">${e(findingText(f))} <span class="muted">(${e(
              t("report.findingWhen", { at: clock(f.first_s), seconds: fmtNum(f.seconds, 0) }),
            )})</span></li>`,
        )
        .join("")}</ul><p class="muted">${e(t("dashboard.findingsDisclaimer"))}</p>`,
    );
  } else parts.push(`<p class="muted">${e(t(r.frames ? "report.noFindings" : "report.noReadings"))}</p>`);

  // Charts of the main parameters.
  if (r.charts.length) {
    parts.push(`<h2>${e(t("report.charts"))}</h2>`);
    for (const c of r.charts) parts.push(chartSvg(c, r.duration_s, r.marks));
  }

  // Minimum, average and maximum.
  parts.push(`<h2>${e(t("report.stats"))}</h2>`);
  parts.push(
    r.stats.length
      ? `<table class="stats"><tr><th>${e(t("report.param"))}</th><th>${e(t("report.min"))}</th><th>${e(t("report.avg"))}</th><th>${e(t("report.max"))}</th></tr>${r.stats
          .map((s) => {
            const u = unitOf(s.key);
            const cell = (x: number) => `<td>${e(fmtValue(s.key, x))}${u ? ` ${e(u)}` : ""}</td>`;
            return `<tr><th>${e(pidText(s.key).name)}</th>${cell(s.min)}${cell(s.avg)}${cell(s.max)}</tr>`;
          })
          .join("")}</table>`
      : `<p class="muted">${e(t("report.noReadings"))}</p>`,
  );

  const now = new Date().toLocaleString(lang);
  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><title>${e(t("sessions.reportHeading"))}</title>
<style>
body{font-family:system-ui,"Segoe UI",sans-serif;color:#111;background:#fff;margin:32px;max-width:900px}
h1{margin:0 0 4px;font-size:24px}h2{margin-top:28px;border-bottom:2px solid #0e7490;padding-bottom:4px;font-size:18px;color:#0e7490}
h3{font-size:15px;margin:16px 0 6px}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:6px 8px;text-align:left;vertical-align:top}
th{width:45%;font-weight:600}.stats th{width:auto}.stats td{white-space:nowrap}.muted{color:#666}li{margin:4px 0}
.sev-critical{color:#b91c1c;font-weight:600}.sev-warning{color:#b45309}
figure{margin:12px 0 18px;break-inside:avoid}figcaption{font-weight:600;font-size:14px;margin-bottom:4px}svg{width:100%;height:auto;display:block}
@media print{body{margin:12mm}h2{break-after:avoid}}
</style></head><body>
<h1>${e(t("sessions.reportHeading"))}</h1>
<p class="muted">${e(t("sessions.reportGenerated", { date: now }))} · ${e(t("app.name"))} v${e(r.app_version || "?")}</p>
${parts.join("\n")}
</body></html>`;
}

function dtcList(items: DtcInfo[]): string {
  return `<ul>${items.map((d) => `<li><b>${e(d.code)}</b> — ${e(d.description)} <span class="muted">(${e(d.system)})</span></li>`).join("")}</ul>`;
}

function table(rows: ([string, string] | [string, string, boolean])[]): string {
  return `<table>${rows.map((r) => `<tr><th>${e(r[0])}</th><td>${r[2] ? r[1] : e(r[1])}</td></tr>`).join("")}</table>`;
}

const W = 860;
const H = 130;
const PAD = { l: 56, r: 8, t: 8, b: 20 };

/** One parameter over the trip: a thin line, its lowest and highest value
 * on the left, the time below and the driver's marks as dashed lines. */
export function chartSvg(c: RecordingReport["charts"][number], durationS: number, marks: number[]): string {
  const vals = c.v.map((x) => displayValue(c.key, x));
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (hi - lo < 1e-9) {
    lo -= 1;
    hi += 1;
  }
  const span = Math.max(durationS, c.t[c.t.length - 1] ?? 0, 1e-9);
  const x = (s: number) => PAD.l + (s / span) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
  const pts = c.t.map((s, i) => `${x(s).toFixed(1)},${y(vals[i]).toFixed(1)}`).join(" ");
  const fmt = (v: number) => fmtNum(v, Math.abs(hi - lo) < 10 ? 1 : 0);
  const unit = unitOf(c.key);
  const grid = [lo, (lo + hi) / 2, hi]
    .map((v) => `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="#e5e7eb"/><text x="${PAD.l - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${e(fmt(v))}</text>`)
    .join("");
  const markLines = marks
    .map((m) => `<line x1="${x(m / 1000).toFixed(1)}" x2="${x(m / 1000).toFixed(1)}" y1="${PAD.t}" y2="${H - PAD.b}" stroke="#b45309" stroke-dasharray="3 3"/>`)
    .join("");
  const title = `${pidText(c.key).name}${unit ? ` (${unit})` : ""}`;
  return `<figure><figcaption>${e(title)}</figcaption><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${e(title)}" font-size="11" fill="#555">${grid}${markLines}<polyline points="${pts}" fill="none" stroke="#0e7490" stroke-width="1.5" stroke-linejoin="round"/><text x="${PAD.l}" y="${H - 4}">0:00</text><text x="${W - PAD.r}" y="${H - 4}" text-anchor="end">${e(clock(span))}</text></svg></figure>`;
}
