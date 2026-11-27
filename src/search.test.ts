import { describe, expect, it } from "vitest";
import { isDtcCode, normalize, search, type Entry } from "./search";

const entries: Entry[] = [
  { kind: "screen", id: "dashboard", title: "Painel ao vivo" },
  { kind: "screen", id: "diagnostics", title: "Códigos de falha" },
  { kind: "pid", id: "rpm", title: "Rotação do motor", alias: "RPM", detail: "Giros por minuto do virabrequim." },
  { kind: "pid", id: "stft_b1", title: "Correção de curto prazo (banco 1)", alias: "STFT B1", detail: "Ajuste rápido da mistura." },
  { kind: "term", id: "MIL", title: "MIL / luz de injeção", detail: "Lâmpada que acende com um código de falha confirmado." },
];

describe("global search", () => {
  it("ignores accents and case", () => {
    expect(normalize("  Rotação ")).toBe("rotacao");
    expect(search("rotacao", entries)[0].id).toBe("rpm");
    expect(search("CODIGOS", entries)[0].id).toBe("diagnostics");
  });

  it("needs every word and ranks title above description", () => {
    expect(search("rpm", entries)[0].id).toBe("rpm");
    expect(search("mistura rapido", entries).map((e) => e.id)).toEqual(["stft_b1"]);
    expect(search("mistura lento", entries)).toEqual([]);
    // "falha" is in a screen title and in a term description.
    expect(search("falha", entries).map((e) => e.id)).toEqual(["diagnostics", "MIL"]);
  });

  it("finds by short name and recognizes trouble codes", () => {
    expect(search("stft", entries)[0].id).toBe("stft_b1");
    expect(search("", entries)).toEqual([]);
    expect(isDtcCode("p0301")).toBe(true);
    expect(isDtcCode("P9301")).toBe(false);
    expect(isDtcCode("P030")).toBe(false);
  });
});
