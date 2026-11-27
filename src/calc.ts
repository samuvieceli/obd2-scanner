// Calculated parameters: values the car does not send, computed by the app
// from the ones it does (see trip.ts for the formulas). They can be charted
// like any other parameter; choosing one makes the app read its inputs.

export const CALC_KEYS = ["calc_fuel_flow", "calc_economy"] as const;

/** Metric unit of each calculated value (km/L is shown in the chosen economy unit). */
export const CALC_UNITS: Record<string, string> = { calc_fuel_flow: "L/h", calc_economy: "km/L" };

export function isCalc(key: string): boolean {
  return (CALC_KEYS as readonly string[]).includes(key);
}

/**
 * Car parameters a calculated value needs, among those available (`has`),
 * or null when it cannot be computed. Same order of preference as the trip
 * computer: fuel rate PID, else MAF, else MAP + rpm + intake temperature.
 */
export function calcInputs(key: string, has: (key: string) => boolean): string[] | null {
  const flow = has("fuel_rate")
    ? ["fuel_rate"]
    : has("maf")
      ? ["maf"]
      : has("rpm") && has("intake_map") && has("intake_temp")
        ? ["rpm", "intake_map", "intake_temp"]
        : null;
  if (!flow) return null;
  if (key === "calc_economy") return has("speed") ? [...flow, "speed"] : null;
  return key === "calc_fuel_flow" ? flow : null;
}
