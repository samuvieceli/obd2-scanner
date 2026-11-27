// Live dashboard: value cards for the selected parameters + interpretation.
import { api } from "../api";
import { pidText, t } from "../i18n";
import { DEFAULT_KEYS, displayKeys, emit, hasLiveSource, isSupported, on, setLiveKeys, state } from "../store";
import { warmBadge, busy, button, clear, displayValue, errorText, fmtValue, h, infoTip, notConnected, pidTip, toast, unitOf } from "../ui";
import type { Category } from "../api";
import { findingList } from "./findings";
import { makeGauge } from "../gauge";
import { activeAlerts } from "../alerts";
import { fmtNum, getLang } from "../i18n";
import { consumption, displayUnit, toDisplay } from "../units";

function fmtEconomy(kmPerL: number): string {
  const [v, unit] = consumption(kmPerL);
  return `${fmtNum(v, 1)} ${unit}`;
}
import { meters, resetTrip, resetTripMeter, setTripRunning, trip } from "../trip";
import { TRIP_IDS, average, averageSpeed, type TripId } from "../trips";
import { ask } from "@tauri-apps/plugin-dialog";
import { lastDrive, showSummary } from "./drive-summary";
import { tripCost } from "../cost";
import { normalize } from "../search";
import { prefs, profile, saveProfile } from "../prefs";
import { PRESETS, matchPreset, presetAfterClick, presetKeys, type PresetId } from "../presets";

const CATEGORY_ORDER: Category[] = ["engine", "fuel", "air", "temperature", "emissions", "electrical", "vehicle"];

export async function startPolling(on_: boolean) {
  await api.setLive(state.liveKeys, on_);
  state.polling = on_;
  emit("connection");
}

export async function toggleRecording() {
  const starting = !state.recording.recording;
  state.recording = starting ? await api.startRecording() : await api.stopRecording();
  emit("recording");
  // A recording only gets frames while reading: start reading with it.
  if (starting && !state.polling && !state.playback) await startPolling(true);
}

/** Marks this moment of the recording (button or Space key). */
export async function markEvent() {
  if (!state.recording.recording) return;
  try {
    state.recording = await api.addMark();
    emit("recording");
    toast(t("marks.added", { n: state.recording.marks }), "ok");
  } catch (e) {
    toast(errorText(e), "error");
  }
}

