// Trip cost from the fuel used, and what the same trip would cost with the
// other fuel of a flex car.
//
// The comparison keeps the energy the engine used the same: litres of the
// other fuel = energy used ÷ energy per litre of that fuel. Ethanol has about
// 70% of the energy of E32 gasoline per litre, the source of the popular
// "ethanol pays off below 70% of the gasoline price" rule. Engines run a bit
// more efficiently on ethanol, so this is an estimate.

import { FUELS, energyPerL, flexProps, type FuelProps, type FuelType } from "./fuels";

export type PriceKey = "gasoline" | "gasoline_premium" | "ethanol" | "diesel";
export type Prices = Partial<Record<PriceKey, number | null>>;

export interface CostResult {
  /** Cost of the fuel actually used, when its price is known. */
  cost?: number;
  /** The same trip with regular gasoline and with ethanol (flex comparison). */
  asGasoline?: number;
  asEthanol?: number;
  /** Ethanol pays off below this share of the gasoline price (0–1). */
  breakEven: number;
}

/** Volume share of hydrated ethanol in a flex tank from the ethanol % the car reports. */
export function hydratedShare(ethanolPct: number, inGasoline = 32, inHydrated = 95): number {
  return Math.max(0, Math.min(1, (ethanolPct - inGasoline) / (inHydrated - inGasoline)));
}

const price = (p: Prices, k: PriceKey) => (p[k] && p[k]! > 0 ? p[k]! : undefined);

export function tripCost(fuelL: number, fuel: FuelType, ethanolPct: number | undefined, prices: Prices): CostResult {
  const breakEven = energyPerL(FUELS.ethanol) / energyPerL(FUELS.gasoline);
  let props: FuelProps;
  let unit: number | undefined;
  switch (fuel) {
    case "auto": {
      props = flexProps(ethanolPct);
      const g = price(prices, "gasoline");
      const e = price(prices, "ethanol");
      const x = ethanolPct === undefined ? 0 : hydratedShare(ethanolPct);
      unit = x === 0 ? g : x === 1 ? e : g !== undefined && e !== undefined ? x * e + (1 - x) * g : undefined;
      break;
    }
    case "gasoline_pure":
      props = FUELS.gasoline_pure;
      unit = price(prices, "gasoline");
      break;
    default:
      props = FUELS[fuel];
      unit = price(prices, fuel);
  }
  const out: CostResult = { breakEven, cost: unit !== undefined ? fuelL * unit : undefined };
  if (fuel !== "diesel") {
    const energy = fuelL * energyPerL(props);
    const g = price(prices, "gasoline");
    const e = price(prices, "ethanol");
    if (g !== undefined) out.asGasoline = (energy / energyPerL(FUELS.gasoline)) * g;
    if (e !== undefined) out.asEthanol = (energy / energyPerL(FUELS.ethanol)) * e;
  }
  return out;
}
