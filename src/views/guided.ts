// Guided tests screen: step-by-step checks that turn live readings into an
// indication anyone can read. Each test is a tab; its logic lives in a pure
// module (battery.ts, …) and this file only draws it and feeds it samples.
import { api } from "../api";
import { fmtNum, t } from "../i18n";
import { hasLiveSource, isSupported, on, state } from "../store";
import { BatteryTest, overall, type BatteryResult, type Grade, type Reading } from "../battery";
import { button, clear, errorText, h, infoTip, notConnected, toast } from "../ui";

type Panel = (box: HTMLElement) => (() => void) | void;

const TESTS: { id: string; panel: Panel }[] = [{ id: "battery", panel: batteryPanel }];

let lastTab = "battery";

export function mount(root: HTMLElement) {
  const page = h("div", { class: "page" });
  root.append(page);
  page.append(h("h1", null, t("guided.title")), h("p", { class: "lead" }, t("guided.intro")));
  if (!hasLiveSource()) {
    page.append(notConnected());
    return;
  }

  const tabs = h("div", { class: "tabs", role: "tablist" });
  const box = h("div", { role: "tabpanel" });
  page.append(tabs, box);
  let cleanup: (() => void) | void;

  const open = (id: string) => {
    cleanup?.();
    lastTab = id;
    clear(tabs);
    for (const test of TESTS) {
      tabs.append(
        h(
          "button",
          { type: "button", role: "tab", class: test.id === id ? "tab active" : "tab", "aria-selected": test.id === id, onclick: () => open(test.id) },
          t(`guided.tabs.${test.id}`),
        ),
      );
    }
    clear(box);
    cleanup = (TESTS.find((x) => x.id === id) ?? TESTS[0]).panel(box);
  };
  open(lastTab);
  return () => cleanup?.();
}

// ---------------------------------------------------------------------------
// Shared helpers

/** Value of `key` in the newest live frame, or undefined if it was not in it. */
function fresh(key: string): number | undefined {
  const s = state.history.get(key);
  if (!s || !s.t.length || s.t[s.t.length - 1] !== state.lastFrameT) return undefined;
  return s.v[s.v.length - 1];
}

/** Polls only `keys` while a test runs; gives the dashboard its keys back after. */
function focusPolling() {
  const wasPolling = state.polling;
  let current = "";
  return {
    set: async (keys: string[]) => {
      const id = keys.join(",");
      if (id === current) return;
      current = id;
      try {
        await api.setLive(keys, true);
        state.polling = true;
      } catch (e) {
        toast(errorText(e), "error");
      }
    },
    restore: () => {
      if (state.connection !== "connected") return;
      api.setLive(state.liveKeys, wasPolling).catch(() => undefined);
      state.polling = wasPolling;
    },
  };
}

function gradeBadge(g: Grade): HTMLElement {
  const cls = g === "ok" ? "badge-ok" : g === "warn" ? "badge-warn" : "badge-danger";
  return h("span", { class: `badge ${cls}` }, t(`guided.grade.${g}`));
}

const isDemo = () => !!state.adapter?.transport.startsWith("Demo");

// ---------------------------------------------------------------------------
// Battery and alternator

