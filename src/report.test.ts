import { describe, expect, it } from "vitest";
import type { RecordingReport } from "./api";
import { buildReportHtml, clock } from "./views/report";

function report(over: Partial<RecordingReport> = {}): RecordingReport {
  return {
    app_version: "1.0.0",
    started_at_unix_ms: 1_700_000_000_000,
    adapter: "ELM327 v1.5 (Bluetooth)",
    protocol: "ISO 15765-4 (CAN 11/500)",
    vehicle: { vin: null, calibration_id: null, ecu_name: null },
    duration_s: 600,
    frames: 1200,
    marks: [120_000],
    diagnostics: [],
    stats: [{ key: "rpm", unit: "rpm", min: 780, avg: 1650, max: 4200, count: 1200 }],
    findings: [],
    charts: [{ key: "rpm", unit: "rpm", t: [0, 300, 600], v: [800, 3000, 900] }],
    ...over,
  };
}

const code = (c: string) => ({ code: c, description: "desc", system: "x", generic: true, known: true, brand: null, translated: true });

describe("diagnostic report from a recording", () => {
  it("formats times since the start", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(75)).toBe("1:15");
    expect(clock(3725)).toBe("1:02:05");
  });

  it("an old recording says what was not saved, but still has stats and charts", () => {
    const html = buildReportHtml(report(), "viagem.json");
    expect(html).toContain("viagem.json");
    expect(html).toContain("ISO 15765-4");
    expect(html).toContain("<svg");
    expect(html).toContain("<polyline");
    // Average column and the marked event line on the chart.
    expect(html).toContain("stroke-dasharray");
    expect(html).toMatch(/1[.,]?650/);
  });

  it("shows codes read at the start and those that appeared by the end", () => {
    const html = buildReportHtml(
      report({
        diagnostics: [
          { t_ms: 0, dtcs: { stored: [code("P0300")], pending: [], permanent: [] } },
          { t_ms: 600_000, dtcs: { stored: [code("P0300")], pending: [code("P0171")], permanent: [] } },
        ],
      }),
    );
    expect(html).toContain("P0300");
    expect(html).toContain("P0171");
    // P0300 was there at the start: listed once in the start list only.
    expect(html.split("P0300").length - 1).toBe(1);
  });

  it("escapes text from the file", () => {
    const html = buildReportHtml(report({ adapter: "<script>x</script>" }));
    expect(html).not.toContain("<script>x");
  });
});
