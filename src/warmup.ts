// Engine warm-up indicator (dashboard and HUD).
//
// The engine wears most when it is pushed hard while still cold: the oil is
// thick and the parts have not expanded to their working clearances.
// Coolant temperature is the usual sign; the oil warms more slowly, so when
// the car also reports oil temperature it must be warm too.
//
// - below 60 °C coolant: cold, drive gently;
// - 60–80 °C (or oil below 70 °C): warming up;
// - 80 °C and above: ready for normal use.

export type WarmState = "cold" | "warming" | "ready";

export const COLD_BELOW_C = 60;
export const READY_FROM_C = 80;
export const OIL_READY_FROM_C = 70;

/** Warm-up state, or undefined without a coolant reading. */
export function warmState(coolant: number | undefined, oil?: number): WarmState | undefined {
  if (coolant === undefined) return undefined;
  if (coolant < COLD_BELOW_C) return "cold";
  if (coolant < READY_FROM_C) return "warming";
  if (oil !== undefined && oil < OIL_READY_FROM_C) return "warming";
  return "ready";
}
