import { describe, expect, it } from "vitest";
import { MAX_GAP_S, O2Test, WINDOW_S, judge, trace } from "./o2test";

/** Square-ish switching between 0.1 and 0.9 V at `hz`. */
const swing = (t: number, hz: number): number => (Math.sin(2 * Math.PI * hz * t) > 0 ? 0.85 : 0.12);

function run(post: (t: number) => number, pre = (t: number) => swing(t, 1), rate = 10, wide = false) {
  const o = new O2Test(wide, true);
  for (let i = 0; i <= 25 * rate; i++) {
    const t = i / rate;
    o.push(t, { rpm: 2500, coolant: 90, pre: pre(t), post: post(t) });
  }
  return o;
}

describe("o2 and catalyst test", () => {
  it("counts crossings with a dead band", () => {
    const tr = trace([0.1, 0.5, 0.1, 0.9, 0.1, 0.9], 10, true);
    expect(tr.crossPer10s).toBe(3);
  });

  it("waits for a warm engine and the rpm range", () => {
    const o = new O2Test(false, true);
    o.push(0, { rpm: 2500, coolant: 60, pre: 0.5, post: 0.6 });
    expect(o.phase).toBe("warmup");
    o.push(1, { rpm: 900, coolant: 85, pre: 0.5, post: 0.6 });
    expect(o.phase).toBe("hold");
  });

  it("starts the window again after the adapter stalls", () => {
    const o = new O2Test(false, true);
    const push = (t: number) => o.push(t, { rpm: 2500, coolant: 90, pre: swing(t, 1), post: 0.68 });
    for (let t = 0; t <= 12; t += 0.1) push(t);
    // The adapter freezes for a few seconds: no readings at all.
    const resume = 12 + MAX_GAP_S + 1;
    push(resume);
    expect(o.phase).toBe("measuring");
    expect(o.progress()).toBe(0);
    for (let t = resume; t < resume + WINDOW_S - 1; t += 0.1) push(t);
    expect(o.phase).toBe("measuring");
    for (let t = resume + WINDOW_S - 1; t <= resume + WINDOW_S + 0.2; t += 0.1) push(t);
    expect(o.phase).toBe("done");
    // Judged only on the clean window: a healthy sensor, not a "slow" one.
    expect(o.result!.sensor!.id).toBe("pre_ok");
  });

  it("good converter: steady downstream sensor", () => {
    const o = run((t) => 0.68 + 0.03 * Math.sin(t));
    expect(o.phase).toBe("done");
    expect(o.result!.sensor!.id).toBe("pre_ok");
    expect(o.result!.catalyst!.id).toBe("cat_ok");
  });

  it("worn converter: downstream copies upstream", () => {
    const o = run((t) => swing(t, 1) * 0.8 + 0.05);
    expect(o.result!.catalyst).toMatchObject({ grade: "bad", id: "cat_weak" });
  });

  it("stuck upstream sensor makes the converter result unknown", () => {
    const o = run(() => 0.7, () => 0.44);
    expect(o.result!.sensor!.id).toBe("pre_stuck_mid");
    expect(o.result!.catalyst!.id).toBe("cat_unknown");
  });

  it("slow switching is only unclear when the adapter is slow", () => {
    const pre = { crossPer10s: 2, amp: 0.7, mean: 0.45 };
    expect(judge(pre, undefined, false, 10).sensor!.id).toBe("pre_slow");
    expect(judge(pre, undefined, false, 2).sensor!.id).toBe("pre_unclear_rate");
  });

  it("wideband upstream: judges only the downstream sensor", () => {
    const o = run(() => 0.7, () => 1 + 0.02 * Math.random(), 10, true);
    expect(o.result!.sensor).toBeUndefined();
    expect(o.result!.catalyst!.id).toBe("cat_ok");
  });
});
