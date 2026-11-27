// Live dashboard: value cards for the selected parameters + interpretation.
import { api } from "../api";
import { pidText, t } from "../i18n";
import { DEFAULT_KEYS, displayKeys, emit, hasLiveSource, isSupported, on, setLiveKeys, state } from "../store";
import { busy, button, clear, errorText, fmtValue, h, infoTip, notConnected, pidTip, toast, unitOf } from "../ui";
import type { Category } from "../api";
import { findingList } from "./findings";
import { makeGauge } from "../gauge";
import { activeAlerts } from "../alerts";
import { fmtNum } from "../i18n";
import { armRun, resetTrip, run, trip } from "../trip";

const CATEGORY_ORDER: Category[] = ["engine", "fuel", "air", "temperature", "emissions", "electrical", "vehicle"];

export async function startPolling(on_: boolean) {
  await api.setLive(state.liveKeys, on_);
  state.polling = on_;
  emit("connection");
}

export async function toggleRecording() {
  state.recording = state.recording.recording ? await api.stopRecording() : await api.startRecording();
  emit("recording");
}

export function mount(root: HTMLElement) {
  const page = h("div", { class: "page" });
  root.append(page);
  if (!hasLiveSource()) {
    page.append(h("h1", null, t("dashboard.title")), notConnected());
    return;
  }

  const cards = new Map<
    string,
    { el: HTMLElement; value: HTMLElement; range: HTMLElement; bar: HTMLElement | null; gauge?: (v: number | undefined) => void }
  >();
  const grid = h("div", { class: "value-grid" });
  let style: "cards" | "gauges" = "cards";
  try {
    if (localStorage.getItem("dashStyle") === "gauges") style = "gauges";
  } catch {
    /* default */
  }
  const styleBtns = (["cards", "gauges"] as const).map((s) =>
    h(
      "button",
      {
        type: "button",
        "aria-pressed": String(s === style),
        onclick: () => {
          style = s;
          try {
            localStorage.setItem("dashStyle", s);
          } catch {
            /* not remembered */
          }
          styleBtns.forEach((b, i) => b.setAttribute("aria-pressed", String((["cards", "gauges"] as const)[i] === style)));
          renderCards();
        },
      },
      t(s === "cards" ? "dashboard.styleCards" : "dashboard.styleGauges"),
    ),
  );
  const styleSeg = h("div", { class: "seg", role: "group", "aria-label": t("dashboard.style") }, styleBtns);
  const findingsBox = h("div");
  const tripBox = h("div");
  const picker = h("div", { class: "picker", hidden: true });

  const pollBtn = button("", async () => {
    await busy(pollBtn, () => startPolling(!state.polling));
    renderToolbar();
  }, "primary");
  const recBtn = button("", async () => {
    await busy(recBtn, toggleRecording);
    renderToolbar();
  }, "secondary");
  const chooseBtn = button(t("dashboard.choose"), () => {
    picker.hidden = !picker.hidden;
    if (!picker.hidden) renderPicker();
  }, "ghost");

  const renderToolbar = () => {
    pollBtn.textContent = state.polling ? t("dashboard.stopReading") : t("dashboard.startReading");
    pollBtn.className = `btn ${state.polling ? "btn-secondary" : "btn-primary"}`;
    recBtn.textContent = state.recording.recording ? t("dashboard.stopRecord") : t("dashboard.record");
    recBtn.className = `btn ${state.recording.recording ? "btn-danger" : "btn-secondary"}`;
  };

  const renderPicker = () => {
    clear(picker);
    const apply = async (keys: string[]) => {
      setLiveKeys(keys);
      try {
        await api.setLive(keys, state.polling);
      } catch (e) {
        toast(errorText(e), "error");
      }
      renderPicker();
      renderCards();
    };
    picker.append(
      h(
        "div",
        { class: "row" },
        h("p", { class: "muted small grow" }, t("dashboard.chooseHelp")),
        button(t("dashboard.selectDefault"), () => apply(DEFAULT_KEYS.filter(isSupported)), "ghost"),
        button(t("dashboard.selectAll"), () => apply(state.catalog.map((m) => m.key).filter(isSupported)), "ghost"),
        button(t("dashboard.selectNone"), () => apply([]), "ghost"),
      ),
    );
    for (const cat of CATEGORY_ORDER) {
      const items = state.catalog.filter((m) => m.category === cat);
      if (!items.length) continue;
      picker.append(
        h(
          "fieldset",
          null,
          h("legend", null, t(`categories.${cat}`)),
          items.map((m) => {
            const supported = isSupported(m.key);
            return h(
              "label",
              { class: `check ${supported ? "" : "disabled"}`, title: supported ? pidText(m.key).desc : t("dashboard.notSupported") },
              h("input", {
                type: "checkbox",
                disabled: !supported,
                checked: state.liveKeys.includes(m.key),
                onchange: (e: Event) => {
                  const checked = (e.target as HTMLInputElement).checked;
                  const keys = checked ? [...state.liveKeys, m.key] : state.liveKeys.filter((k) => k !== m.key);
                  apply(keys);
                },
              }),
              h("span", null, pidText(m.key).name),
            );
          }),
        ),
      );
    }
  };

  const renderCards = () => {
    clear(grid);
    cards.clear();
    const keys = displayKeys();
    if (!keys.length) {
      grid.append(h("p", { class: "muted" }, t("dashboard.empty")));
      return;
    }
    grid.className = style === "gauges" ? "value-grid gauge-grid" : "value-grid";
    for (const key of keys) {
      const txt = pidText(key);
      const value = h("span", { class: "value" });
      if (style === "gauges") {
        const m = state.catalog.find((x) => x.key === key);
        const g = makeGauge(key, m?.min ?? 0, m?.max ?? (key === "battery_voltage" ? 16 : 100));
        g.svg.setAttribute("aria-label", txt.name);
        const range = h("span", { class: "range" });
        const el = h(
            "article",
            { class: "value-card gauge-card" },
            h("header", null, h("span", { class: "name", title: txt.name }, txt.short), pidTip(key)),
            g.svg,
            h("div", { class: "value-line gauge-readout" }, value, h("span", { class: "unit" }, unitOf(key))),
            range,
          );
        grid.append(el);
        cards.set(key, { el, value, range, bar: null, gauge: g.set });
        continue;
      }
      const range = h("span", { class: "range" });
      const bar = h("span", { class: "bar-fill" });
      const el = h(
        "article",
        { class: "value-card", "aria-label": txt.name },
        h("header", null, h("span", { class: "name", title: txt.name }, txt.short), pidTip(key)),
        h("div", { class: "value-line" }, value, h("span", { class: "unit" }, unitOf(key))),
        h("div", { class: "bar" }, bar),
        range,
      );
      grid.append(el);
      cards.set(key, { el, value, range, bar });
    }
    updateValues();
  };

  const updateValues = () => {
    for (const [key, c] of cards) {
      const v = state.latest[key];
      c.value.textContent = fmtValue(key, v);
      const mm = state.minmax[key];
      c.range.textContent = mm ? `${t("dashboard.min")} ${fmtValue(key, mm[0])} · ${t("dashboard.max")} ${fmtValue(key, mm[1])}` : "";
      const m = state.catalog.find((x) => x.key === key);
      const lo = m?.min ?? 0;
      const hi = m?.max ?? (key === "battery_voltage" ? 16 : 100);
      const pct = v === undefined ? 0 : Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
      if (c.bar) c.bar.style.width = `${pct}%`;
      c.gauge?.(v);
      c.el.classList.toggle("alarm", activeAlerts.has(key));
    }
  };

  const tripNeeds = () => {
    const keys = new Set(state.playback ? state.playback.keys : state.liveKeys);
    if (keys.has("fuel_rate") || keys.has("maf") || (keys.has("rpm") && keys.has("intake_map") && keys.has("intake_temp")))
      return keys.has("speed") ? [] : ["speed"];
    const want = isSupported("maf") ? ["maf"] : ["rpm", "intake_map", "intake_temp"];
    return [...want, "speed"].filter((k) => !keys.has(k) && isSupported(k));
  };
  const renderTrip = () => {
    clear(tripBox);
    const missing = tripNeeds();
    const row = (label: string, value: string) => h("div", { class: "kv-row" }, h("span", { class: "muted" }, label), h("strong", null, value));
    if (missing.length && !state.playback) {
      tripBox.append(
        h("p", { class: "muted small" }, t("trip.needs", { names: missing.map((k) => pidText(k).short).join(", ") })),
        button(t("trip.addKeys"), () => {
          const keys = [...state.liveKeys, ...missing];
          setLiveKeys(keys);
          api.setLive(keys, state.polling).catch((e) => toast(errorText(e), "error"));
        }, "ghost"),
      );
    } else {
      const avg = trip.fuelL > 0.001 ? trip.distanceKm / trip.fuelL : undefined;
      tripBox.append(
        row(t("trip.instant"), trip.kmpl !== undefined ? `${fmtNum(trip.kmpl, 1)} km/L` : trip.lph !== undefined ? `${fmtNum(trip.lph, 2)} L/h` : "—"),
        row(t("trip.average"), avg !== undefined && trip.distanceKm > 0.1 ? `${fmtNum(avg, 1)} km/L` : "—"),
        row(t("trip.distance"), `${fmtNum(trip.distanceKm, 2)} km`),
        row(t("trip.fuel"), `${fmtNum(trip.fuelL, 2)} L`),
        row(t("trip.time"), `${Math.floor(trip.timeS / 60)} min ${String(Math.floor(trip.timeS % 60)).padStart(2, "0")} s`),
      );
      if (trip.source) tripBox.append(h("p", { class: "muted small" }, t(`trip.source.${trip.source}`)));
    }
    const runText =
      run.state === "armed"
        ? t("trip.runArmed", { target: run.target })
        : run.state === "running"
          ? t("trip.runRunning", { target: run.target })
          : run.resultS !== undefined
            ? t("trip.runResult", { target: run.target, s: fmtNum(run.resultS, 1) })
            : t("trip.runIdle");
    tripBox.append(
      h("div", { class: "row" }, button(t("trip.reset"), resetTrip, "ghost"), button(t("trip.runStart", { target: 100 }), () => armRun(100), "ghost")),
      h("p", { class: "small" }, runText),
    );
  };

  const renderFindings = () => {
    clear(findingsBox);
    findingsBox.append(findingList(state.findings));
  };

  // First visit after connecting: keep only what this car supports.
  if (!state.playback && state.adapter && state.liveKeys.every((k) => !isSupported(k) || k === "battery_voltage")) {
    setLiveKeys(DEFAULT_KEYS.filter(isSupported));
  }

  renderToolbar();
  page.append(
    h("div", { class: "page-head" }, h("h1", null, t("dashboard.title")), h("div", { class: "toolbar" }, styleSeg, state.playback ? [] : [chooseBtn, recBtn, pollBtn])),
    picker,
    h(
      "div",
      { class: "dash-layout" },
      grid,
      h(
        "aside",
        { class: "card findings-card" },
        h("h2", null, t("dashboard.findings")),
        findingsBox,
        h("p", { class: "muted small" }, t("dashboard.findingsDisclaimer")),
        h("h2", { class: "mt" }, t("trip.title"), " ", infoTip(t("trip.help"))),
        tripBox,
      ),
    ),
  );
  renderCards();
  renderFindings();
  renderTrip();

  let raf = 0;
  const offs = [
    on("frame", () => {
      if (!raf) raf = requestAnimationFrame(() => ((raf = 0), updateValues(), renderTrip()));
    }),
    on("trip", () => {
      if (!raf) raf = requestAnimationFrame(() => ((raf = 0), updateValues(), renderTrip()));
    }),
    on("findings", renderFindings),
    on("alerts", updateValues),
    on("live-keys", renderTrip),
    on("live-keys", renderCards),
    on("recording", renderToolbar),
    on("connection", renderToolbar),
  ];
  return () => {
    offs.forEach((f) => f());
    cancelAnimationFrame(raf);
  };
}
