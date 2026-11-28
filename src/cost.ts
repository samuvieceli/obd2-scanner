// Trip cost from the fuel used, and what the same trip would cost with the
// region's regular gasoline and with its high-ethanol fuel (flex cars).
//
// The comparison keeps the energy the engine used the same: litres of the
// other fuel = energy used ÷ energy per litre of that fuel. Brazilian
// ethanol has about 70% of the energy of E32 gasoline per litre, the source
// of the popular "ethanol pays off below 70% of the gasoline price" rule
// (E85 against E10 gives about 75%). Engines run a bit more efficiently on
// ethanol, so this is an estimate.

import { FUELS, energyPerL, flexPair, fuelProps, type FuelId, type FuelRegion, type FuelType } from "./fuels";

/** Pump prices per litre, by fuel id (each region has its own). */
export type Prices = Partial<Record<FuelId, number | null>>;

export interface CostResult {
  /** Cost of the fuel actually used, when its price is known. */
  cost?: number;
  /** The same trip with regular gasoline and with the ethanol fuel (flex comparison). */
  asGasoline?: number;
  asEthanol?: number;
  /** The ethanol fuel pays off below this share of the gasoline price (0–1). */
  breakEven: number;
}

/**
 * Volume share of the ethanol fuel in a flex tank from the ethanol % the car
 * reports, between the gasoline (`inGasoline` %) and the ethanol fuel
 * (`inEthanol` %). Brazil: E32 and hydrated ethanol (~95% on the sensor).
 */
export function ethanolShare(ethanolPct: number, inGasoline = 32, inEthanol = 95): number {
  return Math.max(0, Math.min(1, (ethanolPct - inGasoline) / (inEthanol - inGasoline)));
}

/** Currency of the pump prices of each region. */
export const CURRENCY: Record<FuelRegion, string> = { br: "R$", us: "$", eu: "€" };

function price(p: Prices, id: FuelId): number | undefined {
  const v = p[FUELS[id].priceAs ?? id];
  return v && v > 0 ? v : undefined;
}

export function tripCost(fuelL: number, fuel: FuelType, ethanolPct: number | undefined, prices: Prices, region: FuelRegion = "br"): CostResult {
  const pair = flexPair(region);
  const gas = FUELS[pair.gasoline];
  const eth = FUELS[pair.ethanol];
  const breakEven = energyPerL(eth) / energyPerL(gas);
  const g = price(prices, pair.gasoline);
  const e = price(prices, pair.ethanol);
  let unit: number | undefined;
  if (fuel === "auto") {
    const x = ethanolPct === undefined ? 0 : ethanolShare(ethanolPct, gas.ethanolPct, eth.ethanolPct);
    unit = x === 0 ? g : x === 1 ? e : g !== undefined && e !== undefined ? x * e + (1 - x) * g : undefined;
  } else {
    unit = price(prices, fuel);
  }
  const out: CostResult = { breakEven, cost: unit !== undefined ? fuelL * unit : undefined };
  // Only gasoline and ethanol fuels compare: not diesel, HVO or LPG.
  if (fuel === "auto" || FUELS[fuel].ethanolPct !== undefined) {
    const energy = fuelL * energyPerL(fuelProps(fuel, ethanolPct, region));
    if (g !== undefined) out.asGasoline = (energy / energyPerL(gas)) * g;
    if (e !== undefined) out.asEthanol = (energy / energyPerL(eth)) * e;
  }
  return out;
}
