// Advice for manufacturer-specific trouble codes that have no reliable
// description in the program (e.g. Fiat, Chevrolet, Renault, Peugeot/Citroën
// and Jeep P1xxx codes: no open, trustworthy list exists).
import type { DtcInfo } from "./api";
import { t } from "./i18n";

/** True when the code is the carmaker's own and its exact meaning is unknown. */
export function needsMakerInfo(d: DtcInfo): boolean {
  return !d.generic && !d.known;
}

/** Brand name from the VIN decoder text, e.g. "Fiat (Brasil)" -> "Fiat". */
export function brandName(manufacturer: string | null | undefined): string | null {
  const name = manufacturer?.replace(/\s*\(.*\)\s*$/, "").trim();
  return name ? name : null;
}

/** Warning text, naming the brand when the VIN told it. */
export function makerInfoAdvice(codes: string[], manufacturer?: string | null): string {
  const brand = brandName(manufacturer);
  const example = `${codes[0]}${brand ? ` ${brand}` : ""}`;
  return brand
    ? t("dtc.makerInfoBrand", { codes: codes.join(", "), brand, example })
    : t("dtc.makerInfo", { codes: codes.join(", "), example });
}