/** Big "mark event" button, shown only while recording. */
export function markButton(): HTMLButtonElement {
  const b = button(t("marks.button"), () => void markEvent(), "danger", { title: t("marks.help") });
  let shown = false;
  const sync = () => {
    // Stop listening once the screen that showed the button is gone.
    if (b.isConnected) shown = true;
    else if (shown) return off();
    b.hidden = !state.recording.recording;
    b.textContent = state.recording.marks ? `${t("marks.button")} (${state.recording.marks})` : t("marks.button");
  };
  const off = on("recording", sync);
  sync();
  return b;
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
  const warmEl = h("span", { class: "warm-badge", hidden: true, role: "status" });
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

  // Picker filter: kept while the picker is open and re-rendered.
  let query = "";
  let showUnsupported = false;
  const renderPicker = () => {
    clear(picker);
    const list = h("div");
    const apply = async (keys: string[]) => {
      setLiveKeys(keys);
      try {
        await api.setLive(keys, state.polling);
      } catch (e) {
        toast(errorText(e), "error");
      }
      renderList();
      renderCards();
    };
    // With a car connected, what it cannot answer is hidden unless asked for.
    const connected = !!state.adapter && !state.playback;
    const renderList = () => {
      clear(list);
      const words = normalize(query).split(/\s+/).filter(Boolean);
      const matches = (key: string, pid: number) => {
        const p = pidText(key);
        const text = normalize(`${p.name} ${p.short} ${key} ${pid.toString(16).padStart(2, "0")}`);
        return words.every((w) => text.includes(w));
      };
      let shown = 0;
      for (const cat of CATEGORY_ORDER) {
        const items = state.catalog.filter(
          (m) => m.category === cat && matches(m.key, m.pid) && (!connected || showUnsupported || isSupported(m.key) || state.liveKeys.includes(m.key)),
        );
        if (!items.length) continue;
        shown += items.length;
        list.append(
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
                    void apply(keys);
                  },
                }),
                h("span", null, pidText(m.key).name),
              );
            }),
          ),
        );
      }
      if (!shown) list.append(h("p", { class: "muted small" }, t("dashboard.pickerNone")));
    };
    const search = h("input", {
      type: "search",
      class: "grow",
      placeholder: t("dashboard.pickerSearch"),
      "aria-label": t("dashboard.pickerSearch"),
      value: query,
      oninput: (e: Event) => {
        query = (e.target as HTMLInputElement).value;
        renderList();
      },
    });
    picker.append(
      h(
        "div",
        { class: "row" },
        h("p", { class: "muted small grow" }, t("dashboard.chooseHelp")),
        button(t("dashboard.selectDefault"), () => apply(DEFAULT_KEYS.filter(isSupported)), "ghost"),
        button(t("dashboard.selectAll"), () => apply(state.catalog.map((m) => m.key).filter(isSupported)), "ghost"),
        button(t("dashboard.selectNone"), () => apply([]), "ghost"),
      ),
      h(
        "div",
        { class: "row" },
        search,
        connected
          ? h(
              "label",
              { class: "check" },
              h("input", {
                type: "checkbox",
                checked: showUnsupported,
                onchange: (e: Event) => {
                  showUnsupported = (e.target as HTMLInputElement).checked;
                  renderList();
                },
              }),
              h("span", null, t("dashboard.pickerShowAll")),
            )
          : "",
      ),
      list,
    );
    renderList();
    search.focus();
  };

  // Ready-made layouts: one click replaces the chosen parameters.
  const presetRow = h("div", { class: "chips preset-row", role: "group", "aria-label": t("dashboard.presets") });
  const renderPresets = () => {
    clear(presetRow);
    const all = state.catalog.map((m) => m.key);
    const active = matchPreset(state.liveKeys, isSupported, all);
    presetRow.append(h("span", { class: "muted small" }, t("dashboard.presets")));
    for (const id of Object.keys(PRESETS) as PresetId[]) {
      presetRow.append(
        h(
          "button",
          {
            type: "button",
            class: `chip ${id === active ? "on" : ""}`,
            "aria-pressed": String(id === active),
            title: t(`dashboard.preset.${id}.help`),
            onclick: async () => {
              // Clicking the active preset again unselects it: back to everything.
              const keys = presetKeys(presetAfterClick(id, active), isSupported, all);
              setLiveKeys(keys);
              try {
                await api.setLive(keys, state.polling);
              } catch (e) {
                toast(errorText(e), "error");
              }
              if (!picker.hidden) renderPicker();
            },
          },
          t(`dashboard.preset.${id}.name`),
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
        const g = makeGauge(key, displayValue(key, m?.min ?? 0), displayValue(key, m?.max ?? (key === "battery_voltage" ? 16 : 100)));
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
      c.gauge?.(v === undefined ? undefined : displayValue(key, v));
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
  // Numbers are redrawn on every reading; the buttons only when they change,
  // so a click is never lost to a redraw between press and release.
  const tripData = h("div");
  const tripActions = h("div");
  tripBox.append(tripData, tripActions);
  let actionsFor = "";
  const renderTripActions = (missing: string[]) => {
    const noPrice = tripCost(1, profile().fuel, state.latest.ethanol_percent, prefs().fuelPrices).cost === undefined;
    // Most Brazilian flex cars do not report the ethanol share (PID 52): in
    // "auto" the program would silently assume gasoline and show too low a
    // consumption with ethanol in the tank. Ask instead, with one click.
    const flexBlind = profile().fuel === "auto" && !!state.adapter && !state.playback && !isSupported("ethanol_percent");
    const m = meters();
    const key = `${missing.join()}|${!!state.playback}|${lastDrive?.endedAt ?? ""}|${noPrice}|${flexBlind}|${getLang()}|${m.a.running}|${m.b.running}|${profile().id}`;
    if (key === actionsFor) return;
    actionsFor = key;
    clear(tripActions);
    if (missing.length && !state.playback) {
      tripActions.append(
        button(t("trip.addKeys"), () => {
          const keys = [...state.liveKeys, ...missing];
          setLiveKeys(keys);
          api.setLive(keys, state.polling).catch((e) => toast(errorText(e), "error"));
        }, "ghost"),
      );
    }
    if (flexBlind) {
      const pick = (fuel: "gasoline" | "ethanol") => () => {
        saveProfile({ fuel });
        actionsFor = "";
        renderTrip();
      };
      tripActions.append(
        h(
          "div",
          { class: "alert small" },
          h("p", null, t("trip.flexUnknown")),
          h("div", { class: "row" }, button(t("trip.flexGasoline"), pick("gasoline"), "ghost"), button(t("trip.flexEthanol"), pick("ethanol"), "ghost")),
        ),
      );
    }
    if (noPrice && !(missing.length && !state.playback)) {
      tripActions.append(h("p", { class: "muted small" }, h("a", { href: "#/settings" }, t("cost.setPrices"))));
    }
    if (!state.playback) {
      const confirmReset = (id: TripId) => async () => {
        const name = t(`trip.meter.${id}`);
        const ok = await ask(t("trip.resetConfirm", { name }), { kind: "warning", okLabel: t("trip.resetMeter"), cancelLabel: t("common.cancel") }).catch(() => true);
        if (ok) resetTripMeter(id);
      };
      for (const id of TRIP_IDS) {
        const running = m[id].running;
        tripActions.append(
          h(
            "div",
            { class: "row trip-buttons" },
            h("strong", null, t(`trip.meter.${id}`)),
            button(t(running ? "trip.pause" : "trip.start"), () => setTripRunning(id, !running), running ? "ghost" : "secondary"),
            button(t("trip.resetMeter"), confirmReset(id), "ghost"),
          ),
        );
      }
    }
    tripActions.append(
      h(
        "div",
        { class: "row" },
        state.playback ? button(t("trip.reset"), resetTrip, "ghost") : "",
        lastDrive ? button(t("summary.open"), () => lastDrive && showSummary(lastDrive), "ghost") : "",
        h("a", { class: "btn btn-ghost", href: "#/performance" }, t("nav.performance")),
      ),
    );
  };
  const renderTrip = () => {
    const tripBox = tripData;
    clear(tripBox);
    const missing = tripNeeds();
    renderTripActions(missing);
    const row = (label: string, value: string) => h("div", { class: "kv-row" }, h("span", { class: "muted" }, label), h("strong", null, value));
    if (missing.length && !state.playback) {
      tripBox.append(h("p", { class: "muted small" }, t("trip.needs", { names: missing.map((k) => pidText(k).short).join(", ") })));
      return;
    }
    const instant = trip.kmpl !== undefined ? fmtEconomy(trip.kmpl) : trip.lph !== undefined ? `${fmtNum(toDisplay("L/h", trip.lph), 2)} ${displayUnit("L/h")}` : "—";
    const money = (v: number) => `${t("cost.currency")} ${fmtNum(v, 2)}`;
    const duration = (s: number) => {
      const hrs = Math.floor(s / 3600);
      const min = Math.floor((s % 3600) / 60);
      return hrs ? `${hrs} h ${String(min).padStart(2, "0")} min` : `${min} min ${String(Math.floor(s % 60)).padStart(2, "0")} s`;
    };
    const speedText = (v: number | undefined) => (v !== undefined ? `${fmtNum(toDisplay("km/h", v), 0)} ${displayUnit("km/h")}` : "—");
    if (!state.playback) {
      // Trip A and Trip B side by side, the instant consumption shared above.
      const m = meters();
      const cost = (fuelL: number) => tripCost(fuelL, profile().fuel, state.latest.ethanol_percent, prefs().fuelPrices).cost;
      const line = (label: string, f: (id: TripId) => string) =>
        h("tr", null, h("th", null, label), ...TRIP_IDS.map((id) => h("td", { class: "num" }, f(id))));
      tripBox.append(
        row(t("trip.instant"), instant),
        h(
          "table",
          { class: "table trip-table" },
          h(
            "thead",
            null,
            h("tr", null, h("th", null, ""), ...TRIP_IDS.map((id) => h("th", { class: "num" }, t(`trip.meter.${id}`), h("br"), h("span", { class: `muted small ${m[id].running ? "ok-text" : ""}` }, t(m[id].running ? "trip.counting" : "trip.paused"))))),
          ),
          h(
            "tbody",
            null,
            line(t("trip.average"), (id) => {
              const a = average(m[id]);
              return a !== undefined ? fmtEconomy(a) : "—";
            }),
            line(t("trip.distance"), (id) => `${fmtNum(toDisplay("km", m[id].distanceKm), 1)} ${displayUnit("km")}`),
            line(t("trip.avgSpeed"), (id) => speedText(averageSpeed(m[id]))),
            line(t("trip.fuel"), (id) => `${fmtNum(toDisplay("L", m[id].fuelL), 2)} ${displayUnit("L")}`),
            line(t("trip.time"), (id) => duration(m[id].timeS)),
            ...(cost(1) !== undefined ? [line(t("cost.trip"), (id) => money(cost(m[id].fuelL) ?? 0))] : []),
          ),
        ),
      );
      if (trip.source) tripBox.append(h("p", { class: "muted small" }, t(`trip.source.${trip.source}`)));
      return;
    }
    {
      const avg = trip.fuelL > 0.001 ? trip.distanceKm / trip.fuelL : undefined;
      tripBox.append(
        h("p", { class: "muted small" }, t("trip.replayNote")),
        row(t("trip.instant"), trip.kmpl !== undefined ? fmtEconomy(trip.kmpl) : trip.lph !== undefined ? `${fmtNum(toDisplay("L/h", trip.lph), 2)} ${displayUnit("L/h")}` : "—"),
        row(t("trip.average"), avg !== undefined && trip.distanceKm > 0.1 ? fmtEconomy(avg) : "—"),
        row(t("trip.distance"), `${fmtNum(toDisplay("km", trip.distanceKm), 2)} ${displayUnit("km")}`),
        row(t("trip.fuel"), `${fmtNum(toDisplay("L", trip.fuelL), 2)} ${displayUnit("L")}`),
        row(t("trip.avgSpeed"), speedText(averageSpeed(trip))),
        row(t("trip.time"), duration(trip.timeS)),
      );
      const c = tripCost(trip.fuelL, profile().fuel, state.latest.ethanol_percent, prefs().fuelPrices);
      if (c.cost !== undefined) tripBox.append(row(t("cost.trip"), money(c.cost)));
      if (c.asGasoline !== undefined && c.asEthanol !== undefined && trip.fuelL > 0.01) {
        tripBox.append(
          row(t("cost.asGasoline"), money(c.asGasoline)),
          row(t("cost.asEthanol"), money(c.asEthanol)),
          h("p", { class: "muted small" }, t("cost.breakEven", { pct: fmtNum(c.breakEven * 100, 0) })),
        );
      }
      if (trip.source) tripBox.append(h("p", { class: "muted small" }, t(`trip.source.${trip.source}`)));
    }
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
    h("div", { class: "page-head" }, h("h1", null, t("dashboard.title"), " ", warmEl), h("div", { class: "toolbar" }, styleSeg, state.playback ? [] : [markButton(), chooseBtn, recBtn, pollBtn])),
    state.playback ? "" : presetRow,
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
  warmBadge(warmEl, state);
  renderPresets();
  renderFindings();
  renderTrip();

  let raf = 0;
  // One redraw per animation frame, whatever asked for it.
  const redraw = () => {
    if (!raf) raf = requestAnimationFrame(() => ((raf = 0), updateValues(), renderTrip(), warmBadge(warmEl, state)));
  };
  const offs = [
    on("frame", redraw),
    on("trip", redraw),
    on("findings", renderFindings),
    on("alerts", updateValues),
    on("live-keys", renderTrip),
    on("live-keys", renderCards),
    on("live-keys", renderPresets),
    on("recording", renderToolbar),
    on("connection", renderToolbar),
  ];
  return () => {
    offs.forEach((f) => f());
    cancelAnimationFrame(raf);
  };
}
