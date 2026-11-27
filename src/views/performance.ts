// Performance tests screen: 0–100, 100–0, 40–80 and 80–120 km/h, detected
// automatically while driving (see perf.ts for the detection rules).
import { ask } from "@tauri-apps/plugin-dialog";
import { api } from "../api";
import { fmtNum, getLang, t } from "../i18n";
import { freshValue, hasLiveSource, on, readKeys, state } from "../store";
import { PERF_TESTS, PerfDetector, type PerfResult, type PerfTestId } from "../perf";
import { button, clear, errorText, h, leaveOnDisconnect, notConnected, toast } from "../ui";
import { FIRST_PROFILE, profile, saveProfile } from "../prefs";
import { displayUnit, toDisplay } from "../units";

const MAX_HISTORY = 300;

/** Test name, with the mph equivalent when speeds are shown in mph. */
function testLabel(from: number, to: number): string {
  const base = `${from}–${to} km/h`;
  if (displayUnit("km/h") !== "mph") return base;
  const mph = (v: number) => fmtNum(toDisplay("km/h", v), 0);
  return `${base} (${mph(from)}–${mph(to)} mph)`;
}

function fmtDistance(m: number): string {
  return displayUnit("km") === "mi" ? `${fmtNum(m * 3.28084, 0)} ft` : `${fmtNum(m, 1)} m`;
}

function loadHistory(): PerfResult[] {
  try {
    return JSON.parse(localStorage.getItem("perfResults") ?? "[]") as PerfResult[];
  } catch {
    return [];
  }
}

function saveHistory(list: PerfResult[]) {
  try {
    localStorage.setItem("perfResults", JSON.stringify(list.slice(-MAX_HISTORY)));
  } catch {
    /* kept for this session only */
  }
}

