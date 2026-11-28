import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
vi.mock("./api", () => ({
  api: { blackboxAlert: async (key: string) => (calls.push(key), true) },
  events: { blackbox: async () => () => undefined },
}));

import { ALERT_COOLDOWN_MS, alertTriggered, eventLabel, eventsText } from "./blackbox";
import { savePrefs } from "./prefs";
import { ESSENTIAL_KEYS, readKeys, state } from "./store";

describe("black box", () => {
  beforeEach(() => {
    calls.length = 0;
    state.connection = "connected";
    state.blackbox = true;
    state.playback = null;
  });

  it("names each kind of event in plain words", () => {
    expect(eventLabel({ t_ms: 0, kind: "dtc_stored", code: "P0301" })).toBe("Code P0301 (confirmed)");
    expect(eventLabel({ t_ms: 0, kind: "dtc_pending", code: "P0171" })).toBe("Code P0171 (pending)");
    expect(eventLabel({ t_ms: 0, kind: "mil" })).toBe("Check-engine light turned on");
    expect(eventLabel({ t_ms: 0, kind: "manual" })).toBe("Saved by you");
    // The same reason twice is listed once.
    expect(eventsText([{ t_ms: 0, kind: "manual" }, { t_ms: 5, kind: "manual" }])).toBe("Saved by you");
  });

  it("alerts start a recording only when asked, once per cooldown", () => {
    savePrefs({ blackboxAlerts: false });
    alertTriggered("coolant_temp", 0);
    expect(calls).toEqual([]);
    savePrefs({ blackboxAlerts: true });
    alertTriggered("coolant_temp", 1_000);
    alertTriggered("coolant_temp", 2_000);
    alertTriggered("battery_voltage", 2_000);
    alertTriggered("coolant_temp", 1_000 + ALERT_COOLDOWN_MS);
    expect(calls).toEqual(["coolant_temp", "battery_voltage", "coolant_temp"]);
  });

  it("adds the essential parameters the car supports to the reading", () => {
    state.adapter = { supported_pids: [0x0c, 0x05] } as never;
    state.catalog = [
      { pid: 0x0c, key: "rpm", unit: "rpm", min: 0, max: 8000, category: "engine" },
      { pid: 0x05, key: "coolant_temp", unit: "°C", min: -40, max: 215, category: "temperature" },
      { pid: 0x10, key: "maf", unit: "g/s", min: 0, max: 300, category: "air" },
    ];
    state.liveKeys = ["speed"];
    state.chartKeys = null;
    const keys = readKeys();
    expect(keys).toEqual(expect.arrayContaining(["speed", "rpm", "coolant_temp", "battery_voltage"]));
    expect(keys).not.toContain("maf");
    expect(ESSENTIAL_KEYS.length).toBeGreaterThanOrEqual(10);
    state.blackbox = false;
    expect(readKeys()).toEqual(["speed"]);
  });
});
