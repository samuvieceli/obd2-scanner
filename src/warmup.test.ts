import { describe, expect, it } from "vitest";
import { warmState } from "./warmup";

describe("warm-up indicator", () => {
  it("follows coolant and waits for the oil when known", () => {
    expect(warmState(undefined)).toBeUndefined();
    expect(warmState(35)).toBe("cold");
    expect(warmState(72)).toBe("warming");
    expect(warmState(88)).toBe("ready");
    expect(warmState(88, 60)).toBe("warming");
    expect(warmState(88, 85)).toBe("ready");
  });
});