export function mount(root: HTMLElement) {
  const page = h("div", { class: "page" });
  root.append(page);
  if (!hasLiveSource()) {
    page.append(h("h1", null, t("perf.title")), notConnected());
    return;
  }

  const me = profile();
  // Tests the driver chose to watch (all by default), kept per car.
  const armed = new Set<PerfTestId>(me.perfTests ?? PERF_TESTS.map((d) => d.id));
  const makeDetector = () => new PerfDetector(PERF_TESTS.filter((d) => armed.has(d.id)));
  let detector = makeDetector();
  // Every car keeps its own results; the others stay saved untouched.
  const others = loadHistory().filter((r) => (r.profileId ?? FIRST_PROFILE) !== me.id);
  let history = loadHistory().filter((r) => (r.profileId ?? FIRST_PROFILE) === me.id);
  const store = () => saveHistory([...others, ...history]);
  const live = !state.playback;
  const wasPolling = state.polling;
  // Speed-only polling gives many more samples per second → more precise times.
  // Off while recording: it would leave only the speed in the recording.
  const recording = state.recording.recording;
  let fastMode = live && !recording;

  const applyPolling = async () => {
    if (!live) return;
    try {
      await api.setLive(fastMode ? ["speed"] : readKeys(), true);
      state.polling = true;
    } catch (e) {
      toast(errorText(e), "error");
    }
  };

  const speedEl = h("span", { class: "perf-speed" }, "—");
  const speedUnit = displayUnit("km/h");
  const rateEl = h("p", { class: "muted small" });
  const cards = new Map<PerfTestId, { status: HTMLElement; last: HTMLElement; best: HTMLElement; el: HTMLElement }>();
  const grid = h("div", { class: "perf-grid" });
  const historyBox = h("div");

  for (const def of PERF_TESTS) {
    const status = h("p", { class: "perf-status" });
    const last = h("p", { class: "perf-time" }, "—");
    const best = h("p", { class: "muted small" });
    const toggle = h(
      "label",
      { class: "check" },
      h("input", {
        type: "checkbox",
        checked: armed.has(def.id),
        onchange: (e: Event) => {
          if ((e.target as HTMLInputElement).checked) armed.add(def.id);
          else armed.delete(def.id);
          saveProfile({ perfTests: PERF_TESTS.filter((d) => armed.has(d.id)).map((d) => d.id) }, me.id);
          // A run in progress is dropped: start clean with the new choice.
          detector = makeDetector();
          renderCards();
        },
      }),
      h("span", null, t("perf.watch")),
    );
    const el = h("article", { class: "card perf-card" }, h("h2", null, testLabel(def.from, def.to)), h("p", { class: "muted small" }, t(`perf.tests.${def.id}`)), last, best, status, toggle);
    grid.append(el);
    cards.set(def.id, { status, last, best, el });
  }

  const fmtTime = (s: number) => `${fmtNum(s, 2)} s`;
  const fmtDate = (ms: number) => new Date(ms).toLocaleString(getLang(), { dateStyle: "short", timeStyle: "short" });

  const renderCards = () => {
    const statuses = detector.status();
    for (const def of PERF_TESTS) {
      const c = cards.get(def.id)!;
      const st = statuses.find((x) => x.test === def.id) ?? { test: def.id, phase: "off" as const };
      c.el.classList.toggle("off", st.phase === "off");
      c.el.classList.toggle("running", st.phase === "running");
      c.el.classList.toggle("ready", st.phase === "ready");
      c.status.textContent =
        st.phase === "off"
          ? t("perf.off")
          : st.phase === "running"
          ? t("perf.running", { s: fmtNum(st.elapsedS ?? 0, 1) })
          : st.phase === "ready"
            ? t(`perf.ready.${st.test}`)
            : t(`perf.waiting.${st.test}`);
      const mine = history.filter((r) => r.test === st.test);
      const lastR = mine[mine.length - 1];
      c.last.textContent = lastR ? fmtTime(lastR.timeS) : "—";
      const best = mine.reduce<PerfResult | null>((b, r) => (!b || r.timeS < b.timeS ? r : b), null);
      c.best.textContent = best ? t("perf.best", { time: fmtTime(best.timeS), date: fmtDate(best.at) }) : t("perf.noResult");
    }
  };

  const renderHistory = () => {
    clear(historyBox);
    if (!history.length) {
      historyBox.append(h("p", { class: "muted" }, t("perf.historyEmpty")));
      return;
    }
    historyBox.append(
      h(
        "div",
        { class: "table-wrap" },
        h(
          "table",
          { class: "table" },
          h(
            "thead",
            null,
            h("tr", null, [t("perf.when"), t("perf.test"), t("perf.time"), t("perf.distance"), t("perf.avgG"), t("perf.samples")].map((c) => h("th", null, c))),
          ),
          h(
            "tbody",
            null,
            [...history].reverse().map((r) => {
              const def = PERF_TESTS.find((d) => d.id === r.test)!;
              return h(
                "tr",
                null,
                h("td", null, fmtDate(r.at)),
                h("td", null, testLabel(def.from, def.to)),
                h("td", { class: "num" }, h("strong", null, fmtTime(r.timeS))),
                h("td", { class: "num" }, fmtDistance(r.distanceM)),
                h("td", { class: "num" }, `${fmtNum(Math.abs(r.avgG), 2)} g`),
                h("td", { class: "num", title: r.sampleHz < 4 ? t("perf.lowRate") : "" }, `${fmtNum(r.sampleHz, 1)}/s${r.sampleHz < 4 ? " ⚠" : ""}`),
              );
            }),
          ),
        ),
      ),
      button(t("perf.clear"), async () => {
        const ok = await ask(t("perf.clearConfirm", { name: me.name }), { kind: "warning", okLabel: t("perf.clear"), cancelLabel: t("common.cancel") }).catch(() => true);
        if (!ok) return;
        history = [];
        store();
        renderHistory();
        renderCards();
      }, "ghost"),
    );
  };

  const fastBox = h(
    "label",
    { class: "check" },
    h("input", {
      type: "checkbox",
      checked: fastMode,
      disabled: !live,
      onchange: (e: Event) => {
        fastMode = (e.target as HTMLInputElement).checked;
        void applyPolling();
      },
    }),
    h("span", null, t("perf.fastMode")),
  );

  page.append(
    h("h1", null, t("perf.title")),
    h("p", { class: "lead" }, t("perf.intro")),
    h("p", { class: "muted small" }, t("profiles.resultsOf", { name: me.name })),
    h("div", { class: "alert alert-warning" }, h("p", null, t("perf.safety"))),
    ...(recording && live ? [h("p", { class: "muted small" }, t("perf.recordingNote"))] : []),
    h("div", { class: "perf-live card" }, h("div", null, speedEl, h("span", { class: "unit" }, ` ${speedUnit}`)), h("div", null, fastBox, rateEl)),
    grid,
    h("section", { class: "card" }, h("h2", null, t("perf.history")), historyBox),
  );

  const onFrame = () => {
    // Only a speed read in this very frame: an old one with a new time
    // would distort the times and the acceleration.
    const v = freshValue("speed");
    const tS = state.lastFrameT;
    if (v !== undefined) speedEl.textContent = fmtNum(toDisplay("km/h", v), 0);
    const rate = state.rateHz;
    rateEl.textContent = t(rate >= 8 ? "perf.rateGood" : rate >= 4 ? "perf.rateOk" : "perf.rateLow", { rate: fmtNum(rate, 1) });
    if (v === undefined || tS === undefined) return;
    const done = detector.push(tS, v).map((r) => ({ ...r, profileId: me.id }));
    if (done.length) {
      history = [...history, ...done].slice(-MAX_HISTORY);
      store();
      for (const r of done) {
        const def = PERF_TESTS.find((d) => d.id === r.test)!;
        toast(t("perf.done", { test: testLabel(def.from, def.to), time: fmtTime(r.timeS) }), "ok");
      }
      renderHistory();
    }
    renderCards();
  };

  renderCards();
  renderHistory();
  void applyPolling();
  const offs = [on("frame", onFrame), leaveOnDisconnect(t("perf.interrupted"))];
  return () => {
    offs.forEach((f) => f());
    // Give the dashboard its parameters back.
    if (live && state.connection === "connected") {
      api.setLive(readKeys(), wasPolling).catch(() => undefined);
      state.polling = wasPolling;
    }
  };
}
