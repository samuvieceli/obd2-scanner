// Fuels sold at the pump in each region the program knows (Brazil, United
// States, Europe and the UK) and the two numbers the trip computer needs from
// them: the stoichiometric air/fuel ratio (kg of air that burn 1 kg of fuel)
// and the density (g/L, to turn grams into litres).
//
// The region follows the language (pt-BR → Brazil, en-US → USA, en-GB →
// Europe) and can be changed in Settings. Blends are computed from their
// components, weighted by mass, so a change in the law only needs a new
// percentage here.
//
// Brazil (ANP / CNPE, checked Nov 2026):
// - Regular and additive gasoline ("comum" / "aditivada"): 32% anhydrous
//   ethanol (E32) since 1 Aug 2026 (temporary for 180 days, renewable; the
//   law allows 22% to 35%). Additives do not change the ratio.
// - Premium gasoline: 25% (E25).
// - Hydrated ethanol: about 93% ethanol by mass, the rest water.
// - Diesel S10/S500: 15% biodiesel (B15).
// - Gasoline without ethanol (E0) for cars used abroad.
//
// United States (EIA, DOE Alternative Fuels Data Center, CRS, 2026):
// - Regular (87), midgrade (89) and premium (91–93): almost all E10.
// - E15 ("Unleaded 88"): sold year-round in 2026 under EPA waivers.
// - E85 / "Flex Fuel": 51% to 83% ethanol by season (ASTM D5798); 75% used.
// - Ethanol-free gasoline (E0), sold at some stations.
// - Diesel (ULSD): up to 5% biodiesel without a label (ASTM D975); B20: 6–20%.
//
// Europe and the UK (GOV.UK, EN 228 / EN 590 / EN 15940 / EN 15293):
// - E10 (95 octane, standard since Sept 2021 in Great Britain).
// - E5 "super" (97–99 octane), at most 5% ethanol.
// - E85 (France, Sweden and others): 50% to 85% ethanol; 75% used.
// - Diesel B7 (EN 590): up to 7% biodiesel.
// - HVO100 (EN 15940): renewable paraffinic diesel.
// - LPG / Autogas: propane and butane.

export type FuelRegion = "br" | "us" | "eu";

/** Every fuel the program knows. The Brazilian ids keep their old names. */
export const FUEL_IDS = [
  "gasoline",
  "gasoline_premium",
  "ethanol",
  "diesel",
  "gasoline_pure",
  "us_regular",
  "us_midgrade",
  "us_premium",
  "us_e15",
  "us_e85",
  "us_e0",
  "us_diesel",
  "us_b20",
  "eu_e10",
  "eu_e5",
  "eu_e85",
  "eu_diesel",
  "eu_hvo",
  "eu_lpg",
] as const;
export type FuelId = (typeof FUEL_IDS)[number];
export type FuelType = "auto" | FuelId;

/**
 * The role a fuel plays, the same in every region: when the region changes,
 * each car keeps the same role (regular gasoline stays regular gasoline,
 * diesel stays diesel) with the blend sold there.
 */
export type FuelSlot = "regular" | "midgrade" | "premium" | "e15" | "pure" | "ethanol" | "diesel" | "biodiesel" | "hvo" | "lpg";

/** Ethanol in Brazilian regular and additive gasoline, % by volume. */
export const ETHANOL_IN_GASOLINE = 32;
/** Ethanol in Brazilian premium gasoline, % by volume. */
export const ETHANOL_IN_PREMIUM = 25;
/** Biodiesel in Brazilian road diesel, % by volume. */
export const BIODIESEL_IN_DIESEL = 15;
/** Ethanol in E85 as usually sold (the share changes with the season). */
export const ETHANOL_IN_E85 = 75;

export interface FuelProps {
  /** Stoichiometric air/fuel ratio by mass. */
  afr: number;
  /** g/L */
  density: number;
  /** Lower heating value, MJ/kg (energy per kilogram, for cost comparisons). */
  lhv: number;
}

/** Pure components (textbook values). */
const GASOLINE_A: FuelProps = { afr: 14.7, density: 745, lhv: 43.4 }; // gasoline without ethanol
const ETHANOL_ANHYDROUS: FuelProps = { afr: 9.0, density: 789, lhv: 26.8 };
// Water burns no air and gives no energy.
const ETHANOL_HYDRATED: FuelProps = { afr: 9.0 * 0.93, density: 809, lhv: 26.8 * 0.93 };
const DIESEL_A: FuelProps = { afr: 14.5, density: 832, lhv: 42.8 }; // fossil diesel
const BIODIESEL: FuelProps = { afr: 12.5, density: 880, lhv: 37.3 };
// Hydrotreated vegetable oil: paraffins only, lighter than diesel (765–800 g/L, 44 MJ/kg).
const HVO: FuelProps = { afr: 15.0, density: 780, lhv: 44.0 };
// Autogas, mostly propane: liquid under pressure in the tank.
const LPG: FuelProps = { afr: 15.6, density: 530, lhv: 46.0 };

/** Mixes `pct`% (by volume) of `b` into `a`, weighting the ratio by mass. */
export function blend(a: FuelProps, b: FuelProps, pct: number): FuelProps {
  const vb = Math.max(0, Math.min(1, pct / 100));
  const ma = a.density * (1 - vb);
  const mb = b.density * vb;
  return { afr: (a.afr * ma + b.afr * mb) / (ma + mb), density: ma + mb, lhv: (a.lhv * ma + b.lhv * mb) / (ma + mb) };
}

const gasoline = (ethanolPct: number) => blend(GASOLINE_A, ETHANOL_ANHYDROUS, ethanolPct);
const diesel = (biodieselPct: number) => blend(DIESEL_A, BIODIESEL, biodieselPct);

