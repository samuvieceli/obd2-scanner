import { describe, expect, it } from "vitest";
import ptBR from "./locales/pt-BR";
import enUS from "./locales/en-US";
import enGB, { british } from "./locales/en-GB";

type Tree = { [k: string]: string | Tree };
function flat(node: Tree, prefix = "", out: Record<string, string> = {}): Record<string, string> {
  for (const [k, v] of Object.entries(node)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out[key] = v;
    else flat(v, key, out);
  }
  return out;
}
const pt = flat(ptBR as unknown as Tree);
const us = flat(enUS as unknown as Tree);
const gb = flat(enGB as unknown as Tree);
const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();

describe("translations", () => {
  it("every language has every text, with the same placeholders", () => {
    for (const other of [us, gb]) {
      expect(Object.keys(other).sort()).toEqual(Object.keys(pt).sort());
      for (const k of Object.keys(pt)) expect(`${k}: ${placeholders(other[k])}`).toBe(`${k}: ${placeholders(pt[k])}`);
    }
  });

  it("Brazilian Portuguese avoids European Portuguese words", () => {
    const pt_PT = /\b(ecrã|ficheiro|utilizador|telemóvel|registo|travão|embraiagem|motor de arranque|gasóleo|contacto|definições|guardar como)\b/i;
    for (const [k, v] of Object.entries(pt)) expect(v, k).not.toMatch(pt_PT);
  });

  it("American English avoids British spelling", () => {
    const uk = /\b(litres?|kilometres?|colour|centre|refuell\w*|ageing|vapour|petrol|handbrake|motorway|tyres?)\b/i;
    for (const [k, v] of Object.entries(us)) expect(v, k).not.toMatch(uk);
  });

  it("English (Europe) avoids American spelling and words", () => {
    const usWords = /\b(liters?|kilometers?|gasoline|refueled|refueling|vapors?|center|color|windshield|check engine|highway|parking brake|recognize\w*)\b/i;
    for (const [k, v] of Object.entries(gb)) expect(v, k).not.toMatch(usWords);
    expect(british("Engine size (liters)")).toBe("Engine size (litres)");
    expect(british("The check engine light usually turns on too.")).toBe("The engine warning light usually turns on too.");
  });
});
