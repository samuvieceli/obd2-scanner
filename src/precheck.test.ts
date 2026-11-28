import { describe, expect, it } from "vitest";
import { evaluate, overall } from "./precheck";

const byId = (items: ReturnType<typeof evaluate>) => Object.fromEntries(items.map((i) => [i.id, i]));

describe("pre-trip check", () => {
  it("all good with no codes, light off, charged battery and normal temperature", () => {
    const items = evaluate({ codes: { stored: 0, pending: 0, permanent: 0 }, mil: false, rpm: 0, voltage: 12.6, coolant: 30 });
    expect(overall(items)).toBe("ok");
    expect(byId(items).coolant.variant).toBe("off");
  });

  it("grades trouble codes: stored or permanent is a problem, pending is attention", () => {
    expect(byId(evaluate({ codes: { stored: 1, pending: 0, permanent: 0 } })).codes).toMatchObject({ status: "bad", params: { n: 1 } });
    expect(byId(evaluate({ codes: { stored: 0, pending: 2, permanent: 0 } })).codes).toMatchObject({ status: "warn", variant: "pending" });
    expect(byId(evaluate({})).codes.status).toBe("unknown");
    expect(byId(evaluate({ mil: true })).mil.status).toBe("bad");
  });

  it("checks the battery with the engine off and the alternator with it running", () => {
    expect(byId(evaluate({ rpm: 0, voltage: 12.2 })).battery.status).toBe("warn");
    expect(byId(evaluate({ voltage: 11.8 })).battery.status).toBe("bad");
    expect(byId(evaluate({ rpm: 850, voltage: 14.1 })).alternator.status).toBe("ok");
    expect(byId(evaluate({ rpm: 850, voltage: 13.0 })).alternator).toMatchObject({ status: "warn", variant: "smart" });
    expect(byId(evaluate({ rpm: 850, voltage: 12.4 })).alternator).toMatchObject({ status: "bad", variant: "low" });
    expect(byId(evaluate({ rpm: 850, voltage: 15.4 })).alternator).toMatchObject({ status: "bad", variant: "high" });
  });

  it("flags an overheating engine and ignores what could not be read in the overall result", () => {
    const items = evaluate({ codes: { stored: 0, pending: 0, permanent: 0 }, rpm: 900, voltage: 14, coolant: 112 });
    expect(byId(items).coolant).toMatchObject({ status: "bad", variant: "hot", params: { c: 112 } });
    expect(overall(items)).toBe("bad");
    expect(overall(evaluate({ codes: { stored: 0, pending: 0, permanent: 0 } }))).toBe("ok");
    expect(overall([])).toBe("unknown");
  });
});