export interface FuelDef extends FuelProps {
  region: FuelRegion;
  slot: FuelSlot;
  /** Ethanol % a flex sensor (PID 52) reads with this fuel in the tank. */
  ethanolPct?: number;
  /** Fuel whose pump price is used (for one not sold in its region). */
  priceAs?: FuelId;
}

const def = (region: FuelRegion, slot: FuelSlot, props: FuelProps, extra: Partial<FuelDef> = {}): FuelDef => ({ ...props, region, slot, ...extra });

export const FUELS: Record<FuelId, FuelDef> = {
  gasoline: def("br", "regular", gasoline(ETHANOL_IN_GASOLINE), { ethanolPct: ETHANOL_IN_GASOLINE }),
  gasoline_premium: def("br", "premium", gasoline(ETHANOL_IN_PREMIUM), { ethanolPct: ETHANOL_IN_PREMIUM }),
  // A flex sensor reads about 95% with hydrated ethanol (it counts by volume).
  ethanol: def("br", "ethanol", ETHANOL_HYDRATED, { ethanolPct: 95 }),
  diesel: def("br", "diesel", diesel(BIODIESEL_IN_DIESEL)),
  gasoline_pure: def("br", "pure", GASOLINE_A, { ethanolPct: 0, priceAs: "gasoline" }),

  us_regular: def("us", "regular", gasoline(10), { ethanolPct: 10 }),
  us_midgrade: def("us", "midgrade", gasoline(10), { ethanolPct: 10 }),
  us_premium: def("us", "premium", gasoline(10), { ethanolPct: 10 }),
  us_e15: def("us", "e15", gasoline(15), { ethanolPct: 15 }),
  us_e85: def("us", "ethanol", gasoline(ETHANOL_IN_E85), { ethanolPct: ETHANOL_IN_E85 }),
  us_e0: def("us", "pure", GASOLINE_A, { ethanolPct: 0 }),
  us_diesel: def("us", "diesel", diesel(5)),
  us_b20: def("us", "biodiesel", diesel(20)),

  eu_e10: def("eu", "regular", gasoline(10), { ethanolPct: 10 }),
  eu_e5: def("eu", "premium", gasoline(5), { ethanolPct: 5 }),
  eu_e85: def("eu", "ethanol", gasoline(ETHANOL_IN_E85), { ethanolPct: ETHANOL_IN_E85 }),
  eu_diesel: def("eu", "diesel", diesel(7)),
  eu_hvo: def("eu", "hvo", HVO),
  eu_lpg: def("eu", "lpg", LPG),
};

export const FUEL_REGIONS: FuelRegion[] = ["br", "us", "eu"];

/** Fuels of a region, in the order they are listed. */
export function regionFuels(region: FuelRegion): FuelId[] {
  return FUEL_IDS.filter((id) => FUELS[id].region === region);
}

/** The region's fuel for a role, or undefined when it has none. */
export function fuelFor(region: FuelRegion, slot: FuelSlot): FuelId | undefined {
  return FUEL_IDS.find((id) => FUELS[id].region === region && FUELS[id].slot === slot);
}

/** The closest role when a region does not sell the one asked for. */
const NEAREST: Partial<Record<FuelSlot, FuelSlot>> = {
  midgrade: "regular",
  e15: "regular",
  pure: "premium",
  premium: "regular",
  biodiesel: "diesel",
  hvo: "diesel",
};

/**
 * The same kind of fuel in another region, for a car whose region changed.
 * "auto" stays "auto"; a fuel with no counterpart (LPG in Brazil) is kept.
 */
export function equivalentFuel(fuel: FuelType, region: FuelRegion): FuelType {
  if (fuel === "auto" || FUELS[fuel].region === region) return fuel;
  for (let slot: FuelSlot | undefined = FUELS[fuel].slot; slot; slot = NEAREST[slot]) {
    const id = fuelFor(region, slot);
    if (id) return id;
  }
  return fuel;
}

/** Regular gasoline and the high-ethanol fuel a flex car can use in a region. */
export function flexPair(region: FuelRegion): { gasoline: FuelId; ethanol: FuelId } {
  return { gasoline: fuelFor(region, "regular")!, ethanol: fuelFor(region, "ethanol")! };
}

/**
 * Flex car in "auto": the ethanol share the engine reports (PID 52, % of
 * the fuel in the tank) gives the mix. Without that PID, the region's
 * regular gasoline is assumed (the most common case). In Brazil the ethanol
 * at the pump is hydrated (with water); elsewhere it is anhydrous.
 */
export function flexProps(ethanolPercent: number | undefined, region: FuelRegion = "br"): FuelProps {
  if (ethanolPercent === undefined) return FUELS[flexPair(region).gasoline];
  return blend(GASOLINE_A, region === "br" ? ETHANOL_HYDRATED : ETHANOL_ANHYDROUS, ethanolPercent);
}

/** Fuel properties of a car's setting, in its region. */
export function fuelProps(fuel: FuelType, ethanolPercent: number | undefined, region: FuelRegion): FuelProps {
  return fuel === "auto" ? flexProps(ethanolPercent, region) : FUELS[fuel];
}

/** Saved profiles of older versions used other names. */
export function migrateFuel(fuel: string | undefined): FuelType {
  if (fuel === "gasoline_e27") return "gasoline";
  return fuel === "auto" || (FUEL_IDS as readonly string[]).includes(fuel ?? "") ? (fuel as FuelType) : "auto";
}

export function isFuelRegion(v: unknown): v is FuelRegion {
  return v === "br" || v === "us" || v === "eu";
}

/** Energy in one litre, MJ/L. */
export function energyPerL(f: FuelProps): number {
  return (f.lhv * f.density) / 1000;
}
