// Ready-made dashboard layouts. Each entry lists parameters in order of
// preference; a group in brackets means "the first one this car supports".
// Fuel consumption itself is shown by the trip computer, which needs fuel
// rate, or air flow (MAF), or manifold pressure + intake temperature.
// "Full" shows everything the car supports; clicking the active preset again
// goes back to it.

export type PresetId = "full" | "daily" | "trip" | "injection" | "turbo";

type Entry = string | string[];

const CONSUMPTION: Entry[] = [["fuel_rate", "maf", "intake_map"], "intake_temp"];

export const PRESETS: Record<PresetId, Entry[]> = {
  full: [],
  daily: ["speed", "rpm", "coolant_temp", "battery_voltage", "fuel_level", ...CONSUMPTION],
  trip: ["speed", "fuel_level", "engine_load", "coolant_temp", "rpm", ...CONSUMPTION],
  injection: ["stft_b1", "ltft_b1", ["o2_b1s1", "lambda_b1s1", "wb_lambda_s1"], "o2_b1s2", "timing_advance", ["intake_map", "maf"], "rpm", "engine_load", "coolant_temp"],
  turbo: [["boost_pressure_a", "intake_map"], "intake_temp", "timing_advance", "throttle", "rpm", "engine_load", "speed"],
};

/** The parameters of a preset this car supports (`all`: every known key, for "full"). */
export function presetKeys(id: PresetId, supported: (key: string) => boolean, all: string[] = []): string[] {
  if (id === "full") return all.filter(supported);
  const out: string[] = [];
  for (const e of PRESETS[id]) {
    const k = Array.isArray(e) ? e.find(supported) : supported(e) ? e : undefined;
    if (k && !out.includes(k)) out.push(k);
  }
  // Intake temperature only helps consumption when it is computed from MAP.
  if (id !== "turbo" && out.includes("intake_temp") && !out.includes("intake_map")) out.splice(out.indexOf("intake_temp"), 1);
  return out;
}

/** The preset whose parameters are exactly `keys`, if any. */
export function matchPreset(keys: string[], supported: (key: string) => boolean, all: string[] = []): PresetId | undefined {
  return (Object.keys(PRESETS) as PresetId[]).find((id) => {
    const p = presetKeys(id, supported, all);
    return p.length > 0 && p.length === keys.length && p.every((k) => keys.includes(k));
  });
}

/** What a click on preset `id` selects: the active one again goes back to "full". */
export function presetAfterClick(id: PresetId, active: PresetId | undefined): PresetId {
  return id === active ? "full" : id;
}

// --- Charts ------------------------------------------------------------------
// Ready-made groups for the Charts screen, by what is being checked. Same
// rules as above; "dashboard" follows the parameters of the live dashboard.

export type ChartPresetId = "dashboard" | "mixture" | "temperatures" | "electrical" | "consumption" | "acceleration" | "turbo";

export const CHART_PRESETS: Record<ChartPresetId, Entry[]> = {
  dashboard: [],
  mixture: ["stft_b1", "ltft_b1", ["o2_b1s1", "lambda_b1s1", "wb_lambda_s1"], "o2_b1s2", ["maf", "intake_map"], "rpm"],
  temperatures: ["coolant_temp", "intake_temp", "oil_temp", "ambient_temp", "catalyst_temp_b1s1"],
  electrical: ["battery_voltage", "module_voltage", "rpm"],
  consumption: ["calc_fuel_flow", "calc_economy", "speed", "rpm", "engine_load"],
  acceleration: ["speed", "rpm", "throttle", ["accel_pedal_d", "relative_pedal"], "engine_load", "timing_advance"],
  turbo: [["boost_pressure_a", "intake_map"], "boost_pressure_cmd_a", "intake_temp", "timing_advance", "throttle", "rpm"],
};

/** The parameters of chart preset `id` available here (`dashboard`: null = follow it). */
export function chartPresetKeys(id: ChartPresetId, available: (key: string) => boolean): string[] | null {
  if (id === "dashboard") return null;
  const out: string[] = [];
  for (const e of CHART_PRESETS[id]) {
    const k = Array.isArray(e) ? e.find(available) : available(e) ? e : undefined;
    if (k && !out.includes(k)) out.push(k);
  }
  return out;
}

/** The chart preset matching the chosen keys (null = following the dashboard). */
export function matchChartPreset(keys: string[] | null, available: (key: string) => boolean): ChartPresetId | undefined {
  if (keys === null) return "dashboard";
  return (Object.keys(CHART_PRESETS) as ChartPresetId[]).find((id) => {
    const p = chartPresetKeys(id, available);
    return !!p && p.length > 0 && p.length === keys.length && p.every((k) => keys.includes(k));
  });
}
