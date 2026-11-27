// Guided tests screen: step-by-step checks that turn live readings into an
// indication anyone can read. Each test is a tab; its logic lives in a pure
// module (battery.ts, …) and this file only draws it and feeds it samples.
import uPlot from "uplot";
import { api, type MonitorState } from "../api";
import { fmtNum, pidText, t } from "../i18n";
import { hasLiveSource, isSupported, on, state } from "../store";
import { BatteryTest, overall, type BatteryResult, type Grade, type Reading } from "../battery";
import { LOAD_BINS, MIN_SAMPLES, RPM_BINS, TrimMap, gradeTrim, type Pattern } from "../trims";
import { O2Test, RPM_RANGE, WARM_C, WINDOW_S, type O2Result, type Verdict } from "../o2test";
import { cssVar } from "../theme";
import { button, clear, errorText, h, infoTip, notConnected, toast } from "../ui";

type Panel = (box: HTMLElement) => (() => void) | void;

const TESTS: { id: string; panel: Panel }[] = [
  { id: "battery", panel: batteryPanel },
  { id: "o2", panel: o2Panel },
  { id: "trims", panel: trimsPanel },
];

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

// ---------------------------------------------------------------------------
// Oxygen sensors and catalytic converter

const PRE_KEYS: [string, boolean][] = [
  ["o2_b1s1", false],
  ["lambda_b1s1", true],
  ["wb_lambda_s1", true],
];
const CLEAR_KEYS = ["distance_since_clear", "warmups_since_clear"];

