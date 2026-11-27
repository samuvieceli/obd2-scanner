// Performance tests screen: 0–100, 100–0, 40–80 and 80–120 km/h, detected
// automatically while driving (see perf.ts for the detection rules).
import { api } from "../api";
import { fmtNum, getLang, t } from "../i18n";
import { hasLiveSource, on, state } from "../store";
import { PERF_TESTS, PerfDetector, type PerfResult, type PerfTestId } from "../perf";
import { button, clear, errorText, h, notConnected, toast } from "../ui";

const MAX_HISTORY = 100;

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

  const detector = new PerfDetector();
  let history = loadHistory();
  const live = !state.playback;
  const wasPolling = state.polling;
  // Speed-only polling gives many more samples per second → more precise times.
  let fastMode = live;

  const applyPolling = async () => {
    if (!live) return;
    try {
      await api.setLive(fastMode ? ["speed"] : state.liveKeys, true);
      state.polling = true;
    } catch (e) {
      toast(errorText(e), "error");
    }
  };

  const speedEl = h("span", { class: "perf-speed" }, "—");
  const rateEl = h("p", { class: "muted small" });
  const cards = new Map<PerfTestId, { status: HTMLElement; last: HTMLElement; best: HTMLElement; el: HTMLElement }>();
  const grid = h("div", { class: "perf-grid" });
  const historyBox = h("div");

  for (const def of PERF_TESTS) {
    const status = h("p", { class: "perf-status" });
    const last = h("p", { class: "perf-time" }, "—");
    const best = h("p", { class: "muted small" });
    const el = h("article", { class: "card perf-card" }, h("h2", null, `${def.from}–${def.to} km/h`), h("p", { class: "muted small" }, t(`perf.tests.${def.id}`)), last, best, status);
    grid.append(el);
    cards.set(def.id, { status, last, best, el });
  }

  const fmtTime = (s: number) => `${fmtNum(s, 2)} s`;
  const fmtDate = (ms: number) => new Date(ms).toLocaleString(getLang(), { dateStyle: "short", timeStyle: "short" });

  const renderCards = () => {
    for (const st of detector.status()) {
      const c = cards.get(st.test)!;
      c.el.classList.toggle("running", st.phase === "running");
      c.el.classList.toggle("ready", st.phase === "ready");
      c.status.textContent =
        st.phase === "running"
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
                h("td", null, `${def.from}–${def.to} km/h`),
                h("td", { class: "num" }, h("strong", null, fmtTime(r.timeS))),
                h("td", { class: "num" }, `${fmtNum(r.distanceM, 1)} m`),
                h("td", { class: "num" }, `${fmtNum(Math.abs(r.avgG), 2)} g`),
                h("td", { class: "num", title: r.sampleHz < 4 ? t("perf.lowRate") : "" }, `${fmtNum(r.sampleHz, 1)}/s${r.sampleHz < 4 ? " ⚠" : ""}`),
              );
            }),
          ),
        ),
      ),
      button(t("perf.clear"), () => {
        history = [];
        saveHistory(history);
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
    h("div", { class: "alert alert-warning" }, h("p", null, t("perf.safety"))),
    h("div", { class: "perf-live card" }, h("div", null, speedEl, h("span", { class: "unit" }, " km/h")), h("div", null, fastBox, rateEl)),
    grid,
    h("section", { class: "card" }, h("h2", null, t("perf.history")), historyBox),
  );

  const onFrame = () => {
    const v = state.latest.speed;
    const tS = state.lastFrameT;
    speedEl.textContent = v === undefined ? "—" : fmtNum(v, 0);
    const rate = state.rateHz;
    rateEl.textContent = t(rate >= 8 ? "perf.rateGood" : rate >= 4 ? "perf.rateOk" : "perf.rateLow", { rate: fmtNum(rate, 1) });
    if (v === undefined || tS === undefined) return;
    const done = detector.push(tS, v);
    if (done.length) {
      history = [...history, ...done].slice(-MAX_HISTORY);
      saveHistory(history);
      for (const r of done) {
        const def = PERF_TESTS.find((d) => d.id === r.test)!;
        toast(t("perf.done", { test: `${def.from}–${def.to} km/h`, time: fmtTime(r.timeS) }), "ok");
      }
      renderHistory();
    }
    renderCards();
  };

  renderCards();
  renderHistory();
  void applyPolling();
  const offs = [on("frame", onFrame)];
  return () => {
    offs.forEach((f) => f());
    // Give the dashboard its parameters back.
    if (live && state.connection === "connected") {
      api.setLive(state.liveKeys, wasPolling).catch(() => undefined);
      state.polling = wasPolling;
    }
  };
}
