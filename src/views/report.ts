// Builds a standalone HTML diagnostic report (can be printed to PDF).
import { fmtNum, getLang, msgs, pidText, t } from "../i18n";
import { state } from "../store";
import { escapeHtml as e, fmtValue, unitOf } from "../ui";
import { findingText } from "./findings";
import { fmtTest, monitorName, testName } from "./diagnostics";
import type { DtcInfo } from "../api";

export function buildReportHtml(): string {
  const now = new Date().toLocaleString(getLang());
  const v = state.vehicle;
  const parts: string[] = [];
  const notRead = `<p class="muted">${e(t("sessions.reportNotRead"))}</p>`;

  // Vehicle
  const rows: [string, string][] = [];
  if (v?.vinInfo) {
    rows.push([t("vehicle.vin"), v.vinInfo.vin]);
    if (v.vinInfo.manufacturer) rows.push([t("vehicle.manufacturer"), v.vinInfo.manufacturer]);
    if (v.vinInfo.model_year) rows.push([t("vehicle.modelYear"), String(v.vinInfo.model_year)]);
    if (v.vinInfo.country) rows.push([t("vehicle.country"), (msgs().places as Record<string, string>)[v.vinInfo.country] ?? v.vinInfo.country]);
  }
  if (v?.identity.calibration_id) rows.push([t("vehicle.calibration"), v.identity.calibration_id]);
  if (v?.identity.ecu_name) rows.push([t("vehicle.ecuName"), v.identity.ecu_name]);
  if (state.adapter) {
    rows.push([t("vehicle.adapter"), `${state.adapter.version} — ${state.adapter.transport}`]);
    rows.push([t("vehicle.protocol"), state.adapter.protocol]);
  }
  if (v?.batteryVoltage != null) rows.push([t("vehicle.voltage"), `${fmtNum(v.batteryVoltage, 1)} V`]);
  parts.push(`<h2>${e(t("nav.vehicle"))}</h2>`);
  parts.push(rows.length ? table(rows) : notRead);

  // DTCs
  parts.push(`<h2>${e(t("dtc.title"))}</h2>`);
  if (state.dtcs) {
    const list = (title: string, items: DtcInfo[]) =>
      `<h3>${e(title)} (${items.length})</h3>` +
      (items.length
        ? `<ul>${items.map((d) => `<li><b>${e(d.code)}</b> — ${e(d.description)} <span class="muted">(${e(d.system)})</span></li>`).join("")}</ul>`
        : `<p>${e(t("dtc.noCodes"))}</p>`);
    parts.push(list(t("dtc.stored"), state.dtcs.stored), list(t("dtc.pending"), state.dtcs.pending), list(t("dtc.permanent"), state.dtcs.permanent));
  } else parts.push(notRead);

  // Freeze frame
  if (state.freeze?.dtc) {
    parts.push(`<h3>${e(t("dtc.freezeFrame"))} — ${e(state.freeze.dtc.code)}</h3>`);
    parts.push(table(state.freeze.values.map((x) => [pidText(x.key).name, `${fmtValue(x.key, x.value)} ${unitOf(x.key)}`])));
  }

  // Readiness
  parts.push(`<h2>${e(t("vehicle.readiness"))}</h2>`);
  if (state.readiness) {
    const r = state.readiness;
    parts.push(
      table([
        [t("vehicle.mil"), r.mil_on ? t("vehicle.milOn") : t("vehicle.milOff")],
        [t("vehicle.dtcCount"), String(r.dtc_count)],
        ...r.monitors.filter((m) => m.state !== "not_supported").map((m) => [t(`monitors.${m.key}.name`), t(`vehicle.state.${m.state}`)] as [string, string]),
      ]),
    );
  } else parts.push(notRead);

  // Mode 06 (only when read): failed tests first.
  if (state.mode06?.length) {
    const sorted = [...state.mode06].sort((a, b) => Number(a.passed) - Number(b.passed) || a.mid - b.mid);
    parts.push(`<h2>${e(t("mode06.title"))}</h2>`);
    parts.push(
      table(
        sorted.map((r) => [
          `${monitorName(r)} — ${testName(r)}`,
          `${r.passed ? e(t("mode06.passed")) : `<b>${e(t("mode06.failed"))}</b>`}: ${e(fmtTest(r, r.value))} <span class="muted">(${e(fmtTest(r, r.min))} … ${e(fmtTest(r, r.max))})</span>`,
          true,
        ]),
      ),
    );
  }

  // Interpretation
  parts.push(`<h2>${e(t("dashboard.findings"))}</h2>`);
  parts.push(
    state.findings.length
      ? `<ul>${state.findings.map((f) => `<li class="sev-${f.severity}">${e(findingText(f))}</li>`).join("")}</ul><p class="muted">${e(t("dashboard.findingsDisclaimer"))}</p>`
      : Object.keys(state.latest).length
        ? `<p class="muted">${e(t("dashboard.findingsNormal"))}</p>`
        : notRead,
  );

  // Current values
  parts.push(`<h2>${e(t("sessions.reportCurrentValues"))}</h2>`);
  const keys = Object.keys(state.latest);
  parts.push(
    keys.length
      ? table(
          keys.map((k) => {
            const mm = state.minmax[k];
            const range = mm ? ` <span class="muted">(${e(t("dashboard.min"))} ${fmtValue(k, mm[0])} · ${e(t("dashboard.max"))} ${fmtValue(k, mm[1])})</span>` : "";
            return [pidText(k).name, `${fmtValue(k, state.latest[k])} ${unitOf(k)}${range}`, true];
          }),
        )
      : notRead,
  );

  return `<!doctype html>
<html lang="${getLang()}"><head><meta charset="utf-8"><title>${e(t("sessions.reportHeading"))}</title>
<style>
body{font-family:system-ui,"Segoe UI",sans-serif;color:#111;margin:32px;max-width:900px}
h1{margin:0 0 4px;font-size:24px}h2{margin-top:28px;border-bottom:2px solid #0e7490;padding-bottom:4px;font-size:18px;color:#0e7490}
h3{font-size:15px;margin:16px 0 6px}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:6px 8px;text-align:left;vertical-align:top}
th{width:45%;font-weight:600}.muted{color:#666}li{margin:4px 0}.sev-critical{color:#b91c1c;font-weight:600}.sev-warning{color:#b45309}
@media print{body{margin:12mm}h2{break-after:avoid}}
</style></head><body>
<h1>${e(t("sessions.reportHeading"))}</h1>
<p class="muted">${e(t("sessions.reportGenerated", { date: now }))} · ${e(t("app.name"))} v${e(state.appVersion)}</p>
${parts.join("\n")}
</body></html>`;
}

function table(rows: ([string, string] | [string, string, boolean])[]): string {
  return `<table>${rows
    .map((r) => `<tr><th>${e(r[0])}</th><td>${r[2] ? r[1] : e(r[1])}</td></tr>`)
    .join("")}</table>`;
}