function batteryPanel(box: HTMLElement): () => void {
  if (state.playback) {
    box.append(h("div", { class: "alert" }, h("p", null, t("guided.needsLive"))));
    return () => undefined;
  }
  let test = new BatteryTest();
  const polling = focusPolling();
  // Adapter reading first; the engine computer's reading if the adapter has none.
  let vKey = "battery_voltage";

  const voltsEl = h("span", { class: "perf-speed" }, "—");
  const rateEl = h("p", { class: "muted small" });
  const stepsEl = h("ol", { class: "guided-steps" });
  const resultEl = h("div");
  const demoEl = h("div", { class: "actions" });

  const keysFor = () => (test.step === "charge" ? [vKey, "rpm"] : [vKey]);

  const fmtV = (v: number) => `${fmtNum(v, 2)} V`;
  const readingLine = (r: Reading | undefined, what: string): HTMLElement | null =>
    r
      ? h(
          "p",
          { class: "guided-reading" },
          h("strong", null, fmtV(r.volts)),
          " ",
          gradeBadge(r.grade),
          " ",
          t(`battery.verdict.${what}.${r.grade}`),
          r.note ? h("span", { class: "muted small" }, ` ${t(`battery.notes.${r.note}`)}`) : null,
        )
      : null;

  const render = () => {
    const st = test.status();
    const r = test.result;
    const order = ["rest", "crank", "charge"] as const;
    const idx = st.step === "done" ? 3 : order.indexOf(st.step);
    clear(stepsEl);
    order.forEach((step, i) => {
      const state_ = i < idx ? "done" : i === idx ? "current" : "todo";
      const body: (HTMLElement | string | null)[] = [h("h3", null, t(`battery.steps.${step}.title`))];
      if (state_ === "current") {
        const sub = step === "charge" ? `battery.steps.charge.${st.charge}` : `battery.steps.${step}.do`;
        body.push(h("p", null, t(sub)));
        if (st.hold) body.push(h("p", { class: "warn-text small" }, t(`battery.hold.${st.hold}`)));
        if (st.progress > 0) body.push(h("progress", { max: 1, value: st.progress }));
      }
      if (step === "rest") body.push(readingLine(r.rest, "rest"));
      if (step === "crank") {
        if (r.crank) body.push(readingLine(r.crank, "crank"));
        else if (r.crank === null) body.push(h("p", { class: "muted" }, t(`battery.crankMissed.${r.crankMissed}`)));
      }
      if (step === "charge") {
        if (r.idle) body.push(h("p", { class: "muted small" }, t("battery.atIdle")), readingLine(r.idle, "charge"));
        if (r.loaded) body.push(h("p", { class: "muted small" }, t("battery.atLoad")), readingLine(r.loaded, "charge"));
      }
      stepsEl.append(h("li", { class: `guided-step ${state_}` }, ...body));
    });
    renderResult(r, st.step === "done");
    renderDemo();
  };

  const renderResult = (r: BatteryResult, done: boolean) => {
    clear(resultEl);
    if (!done) return;
    const g = overall(r);
    resultEl.append(
      h(
        "section",
        { class: "card" },
        h("h2", null, t("battery.summary"), " ", g ? gradeBadge(g) : null),
        h("p", null, t(`battery.overall.${g ?? "none"}`)),
        h("p", { class: "muted small" }, t("battery.precision")),
      ),
    );
  };

  // Demo: the virtual engine can be stopped and started from here too.
  let demoShown = "";
  const renderDemo = () => {
    // Redrawn only when it changes, so a click is never lost to a redraw.
    const id = `${test.step}:${state.demoEngineOff}`;
    if (id === demoShown) return;
    demoShown = id;
    clear(demoEl);
    if (!isDemo()) return;
    const step = test.step;
    if (step === "rest" && !state.demoEngineOff) demoEl.append(demoButton("ATSIMOFF", "battery.demo.stop", true));
    if (step === "crank" && state.demoEngineOff) demoEl.append(demoButton("ATSIMON", "battery.demo.start", false));
  };
  const demoButton = (cmd: string, label: string, off: boolean) =>
    button(t(label), async () => {
      try {
        await api.sendRaw(cmd, 1000);
        state.demoEngineOff = off;
        renderDemo();
      } catch (e) {
        toast(errorText(e), "error");
      }
    }, "ghost");

  const restart = () => {
    test = new BatteryTest();
    void polling.set(keysFor());
    render();
  };

  box.append(
    h("div", { class: "alert alert-warning" }, h("p", null, t("battery.safety"))),
    h(
      "div",
      { class: "perf-live card" },
      h("div", null, voltsEl, " ", infoTip(t("battery.sourceTip"))),
      h("div", null, rateEl),
    ),
    stepsEl,
    h("div", { class: "actions" }, button(t("battery.skip"), () => {
      test.skip();
      void polling.set(keysFor());
      render();
    }, "ghost"), button(t("battery.restart"), restart, "ghost")),
    demoEl,
    resultEl,
  );

  let lastStep = test.step;
  let lastCharge = test.charge;
  const onFrame = () => {
    const tS = state.lastFrameT;
    const v = fresh(vKey);
    rateEl.textContent = t("guided.rate", { rate: fmtNum(state.rateHz, 1) });
    if (v === undefined || tS === undefined) return;
    voltsEl.textContent = fmtV(v);
    test.push(tS, v, fresh("rpm"));
    if (test.step !== lastStep || test.charge !== lastCharge) void polling.set(keysFor());
    lastStep = test.step;
    lastCharge = test.charge;
    render();
  };
  const onDropped = () => {
    if (state.lastDropped.includes(vKey) && vKey === "battery_voltage" && isSupported("module_voltage")) {
      vKey = "module_voltage";
      void polling.set(keysFor());
    }
  };
  // A restart of the adapter during cranking hides the real dip.
  const onLink = () => {
    if (state.link?.state === "recovering" || state.link?.state === "reconnecting") test.adapterReset();
  };

  render();
  void polling.set(keysFor());
  const offs = [on("frame", onFrame), on("frame", onDropped), on("link", onLink)];
  return () => {
    offs.forEach((f) => f());
    polling.restore();
  };
}