function o2Panel(box: HTMLElement): () => void {
  const pre = PRE_KEYS.find(([k]) => isSupported(k));
  if (!pre) {
    box.append(h("div", { class: "alert" }, h("p", null, t("o2test.noSensor"))));
    return () => undefined;
  }
  const [preKey, wide] = pre;
  const postKey = isSupported("o2_b1s2") ? "o2_b1s2" : undefined;
  const live = !state.playback;
  const polling = focusPolling();
  // The "since codes were cleared" counters are read once, then dropped from polling.
  let clearKeys = live ? CLEAR_KEYS.filter(isSupported) : [];
  const clearInfo: Record<string, number> = {};
  const keys = () => ["rpm", "coolant_temp", preKey, ...(postKey ? [postKey] : []), ...clearKeys].filter((k) => k === "rpm" || isSupported(k));
  let test = new O2Test(wide, !!postKey);

  const statusEl = h("div", { class: "card" });
  const plotBox = h("div", { class: "chart-card" });
  const resultEl = h("div");
  const historyEl = h("section", { class: "card" });

  // Live chart of both sensors over the measuring window.
  const color1 = cssVar("--c1") || "#22d3ee";
  const color2 = cssVar("--c2") || "#f59e0b";
  const axis = cssVar("--muted");
  const grid = cssVar("--grid");
  const unitPre = wide ? "λ" : "V";
  const plot = new uPlot(
    {
      width: 600,
      height: 220,
      legend: { show: true },
      cursor: { drag: { x: false, y: false } },
      scales: { x: { time: false }, v: { range: [0, 1.1] }, l: { range: [0.8, 1.2] } },
      axes: [
        { stroke: axis, grid: { stroke: grid }, ticks: { stroke: grid }, label: t("charts.time"), labelSize: 18, size: 36 },
        { scale: wide ? "l" : "v", stroke: axis, grid: { stroke: grid }, ticks: { stroke: grid }, size: 48, values: (_u, vals) => vals.map((v) => fmtNum(v, 2)) },
        ...(wide ? [{ scale: "v", side: 1 as const, stroke: axis, grid: { show: false }, size: 48, values: (_u: uPlot, vals: number[]) => vals.map((v) => fmtNum(v, 1)) }] : []),
      ],
      series: [
        { label: t("charts.time"), value: (_u, v) => (v == null ? "—" : fmtNum(v, 1)) },
        { label: `${pidText(preKey).short} (${unitPre})`, scale: wide ? "l" : "v", stroke: color1, width: 2, points: { show: false } },
        { label: postKey ? `${pidText(postKey).short} (V)` : "—", scale: "v", stroke: color2, width: 2, points: { show: false }, show: !!postKey },
      ],
    },
    [[], [], []],
    plotBox,
  );
  const fitPlot = () => plot.setSize({ width: Math.max(300, plotBox.clientWidth || box.clientWidth - 40), height: 220 });

  const refreshPlot = () => {
    const s = state.history.get(preKey);
    if (!s || !s.t.length) return;
    const from = s.t[s.t.length - 1] - WINDOW_S - 5;
    let i = s.t.length;
    while (i > 0 && s.t[i - 1] >= from) i--;
    const x = s.t.slice(i);
    const post = postKey ? state.history.get(postKey) : undefined;
    // Align the downstream values on the upstream timestamps (same frames).
    const postVals = x.map((tt) => {
      if (!post) return null;
      const j = post.t.lastIndexOf(tt);
      return j >= 0 ? post.v[j] : null;
    });
    plot.setData([x, s.v.slice(i), postVals]);
  };

  const verdictLine = (v: Verdict | undefined, what: string) =>
    v ? h("p", { class: "guided-reading" }, h("strong", null, t(`o2test.${what}`)), " ", gradeBadge(v.grade), " ", t(`o2test.verdicts.${v.id}`)) : null;

  const renderResult = (r: O2Result | undefined) => {
    clear(resultEl);
    if (!r) return;
    const fmtTrace = (label: string, tr: O2Result["pre"], narrow: boolean) =>
      h(
        "li",
        null,
        `${label}: `,
        narrow ? t("o2test.crossings", { n: fmtNum(tr.crossPer10s, 1) }) + " · " : "",
        t("o2test.swing", { v: fmtNum(tr.amp, 2), unit: narrow ? "V" : unitPre }),
      );
    resultEl.append(
      h(
        "section",
        { class: "card" },
        h("h2", null, t("o2test.result")),
        verdictLine(r.sensor, "sensorLabel"),
        wide ? h("p", { class: "muted small" }, t("o2test.wideNote")) : null,
        verdictLine(r.catalyst, "catalystLabel"),
        !postKey ? h("p", { class: "muted small" }, t("o2test.noPost")) : null,
        h(
          "ul",
          { class: "muted small" },
          fmtTrace(pidText(preKey).short, r.pre, !wide),
          r.post ? fmtTrace(pidText(postKey!).short, r.post, true) : null,
          h("li", null, t("guided.rate", { rate: fmtNum(r.rateHz, 1) }), r.lowRate ? ` · ${t("o2test.lowRate")}` : ""),
        ),
        h("p", { class: "muted small" }, t("o2test.precision")),
        h("div", { class: "actions" }, button(t("battery.restart"), () => {
          test = new O2Test(wide, !!postKey);
          render();
        }, "ghost")),
      ),
    );
  };

  // Readiness and "since codes were cleared": what reveals codes erased before a sale.
  let catalystMonitor: MonitorState | undefined;
  const renderHistory = () => {
    clear(historyEl);
    historyEl.append(h("h2", null, t("o2test.history"), " ", infoTip(t("o2test.historyTip"))));
    const items: HTMLElement[] = [];
    if (catalystMonitor) items.push(h("li", null, t("o2test.monitor", { state: t(`vehicle.state.${catalystMonitor}`) })));
    if (clearInfo.distance_since_clear !== undefined) items.push(h("li", null, t("o2test.sinceClearKm", { km: fmtNum(clearInfo.distance_since_clear, 0) })));
    if (clearInfo.warmups_since_clear !== undefined) items.push(h("li", null, t("o2test.sinceClearWarmups", { n: fmtNum(clearInfo.warmups_since_clear, 0) })));
    historyEl.append(items.length ? h("ul", null, ...items) : h("p", { class: "muted" }, t(live ? "common.loading" : "o2test.historyLive")));
    const recent = catalystMonitor === "incomplete" || (clearInfo.distance_since_clear !== undefined && clearInfo.distance_since_clear < 100);
    if (recent) historyEl.append(h("div", { class: "alert alert-warning" }, h("p", null, t("o2test.recentClear"))));
    historyEl.append(h("p", { class: "muted small" }, t("o2test.mode06")));
  };

  const render = () => {
    const ph = test.phase;
    clear(statusEl);
    const rpm = state.latest.rpm;
    const cool = state.latest.coolant_temp;
    statusEl.append(
      h("h2", null, t(`o2test.phase.${ph}`)),
      h("p", null, t(`o2test.do.${ph}`, { warm: WARM_C, lo: RPM_RANGE[0], hi: RPM_RANGE[1], s: WINDOW_S })),
      ph === "measuring" ? h("progress", { max: 1, value: test.progress() }) : "",
      h(
        "p",
        { class: "muted small" },
        `${pidText("rpm").short}: ${rpm === undefined ? "—" : fmtNum(rpm, 0)} · ${pidText("coolant_temp").short}: ${cool === undefined ? "—" : `${fmtNum(cool, 0)} °C`} · `,
        t("guided.rate", { rate: fmtNum(state.rateHz, 1) }),
      ),
    );
    renderResult(test.result);
    renderDemo();
  };

  const demoEl = h("div", { class: "actions" });
  let demoShown = false;
  const renderDemo = () => {
    if (demoShown || !isDemo() || !live) return;
    demoShown = true;
    let rev = false;
    const b: HTMLButtonElement = button(t("o2test.demo.rev"), async () => {
      try {
        rev = !rev;
        await api.sendRaw(rev ? "ATSIMREV" : "ATSIMDRIVE", 1000);
        b.textContent = t(rev ? "o2test.demo.drive" : "o2test.demo.rev");
      } catch (e) {
        toast(errorText(e), "error");
      }
    }, "ghost");
    demoEl.append(b);
  };

  box.append(
    h("p", { class: "muted" }, t("o2test.intro")),
    h("div", { class: "alert alert-warning" }, h("p", null, t("o2test.safety"))),
    statusEl,
    demoEl,
    plotBox,
    resultEl,
    historyEl,
  );
  fitPlot();

  const onFrame = () => {
    const tS = state.lastFrameT;
    if (tS === undefined) return;
    for (const k of clearKeys) {
      const v = fresh(k);
      if (v !== undefined) clearInfo[k] = v;
    }
    if (clearKeys.length && clearKeys.every((k) => clearInfo[k] !== undefined || state.lastDropped.includes(k))) {
      clearKeys = [];
      renderHistory();
      if (live) void polling.set(keys());
    }
    const before = test.phase;
    test.push(tS, { rpm: fresh("rpm"), coolant: fresh("coolant_temp") ?? state.latest.coolant_temp, pre: fresh(preKey), post: postKey ? fresh(postKey) : undefined });
    refreshPlot();
    if (before !== test.phase || test.phase !== "done") render();
  };

  render();
  renderHistory();
  if (live) {
    void polling.set(keys());
    api
      .readReadiness()
      .then((r) => {
        catalystMonitor = r.monitors.find((m) => m.key === "catalyst")?.state;
        renderHistory();
      })
      .catch(() => undefined);
  }
  const offs = [on("frame", onFrame)];
  window.addEventListener("resize", fitPlot);
  return () => {
    offs.forEach((f) => f());
    window.removeEventListener("resize", fitPlot);
    plot.destroy();
    if (live) polling.restore();
  };
}

