// Pre-purchase check report: a standalone HTML page (printed to PDF from the
// report window) with the car's light, every item and what to do next.
import { getLang, t } from "../i18n";
import { escapeHtml as e } from "../ui";
import { SECTIONS, missingKeyItems, type CheckItem, type Light, type SavedCheck } from "../prepurchase";
import { findingText } from "./findings";

/** Text of an item with its numbers formatted. */
export function itemText(i: CheckItem): string {
  return t(`prepurchase.items.${i.id}.${i.text}`, i.values);
}

/** The codes, monitors or findings behind an item, as readable lines. */
export function itemDetails(i: CheckItem, dtcText: Record<string, string> = {}): string[] {
  if (i.findings?.length) return i.findings.map(findingText);
  if (!i.codes?.length) return [];
  if (i.id === "readiness") return i.codes.map((k) => t(`monitors.${k}.name`));
  if (["permanent", "stored", "pending", "new_codes"].includes(i.id)) return i.codes.map((c) => (dtcText[c] ? `${c} — ${dtcText[c]}` : c));
  if (["misfire", "catalyst", "o2"].includes(i.id)) return [];
  return i.codes;
}

const COLOR: Record<Light, string> = { ok: "#15803d", warn: "#b45309", bad: "#b91c1c", unknown: "#6b7280" };

export function buildPrepurchaseHtml(c: SavedCheck, appVersion = ""): string {
  const lang = getLang();
  const parts: string[] = [];
  const rows: [string, string][] = [];
  if (c.name) rows.push([t("prepurchase.info.name"), c.name]);
  rows.push([t("prepurchase.report.date"), new Date(c.at).toLocaleString(lang)]);
  if (c.vin) rows.push([t("vehicle.vin"), c.vin]);
  if (c.dashKm !== undefined) rows.push([t("prepurchase.report.dashKm"), t("prepurchase.report.km", { km: Math.round(c.dashKm) })]);
  parts.push(`<table>${rows.map(([k, v]) => `<tr><th>${e(k)}</th><td>${e(v)}</td></tr>`).join("")}</table>`);

  const missing = missingKeyItems(c.items);
  parts.push(
    `<div class="summary" style="border-color:${COLOR[c.light]}"><span class="dot" style="background:${COLOR[c.light]}"></span><div><h2 style="color:${COLOR[c.light]}">${e(t(`prepurchase.overall.${c.light}.title`))}</h2><p>${e(t(`prepurchase.overall.${c.light}.text`))}</p>${
      missing.length ? `<p class="muted">${e(t("prepurchase.missing", { items: missing.map((id) => t(`prepurchase.items.${id}.title`)).join(", ") }))}</p>` : ""
    }</div></div>`,
  );

  for (const sec of SECTIONS) {
    const list = c.items.filter((i) => i.section === sec);
    if (!list.length) continue;
    parts.push(`<h2>${e(t(`prepurchase.sections.${sec}`))}</h2><table class="items">`);
    for (const i of list) {
      const details = itemDetails(i, c.dtcText ?? {});
      parts.push(
        `<tr><td class="light"><span style="color:${COLOR[i.light]}">●</span> ${e(t(`prepurchase.light.${i.light}`))}</td><th>${e(t(`prepurchase.items.${i.id}.title`))}</th><td>${e(itemText(i))}${
          details.length ? `<ul>${details.map((d) => `<li>${e(d)}</li>`).join("")}</ul>` : ""
        }</td></tr>`,
      );
    }
    parts.push("</table>");
  }

  parts.push(
    `<h2>${e(t("prepurchase.limits.title"))}</h2><ul>${["odometer", "systems", "history", "notAll", "prepared"].map((k) => `<li>${e(t(`prepurchase.limits.${k}`))}</li>`).join("")}</ul><p><b>${e(t("prepurchase.limits.next"))}</b></p>`,
  );

  const now = new Date().toLocaleString(lang);
  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><title>${e(t("prepurchase.report.heading"))}</title>
<style>
body{font-family:system-ui,"Segoe UI",sans-serif;color:#111;background:#fff;margin:32px;max-width:900px}
h1{margin:0 0 4px;font-size:24px}h2{margin-top:24px;border-bottom:2px solid #0e7490;padding-bottom:4px;font-size:18px;color:#0e7490}
table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:6px 8px;text-align:left;vertical-align:top}
th{width:30%;font-weight:600}.items th{width:24%}.items td.light{width:16%;white-space:nowrap;font-weight:600}.muted{color:#666}ul{margin:4px 0;padding-left:20px}li{margin:2px 0}
.summary{display:flex;gap:16px;align-items:center;border:3px solid;border-radius:12px;padding:12px 18px;margin:20px 0}
.summary h2{border:0;margin:0 0 4px;padding:0}.summary p{margin:4px 0}.dot{flex:none;width:44px;height:44px;border-radius:50%}
@media print{body{margin:12mm}h2{break-after:avoid}tr{break-inside:avoid}}
</style></head><body>
<h1>${e(t("prepurchase.report.heading"))}</h1>
<p class="muted">${e(t("sessions.reportGenerated", { date: now }))} · ${e(t("app.name"))}${appVersion ? ` v${e(appVersion)}` : ""}</p>
${parts.join("\n")}
<p class="muted">${e(t("prepurchase.report.disclaimer"))}</p>
</body></html>`;
}
