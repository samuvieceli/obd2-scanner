import { describe, expect, it } from "vitest";
import type { DtcInfo } from "./api";
import { brandName, needsMakerInfo } from "./dtcadvice";

const info = (o: Partial<DtcInfo>): DtcInfo => ({
  code: "P1234",
  description: "",
  system: "",
  generic: false,
  known: false,
  brand: null,
  translated: true,
  ...o,
});

describe("manufacturer code advice", () => {
  it("only for the carmaker's own codes without a description", () => {
    expect(needsMakerInfo(info({}))).toBe(true);
    expect(needsMakerInfo(info({ known: true, brand: "honda" }))).toBe(false);
    expect(needsMakerInfo(info({ generic: true }))).toBe(false);
  });

  it("takes the brand from the VIN decoder text", () => {
    expect(brandName("Fiat (Brasil)")).toBe("Fiat");
    expect(brandName("Jeep / Fiat (Goiana, Brasil)")).toBe("Jeep / Fiat");
    expect(brandName(null)).toBeNull();
  });
});