// ---------------------------------------------------------------------------
// Fuel trim map. It fills in the background from any live frame that carries
// the trims (the dashboard reads them by default), so a normal drive builds it.

const TRIM_KEYS = ["rpm", "engine_load", "stft_b1", "ltft_b1", "closed_loop_b1", "coolant_temp"];
let trimMap = new TrimMap();
let trimSource: unknown = null;

export function initTrimCollector() {
  // A new connection or another recording starts a new map.
  const sourceNow = () => state.playback ?? (state.connection === "connected" ? state.adapter : null);
  const check = () => {
    const src = sourceNow();
    if (src && src !== trimSource) trimMap = new TrimMap();
    trimSource = src;
  };
  on("connection", check);
  on("playback", check);
  on("seek", () => (trimMap = new TrimMap()));
  on("frame", () => {
    check();
    trimMap.push({
      rpm: fresh("rpm"),
      load: fresh("engine_load"),
      stft: fresh("stft_b1"),
      ltft: fresh("ltft_b1"),
      closedLoop: fresh("closed_loop_b1"),
      coolant: state.latest.coolant_temp,
    });
  });
}

function trimsPanel(box: HTMLElement): () => void {
  if (!isSupported("stft_b1") || !isSupported("ltft_b1")) {
    box.append(h("div", { class: "alert" }, h("p", null, t("trims.noTrims"))));
    return () => undefined;
  }
  const live = !state.playback;
  const polling = focusPolling();
  const gridEl = h("div", { class: "table-wrap" });
  const verdictEl = h("section", { class: "card" });
  const countEl = h("p", { class: "muted small" });

  const fmtPct = (v: number) => `${v > 0 ? "+" : ""}${fmtNum(v, 1)}%`;
  const rpmLabel = (i: number) =>
    i === 0 ? `< ${fmtNum(RPM_BINS[0], 0)}` : i === RPM_BINS.length ? `≥ ${fmtNum(RPM_BINS[i - 1], 0)}` : `${fmtNum(RPM_BINS[i - 1], 0)}–${fmtNum(RPM_BINS[i], 0)}`;
  const loadLabel = (i: number) =>
    i === 0 ? `< ${LOAD_BINS[0]}%` : i === LOAD_BINS.length ? `≥ ${LOAD_BINS[i - 1]}%` : `${LOAD_BINS[i - 1]}–${LOAD_BINS[i]}%`;

  let shownPattern: Pattern | "" = "";
  const render = () => {
    const m = trimMap;
    clear(gridEl);
    const rows = [...m.cells.keys()].reverse();
    gridEl.append(
      h(
        "table",
        { class: "table trim-map" },
        h(
          "thead",
          null,
          h("tr", null, h("th", null, t("trims.loadRpm")), ...RPM_BINS.concat([Infinity]).map((_x, c) => h("th", { class: "num" }, `${rpmLabel(c)} rpm`))),
        ),
        h(
          "tbody",
          null,
          rows.map((r) =>
            h(
              "tr",
              null,
              h("th", { scope: "row" }, h("div", null, t(`trims.rows.${r}`)), h("div", { class: "muted small" }, `${t("trims.load")} ${loadLabel(r)}`)),
              ...m.cells[r].map((cell, c) => {
                const v = m.mean(r, c);
                const g = v === undefined ? "none" : gradeTrim(v);
                return h(
                  "td",
                  { class: `num trim-cell trim-${g}`, title: t("trims.cellTip", { n: cell.n, min: MIN_SAMPLES }) },
                  h("strong", null, v === undefined ? "·" : fmtPct(v)),
                  h("div", { class: "muted small" }, t("trims.samples", { n: cell.n })),
                );
              }),
            ),
          ),
        ),
      ),
    );
    countEl.textContent = t("trims.counts", { used: m.used, skipped: m.skipped }) + (m.knowsLoop ? "" : ` ${t("trims.noLoopInfo")}`);
    const p = m.pattern();
    if (p !== shownPattern) {
      shownPattern = p;
      clear(verdictEl);
      const grade = p === "ok" ? "ok" : p === "not_enough" || p === "mixed" ? null : "warn";
      verdictEl.append(
        h("h2", null, t("trims.result"), " ", grade ? gradeBadge(grade) : null),
        h("p", null, t(`trims.patterns.${p}`)),
        h("p", { class: "muted small" }, t("trims.precision")),
      );
    }
  };

  box.append(
    h("p", { class: "muted" }, t("trims.intro")),
    h(
      "ul",
      { class: "legend-list small" },
      h("li", null, gradeBadge("ok"), " ", t("trims.legend.ok")),
      h("li", null, gradeBadge("warn"), " ", t("trims.legend.warn")),
      h("li", null, gradeBadge("bad"), " ", t("trims.legend.bad")),
    ),
    gridEl,
    countEl,
    h("div", { class: "actions" }, button(t("battery.restart"), () => {
      trimMap = new TrimMap();
      shownPattern = "";
      render();
    }, "ghost")),
    verdictEl,
  );

  render();
  if (live) void polling.set(TRIM_KEYS.filter((k) => k === "rpm" || isSupported(k)));
  let last = 0;
  const offs = [
    on("frame", () => {
      // Redraw at most twice a second: the map changes slowly.
      const now = Date.now();
      if (now - last < 500) return;
      last = now;
      render();
    }),
  ];
  return () => {
    offs.forEach((f) => f());
    if (live) polling.restore();
  };
}
