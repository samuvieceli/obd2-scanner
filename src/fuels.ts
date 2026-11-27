// Fuels sold in Brazil and the two numbers the trip computer needs from them:
// the stoichiometric air/fuel ratio (kg of air that burn 1 kg of fuel) and
// the density (g/L, to turn grams into litres).
//
// Blends are computed from their components, weighted by mass, so a change
// in the law only needs a new percentage here:
// - Regular and additive gasoline ("comum" / "aditivada"): 32% anhydrous
//   ethanol (E32) since 1 Aug 2026 (CNPE resolution, temporary for 180 days,
//   renewable; the law allows 22% to 35%). Additives do not change the ratio.
// - Premium gasoline: 25% (E25).
// - Hydrated ethanol (regular and additive): about 93% ethanol by mass, the
//   rest water (ANP: 92.5% to 94.6% INPM).
// - Diesel S10/S500: 15% biodiesel (B15).
// - Gasoline without ethanol (E0) for cars used abroad.

export type FuelType = "auto" | "gasoline" | "gasoline_premium" | "ethanol" | "diesel" | "gasoline_pure";

/** Ethanol in regular and additive gasoline, % by volume. */
export const ETHANOL_IN_GASOLINE = 32;
/** Ethanol in premium gasoline, % by volume. */
export const ETHANOL_IN_PREMIUM = 25;
/** Biodiesel in road diesel, % by volume. */
export const BIODIESEL_IN_DIESEL = 15;

export interface FuelProps {
  /** Stoichiometric air/fuel ratio by mass. */
  afr: number;
  /** g/L */
  density: number;
}

/** Pure components (textbook values). */
const GASOLINE_A: FuelProps = { afr: 14.7, density: 745 }; // gasoline without ethanol
const ETHANOL_ANHYDROUS: FuelProps = { afr: 9.0, density: 789 };
const ETHANOL_HYDRATED: FuelProps = { afr: 9.0 * 0.93, density: 809 }; // water burns no air
const DIESEL_A: FuelProps = { afr: 14.5, density: 832 }; // fossil diesel
const BIODIESEL: FuelProps = { afr: 12.5, density: 880 };

/** Mixes `pct`% (by volume) of `b` into `a`, weighting the ratio by mass. */
export function blend(a: FuelProps, b: FuelProps, pct: number): FuelProps {
  const vb = Math.max(0, Math.min(1, pct / 100));
  const ma = a.density * (1 - vb);
  const mb = b.density * vb;
  return { afr: (a.afr * ma + b.afr * mb) / (ma + mb), density: ma + mb };
}

export const FUELS: Record<Exclude<FuelType, "auto">, FuelProps> = {
  gasoline: blend(GASOLINE_A, ETHANOL_ANHYDROUS, ETHANOL_IN_GASOLINE),
  gasoline_premium: blend(GASOLINE_A, ETHANOL_ANHYDROUS, ETHANOL_IN_PREMIUM),
  ethanol: ETHANOL_HYDRATED,
  diesel: blend(DIESEL_A, BIODIESEL, BIODIESEL_IN_DIESEL),
  gasoline_pure: GASOLINE_A,
};

/**
 * Flex car in "auto": the ethanol share the engine reports (PID 52, % of
 * the fuel in the tank) mixes gasoline and hydrated ethanol. Without that
 * PID, regular gasoline is assumed (the most common case).
 */
export function flexProps(ethanolPercent: number | undefined): FuelProps {
  if (ethanolPercent === undefined) return FUELS.gasoline;
  return blend(GASOLINE_A, ETHANOL_HYDRATED, ethanolPercent);
}

/** Saved profiles of older versions used other names. */
export function migrateFuel(fuel: string | undefined): FuelType {
  if (fuel === "gasoline_e27") return "gasoline";
  const known: FuelType[] = ["auto", "gasoline", "gasoline_premium", "ethanol", "diesel", "gasoline_pure"];
  return known.includes(fuel as FuelType) ? (fuel as FuelType) : "auto";
}
